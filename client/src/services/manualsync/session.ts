/**
 * Orquestación de la sincronización manual sobre la base local: identidad del
 * dispositivo, dispositivos autorizados, bases comunes por par, historial,
 * puntos de restauración y paquetes cifrados.
 *
 * Nada de esto se sincroniza ni entra en las copias de datos: son metadatos
 * propios de cada dispositivo (en IndexedDB, almacén clave-valor).
 */

import { loadDb, migrate, newId, replaceDb, type Db } from "@/services/localDb";
import { createRestorePoint, kvGet, kvSet, readRestorePoint } from "@/services/storage";
import {
  applyAnswer,
  buildOffer,
  pendingChanges,
  planOffer,
  resolvePlan,
  validateOffer,
  type Answer,
  type Base,
  type ChangeItem,
  type DeviceRef,
  type Offer,
  type Plan,
  type Resolution,
  type SyncSummary,
} from "./engine";
import { isEnvelope, open, randomSecret, seal, type Envelope } from "./crypto";

const DEVICE_KEY = "gestion-tareas:device";
const MAX_BASES = 5;
const MAX_LOG = 60;

export interface PairedDevice {
  deviceId: string;
  name: string;
  pairedAt: string;
  /** Secreto compartido para cifrar los mensajes por red (no para archivos). */
  secret: string | null;
  /** Dónde está su servicio de sincronización (solo si es el PC). */
  relayUrl: string | null;
  relayToken: string | null;
  lastSyncAt: string | null;
}

export interface SyncLogEntry {
  id: string;
  at: string;
  peer: string;
  peerName: string;
  method: "red" | "archivo";
  status: "ok" | "error" | "cancelado";
  summary?: SyncSummary;
  message?: string;
}

/* --------------------------------------------------------------- identidad */

export function deviceId(): string {
  let id: string | null = null;
  try {
    id = localStorage.getItem(DEVICE_KEY);
  } catch {
    /* sin almacenamiento */
  }
  if (!id) {
    id = newId();
    try {
      localStorage.setItem(DEVICE_KEY, id);
    } catch {
      /* se regenera en la próxima carga */
    }
  }
  return id;
}

export function defaultDeviceName(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Móvil Android";
  if (/Windows/.test(ua)) return "PC Windows";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Linux/.test(ua)) return "PC Linux";
  return "Este dispositivo";
}

export async function getSelf(): Promise<DeviceRef> {
  return { deviceId: deviceId(), name: await kvGet("sync:deviceName", defaultDeviceName()) };
}

export async function setDeviceName(name: string): Promise<void> {
  await kvSet("sync:deviceName", name.trim().slice(0, 40) || defaultDeviceName());
}

/* ------------------------------------------------------ dispositivos */

export async function listDevices(): Promise<PairedDevice[]> {
  return kvGet<PairedDevice[]>("sync:devices", []);
}

export async function upsertDevice(d: Partial<PairedDevice> & { deviceId: string; name: string }): Promise<PairedDevice> {
  const all = await listDevices();
  const prev = all.find((x) => x.deviceId === d.deviceId);
  const next: PairedDevice = {
    pairedAt: new Date().toISOString(),
    secret: null,
    relayUrl: null,
    relayToken: null,
    lastSyncAt: null,
    ...prev,
    ...d,
  };
  await kvSet("sync:devices", [...all.filter((x) => x.deviceId !== d.deviceId), next]);
  return next;
}

/** Revoca un dispositivo: deja de poder sincronizar por red y se olvida su base. */
export async function removeDevice(id: string): Promise<void> {
  await kvSet("sync:devices", (await listDevices()).filter((d) => d.deviceId !== id));
  const bases = await kvGet<Record<string, Base[]>>("sync:bases", {});
  delete bases[id];
  await kvSet("sync:bases", bases);
}

/* ------------------------------------------------------------- bases */

async function basesOf(peer: string): Promise<Base[]> {
  return (await kvGet<Record<string, Base[]>>("sync:bases", {}))[peer] ?? [];
}

export async function currentBase(peer: string): Promise<Base | null> {
  return (await basesOf(peer))[0] ?? null;
}

/** Se conservan varias bases: si una respuesta se perdió, la siguiente sincronización aún encuentra la base común. */
async function findBase(peer: string, id: string | null): Promise<Base | null> {
  if (!id) return null;
  return (await basesOf(peer)).find((b) => b.id === id) ?? null;
}

