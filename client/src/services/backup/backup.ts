// Copias de seguridad: locales (verificadas, dentro del navegador) y
// descargables (archivo JSON que el usuario guarda fuera del navegador).
//
// Formato del archivo (v2):
//   { format: "gestion-tareas/backup", v: 2, schemaVersion, appVersion,
//     exportedAt, device, counts, checksum, db, files? }
// - `checksum` es la huella de `db` serializado: detecta archivos dañados o
//   editados antes de tocar nada.
// - `files` lleva los adjuntos de las notas en base64 (opcional).
// Se siguen aceptando las copias v1 y las exportaciones antiguas de
// Ajustes (`{ version, exportedAt, data }`).
//
// Nunca se ejecuta nada del archivo: se parsea como JSON y se valida fila a fila.

import { z } from "zod";
import {
  DB_VERSION,
  SYNCED_COLLECTIONS,
  loadDb,
  migrate,
  replaceDb,
  type Db,
} from "@/services/localDb";
import {
  checksumOf,
  createRestorePoint,
  flushStorage,
  getSaveStatus,
  listRestorePoints,
  readRestorePoint,
  setRetention,
  type RestoreKind,
  type RestorePoint,
} from "@/services/storage";
import { FINANCE_ROW_SCHEMAS } from "@/services/finance/schemas";
import { NOTE_ROW_SCHEMAS } from "@/services/notes/schemas";
import { stripDangerousKeys } from "@/services/routeKit";
import { fromB64, isEnvelope, open, seal, toB64 } from "@/services/manualsync/crypto";
import { getFile, putFile, sha256Hex } from "@/services/notes/files";
import { canonical, hashString } from "@/services/manualsync/keyspace";

export const BACKUP_FORMAT = "gestion-tareas/backup";

export class BackupError extends Error {
  code: "invalid" | "damaged" | "incompatible" | "password" | "storage";
  constructor(code: BackupError["code"], message: string) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

/* ----------------------------------------------------------- preferencias */

const PREFS_KEY = "gestion-tareas:backup-prefs";
const STATUS_KEY = "gestion-tareas:backup-status";

export interface BackupPrefs {
  /** Minutos entre copias automáticas mientras la app está abierta (0 = desactivado). */
  autoIntervalMin: number;
  /** Copias automáticas/previas a acciones que se conservan. */
  maxAuto: number;
  /** Copias manuales que se conservan. */
  maxManual: number;
  /** Días sin descargar una copia externa antes de recordarlo (0 = nunca). */
  remindDays: number;
}

export const DEFAULT_BACKUP_PREFS: BackupPrefs = { autoIntervalMin: 60, maxAuto: 12, maxManual: 20, remindDays: 7 };

export interface BackupOp {
  at: string;
  action: string;
  ok: boolean;
  message: string;
  size?: number;
}

export interface BackupStatus {
  lastLocalBackupAt: string | null;
  lastAutoChecksum: string | null;
  lastDownloadAt: string | null;
  lastDownloadSize: number | null;
  reminderSnoozedUntil: string | null;
  /** Primer uso en este dispositivo: el recordatorio cuenta desde aquí. */
  firstSeenAt: string | null;
  lastOp: BackupOp | null;
}

const EMPTY_STATUS: BackupStatus = {
  lastLocalBackupAt: null,
  lastAutoChecksum: null,
  lastDownloadAt: null,
  lastDownloadSize: null,
  reminderSnoozedUntil: null,
  firstSeenAt: null,
  lastOp: null,
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* preferencias pequeñas: si no caben, se usan los valores por defecto */
  }
}

export function loadBackupPrefs(): BackupPrefs {
  return readJson(PREFS_KEY, DEFAULT_BACKUP_PREFS);
}

export function saveBackupPrefs(patch: Partial<BackupPrefs>): BackupPrefs {
  const next = { ...loadBackupPrefs(), ...patch };
  writeJson(PREFS_KEY, next);
  setRetention({ maxAuto: next.maxAuto, maxManual: next.maxManual });
  emit();
  return next;
}

export function loadBackupStatus(): BackupStatus {
  return readJson(STATUS_KEY, EMPTY_STATUS);
}

function patchStatus(patch: Partial<BackupStatus>): BackupStatus {
  const next = { ...loadBackupStatus(), ...patch };
  writeJson(STATUS_KEY, next);
  emit();
  return next;
}

