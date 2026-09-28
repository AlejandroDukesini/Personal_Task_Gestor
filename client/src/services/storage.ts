/**
 * Almacenamiento persistente del dispositivo.
 *
 * Por qué IndexedDB y no localStorage:
 *  - localStorage está limitado a ~5 MB en Safari: con finanzas, logos y
 *    restauraciones se agotaba y la escritura fallaba.
 *  - localStorage es síncrono y serializa todo a texto en cada escritura.
 *  - IndexedDB guarda objetos estructurados, admite cientos de MB y es el
 *    almacenamiento que iOS conserva para las PWA instaladas.
 *
 * Modelo: la base completa vive en memoria (`localDb` la lee de forma
 * síncrona, como siempre) y cada escritura se persiste en IndexedDB. Una
 * transacción IDB clona el objeto en el momento de `put`, así que el estado
 * guardado es exactamente el de ese instante aunque la memoria cambie después.
 *
 * Si IndexedDB no existe (navegador muy antiguo, pruebas en Node) se usa
 * localStorage como hasta ahora: la app nunca se queda sin guardar.
 *
 * Además de la base, aquí viven:
 *  - puntos de restauración automáticos (antes de migrar, importar,
 *    restaurar o sincronizar), para recuperarse de un error;
 *  - un almacén clave-valor para metadatos locales del dispositivo
 *    (dispositivos emparejados, bases de sincronización, historial), que
 *    NUNCA se sincronizan ni se exportan en las copias de datos.
 */

const IDB_NAME = "gestion-tareas";
const IDB_VERSION = 1;
const KV = "kv";
const RESTORE = "restore";
const DB_KEY = "db";
const LEGACY_LS_KEY = "gestion-tareas:db";
const LS_KV_PREFIX = "gestion-tareas:kv:";
const MAX_RESTORE_POINTS = 8;

export type StorageKind = "indexeddb" | "localStorage";

export interface StorageInfo {
  kind: StorageKind;
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
  migratedFromLocalStorage: boolean;
}

export interface RestorePoint {
  id: number;
  at: string;
  reason: string;
  version: number;
  size: number;
}

let idb: IDBDatabase | null = null;
let kind: StorageKind = "localStorage";
let pending = 0;
let lastWrite: Promise<void> = Promise.resolve();
const waiters: (() => void)[] = [];

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

/* ------------------------------------------------------------ arranque */

/**
 * Abre el almacenamiento y devuelve la base guardada (sin migrar), o null si
 * no hay nada. La primera vez con IndexedDB copia lo que hubiera en
 * localStorage y deja la copia antigua intacta como red de seguridad.
 */
export async function openStorage(): Promise<{ raw: Record<string, unknown> | null; info: StorageInfo }> {
  let migratedFromLocalStorage = false;
  let raw: Record<string, unknown> | null = null;

  if (hasIdb()) {
    try {
      idb = await open();
      kind = "indexeddb";
      raw = ((await req(idb.transaction(KV).objectStore(KV).get(DB_KEY))) as Record<string, unknown> | undefined) ?? null;
      if (!raw) {
        const legacy = readLegacy();
        if (legacy) {
          const tx = idb.transaction(KV, "readwrite");
          tx.objectStore(KV).put(legacy, DB_KEY);
          await done(tx);
          // Se verifica leyendo de vuelta antes de dar la migración por buena.
          const check = await req(idb.transaction(KV).objectStore(KV).get(DB_KEY));
          if (check) {
            raw = legacy;
            migratedFromLocalStorage = true;
          }
        }
      }
    } catch {
      // IndexedDB inutilizable (modo privado antiguo, bloqueo): localStorage.
      idb = null;
      kind = "localStorage";
      raw = readLegacy();
    }
  } else {
    raw = readLegacy();
  }

  return { raw, info: { ...(await storageEstimate()), kind, migratedFromLocalStorage } };
}

