/**
 * Motor de sincronización MANUAL a tres bandas.
 *
 * Dos dispositivos (A y B) guardan cada uno, por cada par, la "base": las
 * huellas de todos los datos tal como quedaron en su última sincronización.
 * Con la base se distingue quién cambió qué:
 *
 *    local == base  y remoto != base  -> cambió el otro: se toma lo suyo
 *    remoto == base y local  != base  -> cambié yo: se envía lo mío
 *    ambos != base y distintos         -> CONFLICTO: decide el usuario
 *
 * Nunca se usa "la fecha más reciente gana" como regla general. Solo se
 * resuelve solo lo que es seguro (mismo contenido en ambos lados, datos de
 * ejemplo sin tocar, registros de hábito duplicados); lo demás se pregunta, y
 * en finanzas no se propone ninguna opción por defecto.
 *
 * Flujo (idéntico por red o por archivos):
 *
 *   1. OFERTA  (B -> A): huellas de todo lo de B + las filas que B cambió
 *      desde la base común (o todo, la primera vez) + las filas de las que
 *      dependen (para no romper relaciones).
 *   2. PLAN    (en A): qué entra, qué sale, qué choca. Se muestra al usuario.
 *   3. RESPUESTA (A -> B): A aplica lo decidido y envía a B exactamente lo que
 *      le falta para quedar igual, con la nueva base común.
 *   4. B aplica la respuesta solo si no ha tocado esos datos desde la oferta.
 *
 * Solo viaja lo que cambió: una segunda sincronización con un cambio envía
 * una fila, no la base entera.
 */

import {
  FINANCE_ROW_SCHEMAS,
} from "@/services/finance/schemas";
import { NOTE_ROW_SCHEMAS } from "@/services/notes/schemas";
import {
  SYNCED_COLLECTIONS,
  ensureOwnerTags,
  newId,
  nowIso,
  SEED_STAMP,
  type Db,
} from "@/services/localDb";
import { stripDangerousKeys } from "@/services/routeKit";
import {
  COLLECTION_LABEL,
  DELETED,
  canonical,
  entriesOf,
  hashRow,
  isFinanceCollection,
  keyOf,
  labelOf,
  manifestOf,
  norm,
  referencesOf,
  splitKey,
  type Entry,
  type EntryCollection,
  type Manifest,
} from "./keyspace";

export const PROTOCOL = 1;

export interface DeviceRef {
  deviceId: string;
  name: string;
}

export interface WireEntry {
  key: string;
  /** null = borrado. */
  row: Record<string, unknown> | null;
  deletedAt?: string;
}

export interface Offer {
  protocol: typeof PROTOCOL;
  kind: "offer";
  id: string;
  createdAt: string;
  from: DeviceRef;
  to: string | null;
  /** Base común sobre la que se calculó el delta; null = primera vez. */
  baseId: string | null;
  /** true = incluye TODAS las filas (no depende de ninguna base). */
  full: boolean;
  manifest: Manifest;
  entries: WireEntry[];
}

export interface Answer {
  protocol: typeof PROTOCOL;
  kind: "answer";
  id: string;
  offerId: string;
  createdAt: string;
  from: DeviceRef;
  to: string;
  /** Huella que el destinatario tenía en la oferta para cada clave que se toca. */
  expected: Manifest;
  changes: WireEntry[];
  baseId: string;
  base: Manifest;
  summary: SyncSummary;
}

export interface SyncSummary {
  received: number;
  sent: number;
  conflicts: number;
  autoResolved: number;
  repaired: number;
}

export interface Base {
  id: string;
  at: string;
  hashes: Manifest;
}

export type ChangeKind = "new" | "update" | "delete";

export interface ChangeItem {
  key: string;
  collection: EntryCollection;
  label: string;
  kind: ChangeKind;
  finance: boolean;
}

export interface FieldDiff {
  field: string;
  local: unknown;
  remote: unknown;
}