async function pushBase(peer: string, base: Base): Promise<void> {
  const all = await kvGet<Record<string, Base[]>>("sync:bases", {});
  all[peer] = [base, ...(all[peer] ?? []).filter((b) => b.id !== base.id)].slice(0, MAX_BASES);
  await kvSet("sync:bases", all);
}

export async function pendingFor(peer: string | null): Promise<ChangeItem[]> {
  return pendingChanges(loadDb(), peer ? await currentBase(peer) : null);
}

/* ------------------------------------------------------------ historial */

export async function syncLog(): Promise<SyncLogEntry[]> {
  return kvGet<SyncLogEntry[]>("sync:log", []);
}

export async function addLog(e: Omit<SyncLogEntry, "id" | "at">): Promise<void> {
  const log = await syncLog();
  await kvSet("sync:log", [{ id: newId(), at: new Date().toISOString(), ...e }, ...log].slice(0, MAX_LOG));
  if (e.status === "ok") {
    const devices = await listDevices();
    const d = devices.find((x) => x.deviceId === e.peer);
    if (d) await upsertDevice({ ...d, lastSyncAt: new Date().toISOString() });
  }
}

/* ------------------------------------------------------- flujo de sincronización */

/** Oferta de este dispositivo para `peer` (delta si hay base común). */
export async function createOffer(peer: string | null, opts: { full?: boolean; baseId?: string | null } = {}): Promise<Offer> {
  const self = await getSelf();
  let base = peer ? await currentBase(peer) : null;
  // El otro lado puede pedir una base concreta (la que él conserva).
  if (peer && opts.baseId !== undefined) base = await findBase(peer, opts.baseId);
  return buildOffer(loadDb(), self, peer, base, opts.full);
}

/** Valida una oferta recibida y calcula el plan contra la base común. */
export async function planIncoming(raw: unknown): Promise<Plan> {
  const { offer, errors } = validateOffer(raw);
  if (!offer) {
    return { offer: raw as Offer, hasBase: false, incoming: [], outgoing: [], conflicts: [], auto: [], errors, needFull: false };
  }
  if (offer.from.deviceId === deviceId()) {
    return { offer, hasBase: false, incoming: [], outgoing: [], conflicts: [], auto: [], errors: ["Este paquete lo generó este mismo dispositivo."], needFull: false };
  }
  const base = await findBase(offer.from.deviceId, offer.baseId);
  return planOffer(loadDb(), offer, base);
}

/**
 * Aplica el plan con las decisiones del usuario. Antes guarda un punto de
 * restauración: si algo sale mal, se vuelve al estado previo desde Ajustes.
 */
export async function commitPlan(
  plan: Plan,
  resolutions: Record<string, Resolution>,
  method: SyncLogEntry["method"]
): Promise<{ answer: Answer; warnings: string[] }> {
  const self = await getSelf();
  const current = loadDb();
  const { db, answer, warnings } = resolvePlan(current, plan, resolutions, self);
  await createRestorePoint(current, `Antes de sincronizar con ${plan.offer.from.name}`);
  replaceDb(db, "remote");
  await pushBase(plan.offer.from.deviceId, { id: answer.baseId, at: answer.createdAt, hashes: answer.base });
  const known = (await listDevices()).find((d) => d.deviceId === plan.offer.from.deviceId);
  if (!known) await upsertDevice({ deviceId: plan.offer.from.deviceId, name: plan.offer.from.name });
  await addLog({ peer: plan.offer.from.deviceId, peerName: plan.offer.from.name, method, status: "ok", summary: answer.summary });
  notifyApplied();
  return { answer, warnings };
}

/** Aplica la respuesta del otro dispositivo (cierra la sincronización en este lado). */
export async function receiveAnswer(raw: unknown, method: SyncLogEntry["method"]): Promise<SyncSummary> {
  const answer = raw as Answer;
  if (answer?.to && answer.to !== deviceId()) throw new Error("Esta respuesta es para otro dispositivo.");
  const current = loadDb();
  const { db, base } = applyAnswer(current, answer);
  await createRestorePoint(current, `Antes de aplicar la respuesta de ${answer.from?.name ?? "otro dispositivo"}`);
  replaceDb(db, "remote");
  await pushBase(answer.from.deviceId, base);
  const known = (await listDevices()).find((d) => d.deviceId === answer.from.deviceId);
  if (!known) await upsertDevice({ deviceId: answer.from.deviceId, name: answer.from.name });
  // Desde este lado, lo "recibido" es lo que envió el otro.
  const summary: SyncSummary = { ...answer.summary, received: answer.changes.length, sent: answer.summary.received };
  await addLog({ peer: answer.from.deviceId, peerName: answer.from.name, method, status: "ok", summary });
  notifyApplied();
  return summary;
}