function recordOp(action: string, ok: boolean, message: string, size?: number): void {
  patchStatus({ lastOp: { at: new Date().toISOString(), action, ok, message, size } });
}

const listeners = new Set<() => void>();
function emit() {
  for (const fn of listeners) fn();
}
export function onBackupChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ------------------------------------------------------- copias locales */

/** Copia verificada dentro del navegador. Lanza si no se pudo comprobar. */
export async function createLocalBackup(reason = "Copia manual", kind: RestoreKind = "manual"): Promise<RestorePoint> {
  setRetention(loadBackupPrefs());
  try {
    const db = loadDb();
    const point = await createRestorePoint(db, reason, kind);
    patchStatus({ lastLocalBackupAt: point.at, ...(kind === "auto" ? { lastAutoChecksum: point.checksum ?? null } : {}) });
    if (kind !== "auto") recordOp("Crear copia de seguridad", true, "Copia creada y verificada", point.size);
    return point;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    recordOp("Crear copia de seguridad", false, `No se pudo crear la copia: ${msg}`);
    throw new BackupError("storage", `No se pudo crear la copia de seguridad: ${msg}`);
  }
}

/** Copia automática: solo si hubo cambios desde la anterior y ya tocaba. */
export async function maybeAutoBackup(now = Date.now()): Promise<RestorePoint | null> {
  const prefs = loadBackupPrefs();
  if (!prefs.autoIntervalMin) return null;
  const st = loadBackupStatus();
  const last = st.lastLocalBackupAt ? new Date(st.lastLocalBackupAt).getTime() : 0;
  if (now - last < prefs.autoIntervalMin * 60_000) return null;
  if (st.lastAutoChecksum && checksumOf(loadDb()) === st.lastAutoChecksum) return null;
  return createLocalBackup("Copia automática", "auto").catch(() => null);
}

/** Mientras la app está abierta, revisa cada minuto si toca una copia automática. */
export function startAutoBackup(): () => void {
  setRetention(loadBackupPrefs());
  const t = setInterval(() => void maybeAutoBackup(), 60_000);
  void maybeAutoBackup();
  return () => clearInterval(t);
}

/* ----------------------------------------- copia previa a acciones de riesgo */

/**
 * Rutas que borran datos en cascada o reemplazan información. Antes de la
 * primera de una tanda (una por cada 2 minutos) se guarda una copia
 * verificada del estado anterior.
 */
const DESTRUCTIVE: [string, RegExp, string][] = [
  ["DELETE", /^\/habits\/[^/]+$/, "eliminar un hábito"],
  ["DELETE", /^\/categories\/[^/]+$/, "eliminar una categoría"],
  ["DELETE", /^\/goals\/[^/]+$/, "eliminar un objetivo"],
  ["DELETE", /^\/tasks\/[^/]+$/, "eliminar una tarea"],
  ["DELETE", /^\/finance\/(accounts|budgets|goals|categories|recurring)\/[^/]+$/, "eliminar datos de finanzas"],
  ["DELETE", /^\/notes\/[^/]+\/purge$/, "eliminar una nota definitivamente"],
  ["POST", /^\/notes\/trash\/empty$/, "vaciar la papelera de notas"],
  ["POST", /^\/backup\/import$/, "importar una copia"],
  ["POST", /^\/finance\/import$/, "importar datos financieros"],
];
const PRE_ACTION_WINDOW_MS = 2 * 60_000;
let lastPreAction = 0;

export function destructiveLabel(method: string, path: string): string | null {
  const clean = path.split("?")[0];
  return DESTRUCTIVE.find(([m, re]) => m === method && re.test(clean))?.[2] ?? null;
}

export async function beforeDestructive(method: string, path: string, now = Date.now()): Promise<void> {
  const label = destructiveLabel(method, path);
  if (!label || now - lastPreAction < PRE_ACTION_WINDOW_MS) return;
  try {
    await createRestorePoint(loadDb(), `Antes de ${label}`, "pre-action");
    lastPreAction = now;
  } catch {
    // Sin espacio para la copia no se bloquea la acción, pero se registra.
    recordOp("Copia previa a una acción", false, `No se pudo crear la copia previa a «${label}»`);
  }
}