export interface Conflict {
  key: string;
  collection: EntryCollection;
  label: string;
  finance: boolean;
  local: Record<string, unknown> | null;
  remote: Record<string, unknown> | null;
  fields: FieldDiff[];
  /** Combinar campo a campo solo fuera de finanzas y con ambas versiones vivas. */
  canCombine: boolean;
  /** Sugerencia (nunca en finanzas): la versión modificada más tarde. */
  suggestion: "local" | "remote" | null;
}

export type Resolution =
  | { choice: "local" }
  | { choice: "remote" }
  | { choice: "combine"; fields: Record<string, "local" | "remote"> }
  | { choice: "union" };

export interface Plan {
  offer: Offer;
  hasBase: boolean;
  incoming: ChangeItem[];
  outgoing: ChangeItem[];
  conflicts: Conflict[];
  auto: { key: string; label: string; reason: string }[];
  /** Errores que impiden sincronizar (datos inválidos, delta sin base). */
  errors: string[];
  needFull: boolean;
}

const COLLECTIONS = new Set<string>([...SYNCED_COLLECTIONS, "taskTags", "settings"]);

/* ---------------------------------------------------------------- oferta */

/**
 * Prepara la oferta de este dispositivo para `to`. Con base, solo las filas
 * cambiadas desde ella (y sus dependencias); sin base o con `full`, todas.
 */
export function buildOffer(db: Db, self: DeviceRef, to: string | null, base: Base | null, full = false): Offer {
  const entries = entriesOf(db);
  const useBase = base && !full ? base : null;
  const picked = new Map<string, WireEntry>();
  const add = (e: Entry) => picked.set(e.key, { key: e.key, row: e.row, deletedAt: e.deletedAt });

  for (const e of entries.values()) {
    if (!useBase || norm(useBase.hashes[e.key]) !== e.hash) add(e);
  }
  // Borrados antiguos cuya lápida ya se purgó: siguen siendo un cambio.
  if (useBase) {
    for (const [key, h] of Object.entries(useBase.hashes)) {
      if (h !== DELETED && !entries.has(key)) picked.set(key, { key, row: null });
    }
  }
  // Dependencias de lo que se envía: el otro dispositivo podría no tenerlas.
  const queue = [...picked.values()];
  while (queue.length) {
    const w = queue.pop()!;
    for (const ref of referencesOf(splitKey(w.key).collection, w.row)) {
      const dep = entries.get(ref);
      if (dep && dep.row && !picked.has(ref)) {
        add(dep);
        queue.push(picked.get(ref)!);
      }
    }
  }

  const manifest = manifestOf(entries);
  if (useBase) {
    for (const [key, h] of Object.entries(useBase.hashes)) if (h !== DELETED && !(key in manifest)) manifest[key] = DELETED;
  }

  return {
    protocol: PROTOCOL,
    kind: "offer",
    id: newId(),
    createdAt: new Date().toISOString(),
    from: self,
    to,
    baseId: useBase?.id ?? null,
    full: !useBase,
    manifest,
    entries: [...picked.values()],
  };
}

/* ------------------------------------------------------------ validación */

function validateEntry(w: WireEntry): string | null {
  if (!w || typeof w.key !== "string" || w.key.length > 300) return "clave inválida";
  const { collection, id } = splitKey(w.key);
  if (!COLLECTIONS.has(collection)) return `colección desconocida «${collection}»`;
  if (w.row === null) return null;
  if (typeof w.row !== "object" || Array.isArray(w.row)) return `${w.key}: fila inválida`;
  if (String(w.row.id) !== id) return `${w.key}: el id no coincide`;
  const schema = (FINANCE_ROW_SCHEMAS as Record<string, { safeParse: (v: unknown) => { success: boolean } }>)[collection];
  if (schema && !schema.safeParse(w.row).success) return `${w.key}: datos financieros no válidos`;
  // Notas: el contenido enriquecido debe llegar ya saneado (nada de HTML ni estilos peligrosos).
  const noteSchema = (NOTE_ROW_SCHEMAS as Record<string, { safeParse: (v: unknown) => { success: boolean } }>)[collection];
  if (noteSchema && !noteSchema.safeParse(w.row).success) return `${w.key}: nota no válida`;
  return null;
}