function notifyApplied() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("gt:sync-applied"));
}

/* ------------------------------------------------------------- archivos */

export interface SyncFile {
  envelope: Envelope;
  /** Metadatos en claro para que el usuario sepa qué archivo es. */
  meta: { from: string; fromName: string; to: string | null; createdAt: string; content: Envelope["content"] };
}

export async function sealFile(payload: Offer | Answer, password: string): Promise<SyncFile> {
  const envelope = await seal(payload, password, payload.kind);
  return {
    envelope,
    meta: { from: payload.from.deviceId, fromName: payload.from.name, to: payload.to, createdAt: payload.createdAt, content: payload.kind },
  };
}

export async function openFile(text: string, password: string): Promise<{ kind: "offer" | "answer" | "backup"; payload: unknown }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("El archivo no es válido (no es JSON).");
  }
  const env = (parsed as SyncFile)?.envelope ?? parsed;
  if (!isEnvelope(env)) {
    // Copia sin cifrar (exportada así a petición del usuario).
    if ((parsed as BackupFile)?.format === BACKUP_FORMAT) return { kind: "backup", payload: parsed };
    throw new Error("El archivo no es un paquete de sincronización ni una copia de la app.");
  }
  const payload = await open(env, password);
  if (env.content === "backup") return { kind: "backup", payload };
  if (env.content === "offer" || env.content === "answer") return { kind: env.content, payload };
  throw new Error("Contenido del archivo no reconocido.");
}

/* ------------------------------------------------------------- copias */

export const BACKUP_FORMAT = "gestion-tareas/backup";

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  v: 1;
  exportedAt: string;
  device: DeviceRef;
  db: Db;
}

/** Copia íntegra de los datos. Sin hash del PIN: no debe servir para atacarlo. */
export async function buildBackup(): Promise<BackupFile> {
  const db = structuredClone(loadDb());
  db.settings = { ...db.settings, pinHash: null, pinEnabled: false };
  return { format: BACKUP_FORMAT, v: 1, exportedAt: new Date().toISOString(), device: await getSelf(), db };
}

export async function sealBackup(password: string | null): Promise<unknown> {
  const backup = await buildBackup();
  if (!password) return backup;
  return { envelope: await seal(backup, password, "backup"), meta: { from: backup.device.deviceId, fromName: backup.device.name, to: null, createdAt: backup.exportedAt, content: "backup" } };
}

export function describeBackup(b: BackupFile) {
  const db = b.db;
  return {
    exportedAt: b.exportedAt,
    device: b.device?.name ?? "desconocido",
    version: db.version,
    counts: {
      tareas: db.tasks?.length ?? 0,
      hábitos: db.habits?.length ?? 0,
      objetivos: db.goals?.length ?? 0,
      cuentas: db.finAccounts?.length ?? 0,
      movimientos: db.finTransactions?.length ?? 0,
      presupuestos: db.finBudgets?.length ?? 0,
      metas: db.finGoals?.length ?? 0,
    },
  };
}

/**
 * Restaura una copia REEMPLAZANDO los datos actuales. Antes guarda un punto de
 * restauración con lo que había, para poder deshacerlo. Conserva el PIN y las
 * preferencias propias de este dispositivo.
 */
export async function restoreBackup(b: BackupFile): Promise<void> {
  if (b?.format !== BACKUP_FORMAT || !b.db || typeof b.db !== "object") throw new Error("Copia no válida");
  const current = loadDb();
  await createRestorePoint(current, "Antes de restaurar una copia de seguridad");
  const restored = migrate(structuredClone(b.db) as unknown as Record<string, unknown>);
  restored.settings = { ...restored.settings, pinHash: current.settings.pinHash, pinEnabled: current.settings.pinEnabled, theme: current.settings.theme, skin: current.settings.skin };
  replaceDb(restored, "remote");
  notifyApplied();
}

/** Vuelve a un punto de restauración automático. */
export async function rollbackTo(id: number): Promise<void> {
  const data = await readRestorePoint(id);
  if (!data) throw new Error("Punto de restauración no encontrado");
  const current = loadDb();
  await createRestorePoint(current, "Antes de volver a un punto de restauración");
  replaceDb(migrate(structuredClone(data) as Record<string, unknown>), "remote");
  notifyApplied();
}

export { randomSecret };
