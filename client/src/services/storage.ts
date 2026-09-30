/**
 * Almacenamiento persistente del dispositivo.
 *
 * Capas (de más a menos importante):
 *  1. IndexedDB — almacenamiento principal. Admite cientos de MB (localStorage
 *     se queda en ~5 MB y con finanzas, logos y notas ya no cabía).
 *  2. Espejo en localStorage — segunda copia completa de la base (si cabe),
 *     escrita tras cada guardado y de forma SÍNCRONA al salir de la página:
 *     si el navegador cierra la pestaña antes de que IndexedDB termine, o si
 *     IndexedDB se pierde o se corrompe, al volver se recupera desde aquí.
 *  3. Copias verificadas (puntos de restauración) dentro de IndexedDB y
 *     copias descargables fuera del navegador (ver services/backup).
 *
 * Coherencia entre pestañas: cada escritura incrementa una revisión
 * (`dbmeta.rev`). Si al escribir la revisión guardada ya no es la que esta
 * pestaña leyó, otra pestaña escribió entre medias: en vez de sobrescribirla,
 * se fusionan fila a fila (persistence/merge.ts). Las demás pestañas se
 * enteran por BroadcastChannel y recargan los datos.
 *
 * Además aquí viven:
 *  - un almacén clave-valor para metadatos locales del dispositivo
 *    (dispositivos emparejados, bases de sincronización, historial), que
 *    NUNCA se sincronizan ni se exportan en las copias de datos;
 *  - el estado de guardado que muestra la interfaz.
 */

import { stableHash } from "@/services/habits/hash";

const IDB_NAME = "gestion-tareas";
const IDB_VERSION = 1;
const KV = "kv";
const RESTORE = "restore";
const DB_KEY = "db";
const META_KEY = "dbmeta";
const LEGACY_LS_KEY = "gestion-tareas:db";
const LS_KV_PREFIX = "gestion-tareas:kv:";
export const MIRROR_KEY = "gestion-tareas:db:mirror";
export const MIRROR_META_KEY = "gestion-tareas:db:mirror-meta";
const LS_REV_KEY = "gestion-tareas:db:rev";
/** Por encima de esto no se intenta el espejo (localStorage ronda los 5 MB). */
let mirrorMaxChars = 4_000_000;
const CHANNEL = "gestion-tareas:db";

export type StorageKind = "indexeddb" | "localStorage";

export interface StorageInfo {
  kind: StorageKind;
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
  migratedFromLocalStorage: boolean;
  /** Datos recuperados de la copia espejo (IndexedDB faltaba o iba por detrás). */
  recoveredFromMirror?: boolean;
  /** IndexedDB no disponible: se trabaja solo con localStorage. */
  degraded?: boolean;
  /** Fecha de la copia verificada desde la que se recuperó una base vacía. */
  recoveredFromRestorePoint?: string | null;
}

export type RestoreKind = "auto" | "manual" | "pre-action";

export interface RestorePoint {
  id: number;
  at: string;
  reason: string;
  version: number;
  size: number;
  kind?: RestoreKind;
  checksum?: string;
  verified?: boolean;
}

/* ------------------------------------------------------ estado de guardado */

export type SaveState = "idle" | "saving" | "saved" | "error";
export type MirrorState = "off" | "ok" | "too-large" | "error";

export interface SaveStatus {
  state: SaveState;
  lastSavedAt: string | null;
  error: string | null;
  retrying: boolean;
  rev: number;
  mirror: MirrorState;
  mirrorSavedAt: string | null;
}

let status: SaveStatus = { state: "idle", lastSavedAt: null, error: null, retrying: false, rev: 0, mirror: "off", mirrorSavedAt: null };
const statusListeners = new Set<(s: SaveStatus) => void>();

function setStatus(patch: Partial<SaveStatus>): void {
  status = { ...status, ...patch };
  for (const fn of statusListeners) {
    try {
      fn(status);
    } catch {
      /* un suscriptor roto no afecta al guardado */
    }
  }
}

export function getSaveStatus(): SaveStatus {
  return status;
}