export function __resetPreActionForTests(): void {
  lastPreAction = 0;
}

/* ------------------------------------------------------- archivo externo */

export interface BackupFileV2 {
  format: typeof BACKUP_FORMAT;
  v: 2;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  device: { deviceId: string; name: string } | null;
  counts: Record<string, number>;
  checksum: string;
  db: Db;
  files?: { key: string; size: number; b64: string }[];
  missingFiles?: string[];
}

const COUNT_LABELS: [keyof Db, string][] = [
  ["tasks", "Tareas"],
  ["habits", "Hábitos"],
  ["habitLogs", "Registros de hábitos"],
  ["habitSchedules", "Horarios de hábitos"],
  ["events", "Eventos"],
  ["goals", "Objetivos"],
  ["notes", "Notas"],
  ["categories", "Categorías"],
  ["finAccounts", "Cuentas"],
  ["finTransactions", "Movimientos"],
  ["finBudgets", "Presupuestos"],
  ["finGoals", "Metas de ahorro"],
];

export function countsOf(db: Partial<Db>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, label] of COUNT_LABELS) out[label] = Array.isArray(db[k]) ? (db[k] as unknown[]).length : 0;
  return out;
}

declare const __APP_VERSION__: string;
const appVersion = () => (typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev");

/**
 * Construye la copia desde la MEMORIA: funciona aunque el almacenamiento del
 * navegador esté fallando (copia de emergencia). Sin hash del PIN.
 */
export async function buildBackupFile(opts: { includeFiles?: boolean; device?: { deviceId: string; name: string } | null } = {}): Promise<BackupFileV2> {
  const db = structuredClone(loadDb());
  db.settings = { ...db.settings, pinHash: null, pinEnabled: false };
  const file: BackupFileV2 = {
    format: BACKUP_FORMAT,
    v: 2,
    schemaVersion: db.version ?? DB_VERSION,
    appVersion: appVersion(),
    exportedAt: new Date().toISOString(),
    device: opts.device ?? null,
    counts: countsOf(db),
    checksum: checksumOf(db),
    db,
  };
  if (opts.includeFiles) {
    const keys = [...new Set(db.notes.flatMap((n) => n.attachments.map((a) => a.fileKey)))];
    file.files = [];
    file.missingFiles = [];
    for (const key of keys) {
      const bytes = await getFile(key).catch(() => null);
      if (bytes) file.files.push({ key, size: bytes.length, b64: toB64(bytes) });
      else file.missingFiles.push(key);
    }
  }
  return file;
}

/** Texto del archivo, cifrado con AES-256-GCM si se da contraseña. */
export async function serializeBackup(file: BackupFileV2, password?: string | null): Promise<string> {
  if (!password) return JSON.stringify(file);
  const envelope = await seal(file, password, "backup");
  return JSON.stringify({
    envelope,
    meta: { from: file.device?.deviceId ?? "", fromName: file.device?.name ?? "", to: null, createdAt: file.exportedAt, content: "backup" },
  });
}

export function backupFileName(date = new Date(), encrypted = false): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`;
  return `copia-productividad-${stamp}${encrypted ? ".cifrada" : ""}.json`;
}

/** Anota que el usuario descargó una copia externa (para el recordatorio). */
export function markDownloaded(size: number): void {
  patchStatus({ lastDownloadAt: new Date().toISOString(), lastDownloadSize: size, reminderSnoozedUntil: null });
  recordOp("Descargar copia de seguridad", true, "Copia descargada", size);
}

/* ---------------------------------------------------------- validación */

export interface BackupPreview {
  exportedAt: string | null;
  schemaVersion: number;
  appVersion: string | null;
  device: string | null;
  counts: Record<string, number>;
  files: number;
  missingFiles: number;
  format: "v2" | "v1" | "export" | "raw";
  newerSchema: boolean;
  checksumVerified: boolean;
}

export interface ParsedBackup {
  db: Db;
  files: { key: string; size: number; b64: string }[];
  preview: BackupPreview;
}

const MAX_ROWS = 50_000;
const rowSchema = z.object({ id: z.string().min(1).max(256) }).passthrough();

function validateDb(db: Record<string, unknown>): string | null {
  if (!db || typeof db !== "object" || Array.isArray(db)) return "no contiene datos";
  for (const c of SYNCED_COLLECTIONS) {
    const rows = db[c];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) return `«${c}» no es una lista`;
    if (rows.length > MAX_ROWS) return `«${c}» tiene demasiadas filas`;
    for (let i = 0; i < rows.length; i++) {
      const clean = stripDangerousKeys(rows[i]);
      if (!rowSchema.safeParse(clean).success) return `${c}[${i}] no tiene un identificador válido`;
      const strict = (FINANCE_ROW_SCHEMAS as Record<string, z.ZodTypeAny>)[c] ?? (NOTE_ROW_SCHEMAS as Record<string, z.ZodTypeAny>)[c];
      if (strict) {
        const r = strict.safeParse(clean);
        if (!r.success) return `${c}[${i}] ${r.error.issues[0]?.path.join(".")}: ${r.error.issues[0]?.message}`;
      }
    }
  }
  if (db.taskTags !== undefined && !Array.isArray(db.taskTags)) return "«taskTags» no es una lista";
  if (db.settings !== undefined && (typeof db.settings !== "object" || db.settings === null)) return "ajustes no válidos";
  return null;
}

/** Convierte la exportación antigua de Ajustes (`{ version, data }`) a la forma de la base. */
function fromLegacyExport(x: any): Record<string, unknown> {
  const data = x.data ?? {};
  return { version: 1, ...data, settings: data.settings ?? {}, tombstones: [] };
}

/**
 * Lee y valida un archivo de copia SIN aplicarlo. Si está cifrado hace falta
 * la contraseña. Un archivo dañado, alterado o incompatible lanza un error
 * con la explicación; los datos actuales no se tocan.
 */
export async function parseBackupText(text: string, password?: string | null): Promise<ParsedBackup> {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError("invalid", "El archivo no es una copia válida: no es JSON (¿está incompleto o dañado?).");
  }
  const env = parsed?.envelope ?? parsed;
  if (isEnvelope(env)) {
    if (!password) throw new BackupError("password", "Esta copia está cifrada: introduce su contraseña.");
    try {
      parsed = await open(env, password);
    } catch {
      throw new BackupError("password", "Contraseña incorrecta o archivo alterado.");
    }
  }
  parsed = stripDangerousKeys(parsed);

  let db: Record<string, unknown>;
  let format: BackupPreview["format"];
  let checksumVerified = false;
  if (parsed?.format === BACKUP_FORMAT && parsed.v === 2) {
    format = "v2";
    db = parsed.db;
    if (!db || typeof db !== "object") throw new BackupError("invalid", "La copia no contiene datos.");
    if (typeof parsed.checksum !== "string" || checksumOf(db) !== parsed.checksum) {
      throw new BackupError("damaged", "La copia está dañada o fue modificada: su suma de comprobación no coincide. No se ha cambiado nada.");
    }
    checksumVerified = true;
  } else if (parsed?.format === BACKUP_FORMAT && parsed.v === 1) {
    format = "v1";
    db = parsed.db;
  } else if (parsed && typeof parsed === "object" && parsed.data && typeof parsed.data === "object" && "exportedAt" in parsed) {
    format = "export";
    db = fromLegacyExport(parsed);
  } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.tasks) && typeof parsed.settings === "object") {
    format = "raw";
    db = parsed;
  } else {
    throw new BackupError("invalid", "El archivo no es una copia de seguridad de esta app.");
  }

  const problem = validateDb(db);
  if (problem) throw new BackupError("incompatible", `La copia no se puede recuperar: ${problem}. No se ha cambiado nada.`);

  const schemaVersion = Number(db.version) || 1;
  const files = Array.isArray(parsed.files) ? parsed.files.filter((f: any) => typeof f?.key === "string" && typeof f?.b64 === "string") : [];
  const migrated = migrate(structuredClone(db));
  return {
    db: migrated,
    files,
    preview: {
      exportedAt: parsed.exportedAt ?? null,
      schemaVersion,
      appVersion: parsed.appVersion ?? null,
      device: parsed.device?.name ?? null,
      counts: countsOf(migrated),
      files: files.length,
      missingFiles: Array.isArray(parsed.missingFiles) ? parsed.missingFiles.length : 0,
      format,
      newerSchema: schemaVersion > DB_VERSION,
      checksumVerified,
    },
  };
}

/* ---------------------------------------------------------- restauración */

type Row = { id: string; updatedAt?: string; createdAt?: string };

/**
 * Combina una copia con los datos actuales SIN borrar nada: añade lo que
 * falta y, si un registro existe en ambos, conserva la versión editada más
 * recientemente. Un registro borrado aquí después de la copia no revive.
 */
export function mergeBackupInto(current: Db, incoming: Db): { db: Db; added: number; updated: number; kept: number } {
  const db = structuredClone(current);
  let added = 0;
  let updated = 0;
  let kept = 0;
  for (const c of SYNCED_COLLECTIONS) {
    const mine = db[c] as unknown as Row[];
    const theirs = (incoming[c] ?? []) as unknown as Row[];
    const index = new Map(mine.map((r, i) => [r.id, i]));
    for (const row of theirs) {
      const i = index.get(row.id);
      if (i === undefined) {
        const tomb = db.tombstones.find((t) => t.collection === c && t.id === row.id);
        if (tomb && tomb.deletedAt >= (row.updatedAt ?? row.createdAt ?? "")) {
          kept++;
          continue;
        }
        mine.push(structuredClone(row));
        if (tomb) db.tombstones = db.tombstones.filter((t) => t !== tomb);
        added++;
      } else if ((row.updatedAt ?? "") > (mine[i].updatedAt ?? "")) {
        mine[i] = structuredClone(row);
        updated++;
      } else {
        kept++;
      }
    }
  }
  const pairs = new Set(db.taskTags.map((t) => `${t.taskId}|${t.tagId}`));
  for (const tt of incoming.taskTags ?? []) {
    if (!pairs.has(`${tt.taskId}|${tt.tagId}`) && db.tasks.some((t) => t.id === tt.taskId)) {
      db.taskTags.push({ taskId: tt.taskId, tagId: tt.tagId });
      pairs.add(`${tt.taskId}|${tt.tagId}`);
    }
  }
  return { db, added, updated, kept };
}

async function restoreFiles(files: { key: string; b64: string }[]): Promise<{ restored: number; failed: number }> {
  let restored = 0;
  let failed = 0;
  for (const f of files) {
    try {
      const bytes = fromB64(f.b64);
      // El contenido debe corresponder a su huella: un adjunto alterado se descarta.
      if ((await sha256Hex(bytes)) !== f.key) {
        failed++;
        continue;
      }
      await putFile(bytes);
      restored++;
    } catch {
      failed++;
    }
  }
  return { restored, failed };
}

export interface RestoreResult {
  mode: "replace" | "merge";
  added?: number;
  updated?: number;
  kept?: number;
  filesRestored: number;
  filesFailed: number;
  safetyBackup: RestorePoint;
}

/**
 * Restaura una copia ya validada. Pasos: (1) copia VERIFICADA del estado
 * actual —si no se puede crear, no se restaura—; (2) aplicar; (3) esperar a
 * que se guarde y comprobarlo; (4) adjuntos. Si algo falla tras aplicar, se
 * vuelve al estado anterior.
 */
export async function restoreParsed(backup: ParsedBackup, mode: "replace" | "merge"): Promise<RestoreResult> {
  const current = loadDb();
  let safetyBackup: RestorePoint;
  try {
    safetyBackup = await createRestorePoint(current, "Antes de restaurar una copia de seguridad", "pre-action");
  } catch (e) {
    recordOp("Restaurar copia de seguridad", false, "Cancelada: no se pudo crear la copia previa");
    throw new BackupError("storage", `No se restauró nada: no se pudo guardar antes una copia del estado actual (${e instanceof Error ? e.message : e}).`);
  }

  let next: Db;
  let stats: Pick<RestoreResult, "added" | "updated" | "kept"> = {};
  if (mode === "replace") {
    next = structuredClone(backup.db);
    // PIN, tema y aspecto son de este dispositivo: se conservan.
    next.settings = {
      ...next.settings,
      pinHash: current.settings.pinHash,
      pinEnabled: current.settings.pinEnabled,
      theme: current.settings.theme,
      skin: current.settings.skin,
    };
  } else {
    const merged = mergeBackupInto(current, backup.db);
    next = merged.db;
    stats = { added: merged.added, updated: merged.updated, kept: merged.kept };
  }

  try {
    replaceDb(next, "local");
    await flushStorage();
    if (getSaveStatus().state === "error") throw new Error(getSaveStatus().error ?? "no se pudo guardar");
    // Comparación canónica (orden de claves indiferente) de lo aplicado.
    if (hashString(canonical(next)) !== hashString(canonical({ ...loadDb(), version: next.version }))) {
      throw new Error("los datos guardados no coinciden con los restaurados");
    }
  } catch (e) {
    // Vuelta atrás al estado anterior (ya a salvo en la copia previa).
    const previous = await readRestorePoint(safetyBackup.id).catch(() => null);
    if (previous) replaceDb(migrate(structuredClone(previous) as Record<string, unknown>), "local");
    recordOp("Restaurar copia de seguridad", false, "Falló y se deshizo");
    throw new BackupError("storage", `La restauración falló y se deshizo: ${e instanceof Error ? e.message : e}`);
  }

  const files = await restoreFiles(backup.files);
  recordOp(
    "Restaurar copia de seguridad",
    true,
    mode === "replace" ? "Datos reemplazados por la copia" : `Combinada: ${stats.added} añadidos, ${stats.updated} actualizados`
  );
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent("gt:sync-applied"));
  return { mode, ...stats, filesRestored: files.restored, filesFailed: files.failed, safetyBackup };
}

/** Restaura una copia local (punto de restauración) reemplazando los datos. */
export async function restoreLocalBackup(id: number): Promise<RestoreResult> {
  const data = await readRestorePoint(id);
  if (!data) throw new BackupError("invalid", "La copia ya no existe.");
  const db = migrate(structuredClone(data) as Record<string, unknown>);
  return restoreParsed({ db, files: [], preview: { exportedAt: null, schemaVersion: db.version, appVersion: null, device: null, counts: countsOf(db), files: 0, missingFiles: 0, format: "raw", newerSchema: false, checksumVerified: true } }, "replace");
}

/** Copia local como archivo descargable (mismo formato v2). */
export async function localBackupAsFile(id: number): Promise<BackupFileV2> {
  const data = (await readRestorePoint(id)) as Db | null;
  if (!data) throw new BackupError("invalid", "La copia ya no existe.");
  const db = structuredClone(data);
  if (db.settings) db.settings = { ...db.settings, pinHash: null, pinEnabled: false };
  const points = await listRestorePoints();
  const at = points.find((p) => p.id === id)?.at ?? new Date().toISOString();
  return { format: BACKUP_FORMAT, v: 2, schemaVersion: db.version ?? DB_VERSION, appVersion: appVersion(), exportedAt: at, device: null, counts: countsOf(db), checksum: checksumOf(db), db };
}

/* ----------------------------------------------------------- recordatorio */

/** ¿Toca recordar descargar una copia externa? */
export function needsBackupReminder(now = Date.now()): boolean {
  const prefs = loadBackupPrefs();
  if (!prefs.remindDays) return false;
  const st = loadBackupStatus();
  if (!st.firstSeenAt) {
    patchStatus({ firstSeenAt: new Date(now).toISOString() });
    return false;
  }
  if (st.reminderSnoozedUntil && new Date(st.reminderSnoozedUntil).getTime() > now) return false;
  const last = new Date(st.lastDownloadAt ?? st.firstSeenAt).getTime();
  return now - last > prefs.remindDays * 86_400_000;
}

export function snoozeReminder(days = 1): void {
  patchStatus({ reminderSnoozedUntil: new Date(Date.now() + days * 86_400_000).toISOString() });
}

/* ------------------------------------------------------------- adjuntos */

/** Adjuntos que usa la base actual o cualquier copia local (no se deben borrar). */
export async function attachmentsInUse(): Promise<Set<string>> {
  const inUse = new Set(loadDb().notes.flatMap((n) => n.attachments.map((a) => a.fileKey)));
  for (const p of await listRestorePoints()) {
    try {
      const data = (await readRestorePoint(p.id)) as Partial<Db> | null;
      for (const n of data?.notes ?? []) for (const a of n.attachments ?? []) inUse.add(a.fileKey);
    } catch {
      /* copia dañada: no aporta referencias */
    }
  }
  return inUse;
}