/** Comprueba forma y contenido de una oferta recibida (entrada no confiable). */
export function validateOffer(o: unknown): { offer: Offer | null; errors: string[] } {
  const errors: string[] = [];
  const x = stripDangerousKeys(o) as Offer;
  if (!x || x.kind !== "offer" || x.protocol !== PROTOCOL) return { offer: null, errors: ["No es una oferta de sincronización compatible"] };
  if (!x.from?.deviceId || typeof x.manifest !== "object" || !Array.isArray(x.entries)) {
    return { offer: null, errors: ["Oferta incompleta"] };
  }
  for (const w of x.entries) {
    const err = validateEntry(w);
    if (err) errors.push(err);
    if (errors.length > 20) break;
  }
  return { offer: errors.length ? null : x, errors };
}

/* ------------------------------------------------------------------ plan */

const DEFAULT_SHARED_SETTINGS: Record<string, unknown> = {
  appName: "Productividad",
  appLogo: null,
  userName: null,
  language: "es",
  dateFormat: "dd/MM/yyyy",
  timezone: "America/Bogota",
  currency: "COP",
};

/** Dato de ejemplo o ajustes de fábrica que nadie ha tocado: ceden ante cualquier cambio real. */
function isSeedUntouched(row: Record<string, unknown> | null): boolean {
  if (!row) return false;
  if (row.updatedAt === SEED_STAMP) return true;
  if (row.id === "shared" && !("updatedAt" in row)) {
    return Object.entries(DEFAULT_SHARED_SETTINGS).every(([k, v]) => (row[k] ?? null) === v);
  }
  return false;
}

function withoutStamps(row: Record<string, unknown> | null): string {
  if (!row) return DELETED;
  const { updatedAt: _u, createdAt: _c, ...rest } = row;
  return canonical(rest);
}