export function onSaveStatus(fn: (s: SaveStatus) => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

/* ------------------------------------------------------------- conexión */

let idb: IDBDatabase | null = null;
let kind: StorageKind = "localStorage";
/** Revisión del almacenamiento que esta pestaña leyó o escribió por última vez. */
let knownRev = 0;
/** Contenido de esa revisión: base común para fusionar con otras pestañas. */
let base: unknown = null;
let latest: unknown = null;
let dirty = false;
let writing: Promise<void> | null = null;
let failures = 0;
let channel: BroadcastChannel | null = null;
const tabId = Math.random().toString(36).slice(2, 10);

type MergeFn = (base: any, ours: any, theirs: any) => any;
let mergeFn: MergeFn | null = null;

interface Hooks {
  /** Estado actual en memoria. */
  current: () => unknown;
  /** Sustituye la memoria por datos llegados del almacenamiento (otra pestaña o fusión). */
  replace: (db: unknown) => void;
}
let hooks: Hooks | null = null;

/** Lo llama localDb una vez: evita importarlo desde aquí (dependencia circular). */
export function configureStorage(h: Hooks): void {
  hooks = h;
}

function hasIdb(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transacción abortada"));
  });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, IDB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(RESTORE)) db.createObjectStore(RESTORE, { keyPath: "id", autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    // Otra pestaña con una versión antigua abierta: se avisa en vez de colgarse.
    r.onblocked = () => reject(new Error("La base de datos está bloqueada por otra pestaña de la app"));
  });
}

export function storageKind(): StorageKind {
  return kind;
}

/* ------------------------------------------------------------- espejo */

interface MirrorMeta {
  format: "gestion-tareas/mirror";
  rev: number;
  /** Contiene cambios que quizá no llegaron a IndexedDB (guardado al salir). */
  ahead: boolean;
  savedAt: string;
  checksum: string;
  size: number;
}

function readMirror(): { meta: MirrorMeta; data: Record<string, unknown> } | null {
  try {
    const metaRaw = localStorage.getItem(MIRROR_META_KEY);
    const dataRaw = localStorage.getItem(MIRROR_KEY);
    if (!metaRaw || !dataRaw) return null;
    const meta = JSON.parse(metaRaw) as MirrorMeta;
    // Una copia a medio escribir o alterada no se usa jamás.
    if (meta?.format !== "gestion-tareas/mirror" || stableHash(dataRaw) !== meta.checksum) return null;
    return { meta, data: JSON.parse(dataRaw) };
  } catch {
    return null;
  }
}

function readMirrorMeta(): MirrorMeta | null {
  try {
    const raw = localStorage.getItem(MIRROR_META_KEY);
    return raw ? (JSON.parse(raw) as MirrorMeta) : null;
  } catch {
    return null;
  }
}

/** Escribe la copia espejo (síncrono). Nunca lanza: el espejo es una red extra. */
function writeMirror(data: unknown, rev: number, ahead: boolean): void {
  if (kind !== "indexeddb" || data == null) return;
  try {
    const prev = readMirrorMeta();
    // Otra pestaña ya dejó un espejo más reciente: no se pisa con uno más viejo.
    if (prev && prev.rev > rev) return;
    const json = JSON.stringify(data);
    if (json.length > mirrorMaxChars) {
      setStatus({ mirror: "too-large" });
      return;
    }
    const meta: MirrorMeta = { format: "gestion-tareas/mirror", rev, ahead, savedAt: new Date().toISOString(), checksum: stableHash(json), size: json.length };
    // Primero los datos y después la cabecera: si se corta a mitad, la
    // suma de comprobación no cuadra y la copia se descarta.
    localStorage.setItem(MIRROR_KEY, json);
    localStorage.setItem(MIRROR_META_KEY, JSON.stringify(meta));
    setStatus({ mirror: "ok", mirrorSavedAt: meta.savedAt });
  } catch {
    // Cuota llena u otro fallo: se retira el espejo incompleto.
    try {
      localStorage.removeItem(MIRROR_META_KEY);
    } catch {
      /* nada más que hacer */
    }
    setStatus({ mirror: "error" });
  }
}

let mirrorTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleMirror(): void {
  if (kind !== "indexeddb") return;
  if (mirrorTimer) clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null;
    if (!dirty && !writing) writeMirror(base, knownRev, false);
  }, 1500);
}

/**
 * Última oportunidad al salir o pasar a segundo plano: el espejo se escribe de
 * forma síncrona (IndexedDB es asíncrono y el navegador puede cortarlo). No
 * se depende solo de esto: cada cambio ya se guarda al momento.
 */
export function persistNow(): void {
  if (kind !== "indexeddb") return;
  if (mirrorTimer) {
    clearTimeout(mirrorTimer);
    mirrorTimer = null;
  }
  if (dirty || writing) {
    const cur = hooks?.current() ?? latest;
    writeMirror(cur, knownRev, true);
  } else if ((readMirrorMeta()?.rev ?? -1) < knownRev) {
    writeMirror(base, knownRev, false);
  }
}

/* ------------------------------------------------------------ arranque */

/**
 * Abre el almacenamiento y devuelve la base guardada (sin migrar), o null si
 * no hay nada. Elige la copia más reciente entre IndexedDB y el espejo; la
 * copia antigua de localStorage de versiones previas nunca se borra.
 */
export async function openStorage(): Promise<{ raw: Record<string, unknown> | null; info: StorageInfo }> {
  let migratedFromLocalStorage = false;
  let recoveredFromMirror = false;
  let recoveredFromRestorePoint: string | null = null;
  let degraded = false;
  let raw: Record<string, unknown> | null = null;
  const mirror = readMirror();

  try {
    mergeFn = (await import("./persistence/merge")).mergeDbs;
  } catch {
    mergeFn = null;
  }

  if (hasIdb()) {
    try {
      idb = await open();
      kind = "indexeddb";
      const store = idb.transaction(KV).objectStore(KV);
      const [stored, meta] = await Promise.all([
        req(store.get(DB_KEY)) as Promise<Record<string, unknown> | undefined>,
        req(store.get(META_KEY)) as Promise<{ rev?: number } | undefined>,
      ]);
      raw = stored ?? null;
      knownRev = Number(meta?.rev) || 0;

      const mirrorNewer = mirror && (!raw || mirror.meta.rev > knownRev || (mirror.meta.rev === knownRev && mirror.meta.ahead));
      if (mirrorNewer) {
        // IndexedDB falta o va por detrás (se cerró antes de terminar de
        // guardar): se recupera el espejo, guardando antes lo que hubiera.
        if (raw) await createRestorePoint(raw, "Antes de recuperar cambios de la copia espejo", "pre-action").catch(() => undefined);
        raw = mirror!.data;
        await writeDirect(raw, Math.max(knownRev, mirror!.meta.rev) + 1);
        recoveredFromMirror = true;
      } else if (!raw) {
        const legacy = readLegacy();
        if (legacy) {
          await writeDirect(legacy, 1);
          // Se verifica leyendo de vuelta antes de dar la migración por buena.
          const check = await req(idb.transaction(KV).objectStore(KV).get(DB_KEY));
          if (check) {
            raw = legacy;
            migratedFromLocalStorage = true;
          }
        }
      }
      if (!raw) {
        // La base desapareció pero quedan copias verificadas: se recupera la
        // más reciente en lugar de empezar de cero con datos de ejemplo.
        for (const p of await listRestorePoints()) {
          try {
            const data = (await readRestorePoint(p.id)) as Record<string, unknown> | null;
            if (data) {
              raw = data;
              await writeDirect(raw, knownRev + 1);
              recoveredFromRestorePoint = p.at;
              break;
            }
          } catch {
            /* copia dañada: se prueba la siguiente */
          }
        }
      }
    } catch {
      // IndexedDB inutilizable (modo privado antiguo, bloqueo): localStorage,
      // con la copia más reciente disponible (espejo antes que la antigua).
      idb = null;
      kind = "localStorage";
      degraded = true;
      raw = mirror?.data ?? readLegacy();
      knownRev = readLsRev();
    }
  } else {
    raw = readLegacy();
    knownRev = readLsRev();
  }

  base = raw;
  setStatus({ rev: knownRev, mirror: kind === "indexeddb" ? (mirror ? "ok" : "off") : "off", mirrorSavedAt: mirror?.meta.savedAt ?? null });
  listenOtherTabs();
  return { raw, info: { ...(await storageEstimate()), kind, migratedFromLocalStorage, recoveredFromMirror, recoveredFromRestorePoint, degraded } };
}