function readLegacy(): Record<string, unknown> | null {
  try {
    const s = localStorage.getItem(LEGACY_LS_KEY);
    return s ? (JSON.parse(s) as Record<string, unknown>) : null;
  } catch {
    return null;
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
 * Persiste la base. Con IndexedDB la escritura es asíncrona pero ordenada
 * (las transacciones sobre el mismo almacén se ejecutan en orden). Los
 * errores no pueden pasar en silencio: se emite `gt:storage-error` para que
 * la interfaz avise de que los cambios no se están guardando.
 */
export function persistDb(db: unknown): void {
  if (kind === "indexeddb" && idb) {
    pending++;
    let tx: IDBTransaction;
    try {
      tx = idb.transaction(KV, "readwrite");
      tx.objectStore(KV).put(db, DB_KEY);
    } catch (e) {
      pending--;
      reportError(e);
      return;
    }
    lastWrite = done(tx)
      .catch(reportError)
      .finally(() => {
        pending = Math.max(0, pending - 1);
        if (pending === 0) waiters.splice(0).forEach((fn) => fn());
      });
    return;
  }
  // localStorage: síncrono; si no cabe, el llamador recibe la excepción.
  localStorage.setItem(LEGACY_LS_KEY, JSON.stringify(db));
}

function reportError(e: unknown) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("gt:storage-error", { detail: e instanceof Error ? e.message : String(e) }));
  }
}

/** Espera a que terminen las escrituras en curso (antes de recargar o actualizar). */
export function flushStorage(): Promise<void> {
  if (pending <= 0) return lastWrite.catch(() => undefined);
  return new Promise((resolve) => waiters.push(resolve));
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

/**
 * Guarda una copia íntegra de la base antes de una operación crítica.
 * Se conservan las últimas `MAX_RESTORE_POINTS`.
 */
export async function createRestorePoint(data: unknown, reason: string): Promise<void> {
  const entry = {
    at: new Date().toISOString(),
    reason,
    version: Number((data as { version?: number })?.version) || 0,
    size: approxSize(data),
    data,
  };
  if (kind === "indexeddb" && idb) {
    const tx = idb.transaction(RESTORE, "readwrite");
    const store = tx.objectStore(RESTORE);
    store.add(entry);
    await done(tx);
    const all = (await listRestorePoints()).sort((a, b) => b.id - a.id);
    const extra = all.slice(MAX_RESTORE_POINTS);
    if (extra.length) {
      const tx2 = idb.transaction(RESTORE, "readwrite");
      for (const p of extra) tx2.objectStore(RESTORE).delete(p.id);
      await done(tx2);
    }
    return;
  }
  memoryRestore.unshift({ ...entry, id: (memoryRestore[0]?.id ?? 0) + 1 });
  memoryRestore.splice(MAX_RESTORE_POINTS);
}

export async function listRestorePoints(): Promise<RestorePoint[]> {
  if (kind === "indexeddb" && idb) {
    const rows = (await req(idb.transaction(RESTORE).objectStore(RESTORE).getAll())) as (RestorePoint & { data: unknown })[];
    return rows.map(({ data: _data, ...meta }) => meta).sort((a, b) => b.id - a.id);
  }
  return memoryRestore.map(({ data: _data, ...meta }) => meta);
}

export async function readRestorePoint(id: number): Promise<unknown | null> {
  if (kind === "indexeddb" && idb) {
    const row = (await req(idb.transaction(RESTORE).objectStore(RESTORE).get(id))) as { data: unknown } | undefined;
    return row?.data ?? null;
  }
  return memoryRestore.find((p) => p.id === id)?.data ?? null;
}

function approxSize(v: unknown): number {
  try {
    return JSON.stringify(v).length;
  } catch {
    return 0;
  }
}

/** Solo para pruebas: cierra y olvida la conexión. */
export function __resetStorageForTests(): void {
  idb?.close();
  idb = null;
  kind = "localStorage";
  memoryRestore.splice(0);
}