function stampOf(row: Record<string, unknown> | null, deletedAt?: string): number {
  const v = row ? String(row.updatedAt ?? row.createdAt ?? "") : deletedAt ?? "";
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

function diffFields(a: Record<string, unknown> | null, b: Record<string, unknown> | null): FieldDiff[] {
  if (!a || !b) return [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: FieldDiff[] = [];
  for (const k of keys) {
    if (k === "updatedAt" || k === "createdAt" || k === "id") continue;
    if (canonical(a[k]) !== canonical(b[k])) out.push({ field: k, local: a[k], remote: b[k] });
  }
  return out;
}

function changeKind(before: string, after: string): ChangeKind {
  if (after === DELETED) return "delete";
  return before === DELETED ? "new" : "update";
}

/**
 * Compara la oferta recibida con los datos locales. No modifica nada: el
 * resultado se enseña al usuario antes de aplicar.
 */
export function planOffer(db: Db, offer: Offer, base: Base | null): Plan {
  const local = entriesOf(db);
  const remoteRows = new Map(offer.entries.map((w) => [w.key, w]));
  const plan: Plan = { offer, hasBase: false, incoming: [], outgoing: [], conflicts: [], auto: [], errors: [], needFull: false };

  const b = base && offer.baseId === base.id ? base : null;
  if (!b && !offer.full) {
    plan.needFull = true;
    plan.errors.push("Este paquete depende de una sincronización anterior que este dispositivo no tiene. Pide al otro dispositivo un paquete completo.");
    return plan;
  }
  plan.hasBase = !!b;

  const keys = new Set<string>([...local.keys(), ...Object.keys(offer.manifest), ...Object.keys(b?.hashes ?? {})]);
  for (const key of keys) {
    const le = local.get(key);
    const l = norm(le?.hash);
    const r = norm(offer.manifest[key]);
    if (l === r) continue;
    const { collection } = splitKey(key);
    if (!COLLECTIONS.has(collection)) continue;
    const rw = remoteRows.get(key);
    const lrow = le?.row ?? null;
    const rrow = rw?.row ?? null;
    const finance = isFinanceCollection(collection);
    const label = labelOf({ collection, row: lrow ?? rrow, id: splitKey(key).id });
    const item = (kind: ChangeKind): ChangeItem => ({ key, collection, label, kind, finance });

    // La fila remota solo hace falta si vamos a TOMAR su versión (o a
    // mostrarla en un conflicto); si solo cambié yo, la oferta no la trae.
    const needRemoteRow = () => {
      if (r !== DELETED && !rw) {
        plan.errors.push(`Falta la fila ${key} en el paquete`);
        return false;
      }
      return true;
    };

    if (b) {
      const bh = norm(b.hashes[key]);
      if (l === bh) {
        if (needRemoteRow()) plan.incoming.push(item(changeKind(l, r)));
        continue;
      }
      if (r === bh) {
        plan.outgoing.push(item(changeKind(r, l)));
        continue;
      }
    } else {
      // Primera sincronización: lo que solo existe en un lado se copia.
      if (l === DELETED && !le) {
        if (needRemoteRow()) plan.incoming.push(item("new"));
        continue;
      }
      if (r === DELETED && !(key in offer.manifest)) {
        plan.outgoing.push(item("new"));
        continue;
      }
    }

    // Ambos cambiaron.
    if (!needRemoteRow()) continue;
    // Casos seguros que no necesitan preguntar:
    if (withoutStamps(lrow) === withoutStamps(rrow)) {
      // Mismo contenido: se queda la marca más reciente (inocuo).
      const takeRemote = stampOf(rrow, rw?.deletedAt) > stampOf(lrow, le?.deletedAt);
      (takeRemote ? plan.incoming : plan.outgoing).push(item("update"));
      plan.auto.push({ key, label, reason: "Mismo contenido en ambos dispositivos" });
      continue;
    }
    if (isSeedUntouched(lrow) && rrow) {
      plan.incoming.push(item("update"));
      plan.auto.push({ key, label, reason: "Dato de ejemplo o ajuste de fábrica sin modificar en este dispositivo" });
      continue;
    }
    if (isSeedUntouched(rrow) && lrow) {
      plan.outgoing.push(item("update"));
      plan.auto.push({ key, label, reason: "Dato de ejemplo o ajuste de fábrica sin modificar en el otro dispositivo" });
      continue;
    }

    const lstamp = stampOf(lrow, le?.deletedAt);
    const rstamp = stampOf(rrow, rw?.deletedAt);
    plan.conflicts.push({
      key,
      collection,
      label,
      finance,
      local: lrow,
      remote: rrow,
      fields: diffFields(lrow, rrow),
      canCombine: !finance && !!lrow && !!rrow && collection !== "taskTags",
      suggestion: finance || lstamp === rstamp ? null : lstamp > rstamp ? "local" : "remote",
    });
  }
  return plan;
}

/* -------------------------------------------------------------- aplicar */

/** Escribe una entrada en la base (fila, conjunto de etiquetas, ajustes o borrado). */
export function writeEntry(db: Db, key: string, row: Record<string, unknown> | null, deletedAt?: string): void {
  const { collection, id } = splitKey(key);
  if (collection === "settings") {
    if (row) {
      // Un valor ausente en el otro dispositivo (versión anterior) no borra
      // el propio: solo se copian valores definidos.
      for (const [k, v] of Object.entries(row)) {
        if (k === "id") continue;
        if (v === null && (k === "appName" || k === "language" || k === "timezone" || k === "currency" || k === "dateFormat")) continue;
        (db.settings as unknown as Record<string, unknown>)[k] = v;
      }
    }
    return;
  }
  if (collection === "taskTags") {
    db.taskTags = db.taskTags.filter((t) => t.taskId !== id);
    if (row && Array.isArray(row.tagIds)) for (const tagId of row.tagIds) db.taskTags.push({ taskId: id, tagId: String(tagId) });
    return;
  }
  const list = db[collection as keyof Db] as unknown as Record<string, unknown>[];
  if (!Array.isArray(list)) return;
  const i = list.findIndex((r) => r.id === id);
  if (row) {
    const clean = stripDangerousKeys(row);
    if (i >= 0) list[i] = clean;
    else list.push(clean);
    db.tombstones = db.tombstones.filter((t) => !(t.collection === collection && t.id === id));
  } else {
    if (i >= 0) list.splice(i, 1);
    const at = deletedAt ?? nowIso();
    const t = db.tombstones.find((x) => x.collection === collection && x.id === id);
    if (t) t.deletedAt = at;
    else db.tombstones.push({ collection, id, deletedAt: at });
  }
}

function combineRows(
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  fields: Record<string, "local" | "remote">
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...local };
  for (const [k, side] of Object.entries(fields)) if (side === "remote") out[k] = remote[k];
  out.updatedAt = nowIso();
  return out;
}

export interface ResolveResult {
  db: Db;
  answer: Answer;
  warnings: string[];
}

/**
 * Aplica el plan con las decisiones del usuario sobre una COPIA de la base y
 * produce la respuesta para el otro dispositivo. Lanza si falta resolver
 * algún conflicto.
 */
export function resolvePlan(
  current: Db,
  plan: Plan,
  resolutions: Record<string, Resolution>,
  self: DeviceRef
): ResolveResult {
  if (plan.errors.length) throw new Error(plan.errors[0]);
  const missing = plan.conflicts.filter((c) => !resolutions[c.key]);
  if (missing.length) throw new Error(`Faltan ${missing.length} conflicto(s) por resolver`);

  const db = structuredClone(current);
  const before = entriesOf(current);
  const remote = new Map(plan.offer.entries.map((w) => [w.key, w]));
  const warnings: string[] = [];

  for (const item of plan.incoming) {
    const w = remote.get(item.key);
    writeEntry(db, item.key, w?.row ?? null, w?.deletedAt);
  }
  for (const c of plan.conflicts) {
    const res = resolutions[c.key];
    if (res.choice === "remote") {
      const w = remote.get(c.key);
      writeEntry(db, c.key, w?.row ?? null, w?.deletedAt);
    } else if (res.choice === "combine" && c.local && c.remote && c.canCombine) {
      writeEntry(db, c.key, combineRows(c.local, c.remote, res.fields));
    } else if (res.choice === "union" && c.collection === "taskTags") {
      const ids = new Set([...((c.local?.tagIds as string[]) ?? []), ...((c.remote?.tagIds as string[]) ?? [])]);
      writeEntry(db, c.key, { id: splitKey(c.key).id, tagIds: [...ids].sort() });
    }
    // "local": no se toca nada aquí; se enviará al otro lado.
  }

  let repaired = 0;
  repaired += repairReferences(db, before, remote, warnings);
  repaired += dedupeHabitLogs(db, warnings);
  ensureOwnerTags(db);

  // Respuesta: exactamente lo que al otro le falta para quedar igual.
  const merged = entriesOf(db);
  const mergedManifest = manifestOf(merged);
  const changes: WireEntry[] = [];
  const expected: Manifest = {};
  const keys = new Set([...Object.keys(mergedManifest), ...Object.keys(plan.offer.manifest)]);
  for (const key of keys) {
    const want = norm(mergedManifest[key]);
    const theirs = norm(plan.offer.manifest[key]);
    if (want === theirs) continue;
    const e = merged.get(key);
    changes.push({ key, row: e?.row ?? null, deletedAt: e?.deletedAt });
    expected[key] = theirs;
  }

  const received = plan.incoming.length + plan.conflicts.filter((c) => resolutions[c.key].choice !== "local").length;
  const summary: SyncSummary = {
    received,
    sent: changes.length,
    conflicts: plan.conflicts.length,
    autoResolved: plan.auto.length,
    repaired,
  };
  const answer: Answer = {
    protocol: PROTOCOL,
    kind: "answer",
    id: newId(),
    offerId: plan.offer.id,
    createdAt: new Date().toISOString(),
    from: self,
    to: plan.offer.from.deviceId,
    expected,
    changes,
    baseId: newId(),
    base: mergedManifest,
    summary,
  };
  return { db, answer, warnings };
}

/**
 * Integridad referencial tras mezclar: si algo sigue apuntando a una fila que
 * se iba a borrar (p. ej. una cuenta borrada en un dispositivo mientras el
 * otro le añadía movimientos), la fila se conserva. Borrarla dejaría saldos o
 * historiales huérfanos.
 */
function repairReferences(db: Db, before: Map<string, Entry>, remote: Map<string, WireEntry>, warnings: string[]): number {
  let repaired = 0;
  for (let pass = 0; pass < 4; pass++) {
    const now = entriesOf(db);
    let changed = false;
    for (const e of now.values()) {
      if (!e.row) continue;
      for (const ref of referencesOf(e.collection, e.row)) {
        const target = now.get(ref);
        if (target?.row) continue;
        const source = before.get(ref)?.row ?? remote.get(ref)?.row ?? null;
        if (!source) continue; // no hay copia en ninguno de los dos lados
        writeEntry(db, ref, source);
        repaired++;
        changed = true;
        const { collection } = splitKey(ref);
        warnings.push(
          `Se conservó ${COLLECTION_LABEL[collection] ?? collection} «${labelOf({ collection, row: source, id: splitKey(ref).id })}» porque «${labelOf(e)}» la utiliza.`
        );
      }
    }
    if (!changed) break;
  }
  return repaired;
}

/** Un registro por (hábito, día): dos dispositivos que marcaron el mismo día no suman doble. */
function dedupeHabitLogs(db: Db, warnings: string[]): number {
  const best = new Map<string, (typeof db.habitLogs)[number]>();
  const drop: string[] = [];
  for (const l of db.habitLogs) {
    const k = `${l.habitId}|${l.date}`;
    const prev = best.get(k);
    if (!prev) {
      best.set(k, l);
      continue;
    }
    const keepNew = l.count > prev.count || (l.count === prev.count && l.id < prev.id);
    drop.push(keepNew ? prev.id : l.id);
    if (keepNew) best.set(k, l);
  }
  for (const id of drop) writeEntry(db, keyOf("habitLogs", id), null);
  if (drop.length) warnings.push(`${drop.length} registro(s) de hábito duplicados se unificaron.`);
  return drop.length;
}

/**
 * Aplica una respuesta en el dispositivo que ofreció. Solo si no ha cambiado
 * ninguno de los datos afectados desde que envió la oferta: si los tocó, se
 * rechaza entera (nunca a medias) y basta con volver a sincronizar.
 */
export function applyAnswer(current: Db, answer: Answer): { db: Db; base: Base } {
  const x = stripDangerousKeys(answer) as Answer;
  if (x.kind !== "answer" || x.protocol !== PROTOCOL || !Array.isArray(x.changes)) {
    throw new Error("No es una respuesta de sincronización compatible");
  }
  for (const w of x.changes) {
    const err = validateEntry(w);
    if (err) throw new Error(`Respuesta rechazada: ${err}`);
  }
  const now = entriesOf(current);
  const touched = Object.entries(x.expected).filter(([key, h]) => norm(now.get(key)?.hash) !== norm(h));
  if (touched.length) {
    throw new Error(
      `Modificaste ${touched.length} dato(s) afectados mientras se sincronizaba. No se aplicó nada: vuelve a sincronizar.`
    );
  }
  const db = structuredClone(current);
  for (const w of x.changes) writeEntry(db, w.key, w.row, w.deletedAt);
  return { db, base: { id: x.baseId, at: x.createdAt, hashes: x.base } };
}

/** Cambios locales pendientes respecto a la base con un dispositivo. */
export function pendingChanges(db: Db, base: Base | null): ChangeItem[] {
  const entries = entriesOf(db);
  const out: ChangeItem[] = [];
  for (const e of entries.values()) {
    const bh = base ? norm(base.hashes[e.key]) : DELETED;
    if (bh === e.hash) continue;
    if (!base && !e.row) continue;
    if (e.collection === "settings" && !base) continue;
    out.push({
      key: e.key,
      collection: e.collection,
      label: labelOf(e),
      kind: changeKind(bh, e.hash),
      finance: isFinanceCollection(e.collection),
    });
  }
  return out;
}

export { hashRow };