async function writeDirect(data: unknown, rev: number): Promise<void> {
  const tx = idb!.transaction(KV, "readwrite");
  tx.objectStore(KV).put(data, DB_KEY);
  tx.objectStore(KV).put({ rev, savedAt: new Date().toISOString(), tabId }, META_KEY);
  await done(tx);
  knownRev = rev;
}

function readLegacy(): Record<string, unknown> | null {
  try {
    const s = localStorage.getItem(LEGACY_LS_KEY);
    return s ? (JSON.parse(s) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readLsRev(): number {
  try {
    return Number(localStorage.getItem(LS_REV_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Pide al navegador que no borre los datos por falta de espacio o
 * inactividad. En iOS las PWA instaladas ya están exentas del borrado por
 * inactividad de Safari; en escritorio evita la limpieza automática.
 */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageEstimate(): Promise<Omit<StorageInfo, "kind" | "migratedFromLocalStorage">> {
  try {
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
  } catch {
    return { persisted: null, usage: null, quota: null };
  }
}

/* ------------------------------------------------------------ escritura */

/**
 * Pide guardar la base. Las escrituras se agrupan (un único escritor guarda
 * siempre el estado más reciente) y cada una comprueba que nadie escribió
 * entre medias; si otra pestaña lo hizo, se fusiona en vez de sobrescribir.
 * Los errores no pasan en silencio: `gt:storage-error` y estado "error".
 */
export function persistDb(db: unknown): void {
  latest = db;
  if (kind === "indexeddb" && idb) {
    dirty = true;
    setStatus({ state: "saving" });
    if (!writing) writing = runWriter();
    return;
  }
  // localStorage: síncrono; si no cabe, el llamador recibe la excepción.
  writeLocalStorage(db);
}

function writeLocalStorage(db: unknown): void {
  let toWrite = db;
  const storedRev = readLsRev();
  if (storedRev !== knownRev && mergeFn) {
    // Otra pestaña escribió: se fusiona con lo guardado.
    const theirs = readLegacy();
    toWrite = mergeFn(base, db, theirs);
    if (toWrite !== db) hooks?.replace(toWrite);
  }
  const rev = Math.max(storedRev, knownRev) + 1;
  try {
    localStorage.setItem(LEGACY_LS_KEY, JSON.stringify(toWrite));
  } catch (e) {
    setStatus({ state: "error", error: describeStorageError(e) });
    throw e;
  }
  try {
    localStorage.setItem(LS_REV_KEY, String(rev));
  } catch {
    /* sin la revisión se pierde solo la detección entre pestañas */
  }
  knownRev = rev;
  base = toWrite;
  setStatus({ state: "saved", lastSavedAt: new Date().toISOString(), error: null, rev });
}

let RETRY_DELAYS = [500, 2000, 5000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runWriter(): Promise<void> {
  try {
    while (dirty) {
      dirty = false;
      try {
        await writeOnce();
        failures = 0;
        setStatus({ state: dirty ? "saving" : "saved", lastSavedAt: new Date().toISOString(), error: null, retrying: false, rev: knownRev });
        broadcast();
        scheduleMirror();
      } catch (e) {
        dirty = true; // lo pendiente sigue pendiente: nada se descarta
        const msg = describeStorageError(e);
        if (failures < RETRY_DELAYS.length) {
          setStatus({ state: "saving", retrying: true, error: msg });
          await sleep(RETRY_DELAYS[failures++]);
          continue;
        }
        failures = 0;
        setStatus({ state: "error", retrying: false, error: msg });
        // Mientras IndexedDB falla, el espejo guarda lo que se pueda.
        writeMirror(hooks?.current() ?? latest, knownRev, true);
        reportError(msg);
        return;
      }
    }
  } finally {
    writing = null;
  }
}

/** Una escritura: comprueba la revisión y, si otra pestaña escribió, fusiona. */
function writeOnce(): Promise<void> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = idb!.transaction(KV, "readwrite");
    } catch (e) {
      reject(e);
      return;
    }
    const store = tx.objectStore(KV);
    let outcome: { rev: number; stored: unknown; oursUsed: unknown; merged: boolean } | null = null;
    // Una excepción dentro de un callback aborta la transacción sin causa:
    // se guarda para informar del motivo real (p. ej. cuota llena).
    let failure: unknown = null;
    const guard = (fn: () => void) => () => {
      try {
        fn();
      } catch (e) {
        failure = e;
        try {
          tx.abort();
        } catch {
          /* ya abortada */
        }
      }
    };
    const metaReq = store.get(META_KEY);
    metaReq.onsuccess = guard(() => {
      const storedRev = Number((metaReq.result as { rev?: number } | undefined)?.rev) || 0;
      const ours = hooks?.current() ?? latest;
      if (storedRev === knownRev || !mergeFn) {
        store.put(ours, DB_KEY);
        store.put({ rev: storedRev + 1, savedAt: new Date().toISOString(), tabId }, META_KEY);
        outcome = { rev: storedRev + 1, stored: ours, oursUsed: ours, merged: false };
        return;
      }
      const dbReq = store.get(DB_KEY);
      dbReq.onsuccess = guard(() => {
        const merged = mergeFn!(base, ours, dbReq.result ?? null);
        store.put(merged, DB_KEY);
        store.put({ rev: storedRev + 1, savedAt: new Date().toISOString(), tabId }, META_KEY);
        outcome = { rev: storedRev + 1, stored: merged, oursUsed: ours, merged: true };
      });
    });
    tx.oncomplete = () => {
      const o = outcome!;
      knownRev = o.rev;
      base = o.stored;
      if (o.merged) {
        // Cambios hechos en memoria mientras se fusionaba: se conservan.
        const now = hooks?.current();
        const next = now === o.oursUsed || !mergeFn ? o.stored : mergeFn(o.oursUsed, now, o.stored);
        hooks?.replace(next);
        if (next !== o.stored) dirty = true;
      }
      resolve();
    };
    tx.onerror = () => reject(failure ?? tx.error);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("Transacción abortada"));
  });
}

function describeStorageError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "QuotaExceededError" || /quota/i.test(String((e as Error)?.message))) {
    return "No queda espacio en el almacenamiento del navegador";
  }
  return e instanceof Error && e.message ? e.message : "Error desconocido del almacenamiento";
}

function reportError(message: string) {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("gt:storage-error", { detail: message }));
  }
}

/** Espera a que terminen las escrituras en curso (antes de recargar o actualizar). */
export async function flushStorage(): Promise<void> {
  while (writing) await writing.catch(() => undefined);
}

/* ---------------------------------------------------- varias pestañas */

function broadcast(): void {
  try {
    channel?.postMessage({ type: "saved", rev: knownRev, tabId });
  } catch {
    /* sin canal: se comprueba al volver a la pestaña */
  }
}

let storageListener: ((e: StorageEvent) => void) | null = null;

function listenOtherTabs(): void {
  // Sin IndexedDB, el aviso llega por el evento `storage` de localStorage.
  if (!storageListener && typeof window !== "undefined" && typeof window.addEventListener === "function") {
    storageListener = (e: StorageEvent) => {
      if (e.key === LS_REV_KEY && kind === "localStorage") void checkForExternalChanges();
    };
    window.addEventListener("storage", storageListener);
  }
  if (channel || typeof BroadcastChannel === "undefined") return;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (ev) => {
      if (ev.data?.type === "saved" && ev.data.tabId !== tabId && ev.data.rev > knownRev) void checkForExternalChanges();
    };
  } catch {
    channel = null;
  }
}

/**
 * Si otra pestaña guardó algo más reciente, esta recarga los datos (sin
 * escribir). Con cambios propios pendientes no hace falta: el escritor los
 * fusionará al guardar.
 */
export async function checkForExternalChanges(): Promise<boolean> {
  if (kind === "localStorage") {
    const rev = readLsRev();
    if (rev <= knownRev || dirty) return false;
    const theirs = readLegacy();
    if (!theirs) return false;
    knownRev = rev;
    base = theirs;
    hooks?.replace(theirs);
    setStatus({ rev });
    return true;
  }
  if (!idb || dirty || writing) return false;
  const store = idb.transaction(KV).objectStore(KV);
  const meta = (await req(store.get(META_KEY))) as { rev?: number } | undefined;
  const rev = Number(meta?.rev) || 0;
  if (rev <= knownRev) return false;
  const theirs = await req(idb.transaction(KV).objectStore(KV).get(DB_KEY));
  if (!theirs || dirty || writing) return false;
  knownRev = rev;
  base = theirs;
  hooks?.replace(theirs);
  setStatus({ rev });
  return true;
}

/* ----------------------------------------------------- clave-valor local */

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  if (kind === "indexeddb" && idb) {
    try {
      const v = await req(idb.transaction(KV).objectStore(KV).get(`meta:${key}`));
      return (v as T | undefined) ?? fallback;
    } catch {
      return fallback;
    }
  }
  try {
    const s = localStorage.getItem(LS_KV_PREFIX + key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  if (kind === "indexeddb" && idb) {
    const tx = idb.transaction(KV, "readwrite");
    tx.objectStore(KV).put(value, `meta:${key}`);
    await done(tx);
    return;
  }
  localStorage.setItem(LS_KV_PREFIX + key, JSON.stringify(value));
}

/* -------------------------------------------------- puntos de restauración */

const memoryRestore: (RestorePoint & { data: unknown })[] = [];

export interface RetentionPolicy {
  /** Copias automáticas y previas a acciones que se conservan. */
  maxAuto: number;
  /** Copias creadas a mano que se conservan. */
  maxManual: number;
}

let retention: RetentionPolicy = { maxAuto: 12, maxManual: 20 };

export function setRetention(p: Partial<RetentionPolicy>): void {
  retention = {
    maxAuto: Math.min(50, Math.max(3, Math.round(p.maxAuto ?? retention.maxAuto))),
    maxManual: Math.min(50, Math.max(1, Math.round(p.maxManual ?? retention.maxManual))),
  };
}

export function checksumOf(data: unknown): string {
  return stableHash(JSON.stringify(data));
}

/**
 * Guarda una copia íntegra de la base y la VERIFICA leyéndola de vuelta. Si
 * la escritura no se puede comprobar, la copia se descarta y se lanza un
 * error: nunca se da por hecha una copia que no existe. Se conservan las
 * últimas N de cada tipo (ver `setRetention`); las anteriores se retiran
 * solo después de que la nueva esté verificada.
 */
export async function createRestorePoint(data: unknown, reason: string, pointKind: RestoreKind = "pre-action"): Promise<RestorePoint> {
  const json = JSON.stringify(data);
  const checksum = stableHash(json);
  const entry = {
    at: new Date().toISOString(),
    reason,
    kind: pointKind,
    version: Number((data as { version?: number })?.version) || 0,
    size: json.length,
    checksum,
    verified: false,
    data,
  };
  if (kind === "indexeddb" && idb) {
    const tx = idb.transaction(RESTORE, "readwrite");
    const addReq = tx.objectStore(RESTORE).add(entry);
    await done(tx);
    const id = Number(addReq.result);
    const back = (await req(idb.transaction(RESTORE).objectStore(RESTORE).get(id))) as { data: unknown } | undefined;
    if (!back || checksumOf(back.data) !== checksum) {
      const del = idb.transaction(RESTORE, "readwrite");
      del.objectStore(RESTORE).delete(id);
      await done(del).catch(() => undefined);
      throw new Error("La copia no se pudo verificar tras guardarla");
    }
    const fix = idb.transaction(RESTORE, "readwrite");
    fix.objectStore(RESTORE).put({ ...entry, id, verified: true });
    await done(fix);
    await prune();
    const { data: _d, ...meta } = { ...entry, id, verified: true };
    return meta;
  }
  const point = { ...entry, id: (memoryRestore[0]?.id ?? 0) + 1, verified: true };
  memoryRestore.unshift(point);
  const autos = memoryRestore.filter((p) => p.kind !== "manual");
  for (const extra of autos.slice(retention.maxAuto)) memoryRestore.splice(memoryRestore.indexOf(extra), 1);
  const { data: _d, ...meta } = point;
  return meta;
}

async function prune(): Promise<void> {
  const all = await listRestorePoints();
  const manual = all.filter((p) => p.kind === "manual");
  const others = all.filter((p) => p.kind !== "manual");
  const extra = [...manual.slice(retention.maxManual), ...others.slice(retention.maxAuto)];
  if (!extra.length || !idb) return;
  const tx = idb.transaction(RESTORE, "readwrite");
  for (const p of extra) tx.objectStore(RESTORE).delete(p.id);
  await done(tx);
}

export async function listRestorePoints(): Promise<RestorePoint[]> {
  if (kind === "indexeddb" && idb) {
    const rows = (await req(idb.transaction(RESTORE).objectStore(RESTORE).getAll())) as (RestorePoint & { data: unknown })[];
    return rows.map(({ data: _data, ...meta }) => ({ kind: "pre-action" as RestoreKind, ...meta })).sort((a, b) => b.id - a.id);
  }
  return memoryRestore.map(({ data: _data, ...meta }) => meta);
}

/** Lee una copia y comprueba su integridad (si tiene suma de comprobación). */
export async function readRestorePoint(id: number): Promise<unknown | null> {
  let row: (RestorePoint & { data: unknown }) | undefined;
  if (kind === "indexeddb" && idb) {
    row = (await req(idb.transaction(RESTORE).objectStore(RESTORE).get(id))) as (RestorePoint & { data: unknown }) | undefined;
  } else {
    row = memoryRestore.find((p) => p.id === id);
  }
  if (!row) return null;
  if (row.checksum && checksumOf(row.data) !== row.checksum) throw new Error("La copia está dañada (la suma de comprobación no coincide)");
  return row.data;
}

export async function deleteRestorePoint(id: number): Promise<void> {
  if (kind === "indexeddb" && idb) {
    const tx = idb.transaction(RESTORE, "readwrite");
    tx.objectStore(RESTORE).delete(id);
    await done(tx);
    return;
  }
  const i = memoryRestore.findIndex((p) => p.id === id);
  if (i >= 0) memoryRestore.splice(i, 1);
}

/** Solo para pruebas: cierra y olvida la conexión. */
export function __resetStorageForTests(): void {
  idb?.close();
  idb = null;
  kind = "localStorage";
  knownRev = 0;
  base = null;
  latest = null;
  dirty = false;
  writing = null;
  failures = 0;
  mergeFn = null;
  channel?.close();
  channel = null;
  if (mirrorTimer) clearTimeout(mirrorTimer);
  mirrorTimer = null;
  memoryRestore.splice(0);
  status = { state: "idle", lastSavedAt: null, error: null, retrying: false, rev: 0, mirror: "off", mirrorSavedAt: null };
}

/** Solo para pruebas: la conexión IndexedDB abierta (para simular otra pestaña o fallos). */
export function __idbForTests(): IDBDatabase | null {
  return idb;
}

/** Solo para pruebas. */
export function __tuneForTests(opts: { retryDelays?: number[]; mirrorMaxChars?: number }): void {
  if (opts.retryDelays) RETRY_DELAYS = opts.retryDelays;
  if (opts.mirrorMaxChars) mirrorMaxChars = opts.mirrorMaxChars;
}
