/**
 * Espacio de claves de los datos: cada dato de la app se ve como una entrada
 * `colección:id` con su contenido y una huella (hash) de ese contenido.
 *
 * Lo usan la fusión entre pestañas (persistence/merge.ts: comparar huellas
 * dice qué fila cambió cada pestaña) y las copias de seguridad (suma de
 * comprobación con `canonical` + `hashString`).
 *
 * Además de las colecciones normales:
 *  - `taskTags:<tareaId>`: las etiquetas de una tarea como un conjunto (la
 *    tabla puente no tiene id propio).
 *  - `settings:shared`: los ajustes generales (nombre, idioma, moneda…). El
 *    PIN, el tema y los avisos se tratan aparte.
 *  - borrados: una lápida se representa con la huella especial `DELETED`.
 */

import { SYNCED_COLLECTIONS, type Db, type SyncedCollection } from "@/services/localDb";

export const DELETED = "†";

export type EntryCollection = SyncedCollection | "taskTags" | "settings";

export interface Entry {
  key: string;
  collection: EntryCollection;
  id: string;
  /** null = borrado. */
  row: Record<string, unknown> | null;
  deletedAt?: string;
  hash: string;
}

/** Ajustes generales (no propios de la pantalla o del dispositivo). */
const SHARED_SETTINGS = [
  "appName",
  "appLogo",
  "userName",
  "language",
  "dateFormat",
  "timezone",
  "currency",
] as const;

export function keyOf(collection: string, id: string): string {
  return `${collection}:${id}`;
}

export function splitKey(key: string): { collection: EntryCollection; id: string } {
  const i = key.indexOf(":");
  return { collection: key.slice(0, i) as EntryCollection, id: key.slice(i + 1) };
}

/** JSON con claves ordenadas: mismo contenido => misma cadena en todo dispositivo. */
export function canonical(v: unknown): string {
  const norm = (x: any): any =>
    Array.isArray(x)
      ? x.map(norm)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.keys(x)
              .filter((k) => x[k] !== undefined)
              .sort()
              .map((k) => [k, norm(x[k])])
          )
        : x;
  return JSON.stringify(norm(v));
}

/** Hash no criptográfico de 106 bits (dos cyrb53 con semillas distintas). */
export function hashString(str: string): string {
  const cyrb = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };
  return `${cyrb(0)}${cyrb(0x9e3779b9)}`;
}

function hashRow(row: unknown): string {
  return hashString(canonical(row));
}

/** Todas las entradas de una base (filas vivas, conjuntos de etiquetas, ajustes y borrados). */
export function entriesOf(db: Db): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const alive = new Set<string>();

  for (const c of SYNCED_COLLECTIONS) {
    for (const row of (db[c] ?? []) as unknown as Record<string, unknown>[]) {
      const id = String(row.id);
      const key = keyOf(c, id);
      alive.add(key);
      out.set(key, { key, collection: c, id, row, hash: hashRow(row) });
    }
  }

  const tagsByTask = new Map<string, string[]>();
  for (const tt of db.taskTags ?? []) tagsByTask.set(tt.taskId, [...(tagsByTask.get(tt.taskId) ?? []), tt.tagId]);
  for (const t of db.tasks ?? []) {
    const tagIds = [...new Set(tagsByTask.get(t.id) ?? [])].sort();
    const row = { id: t.id, tagIds };
    const key = keyOf("taskTags", t.id);
    out.set(key, { key, collection: "taskTags", id: t.id, row, hash: hashRow(row) });
  }

  const shared: Record<string, unknown> = { id: "shared" };
  for (const k of SHARED_SETTINGS) shared[k] = (db.settings as unknown as Record<string, unknown>)?.[k] ?? null;
  out.set("settings:shared", { key: "settings:shared", collection: "settings", id: "shared", row: shared, hash: hashRow(shared) });

  for (const t of db.tombstones ?? []) {
    const key = keyOf(t.collection, t.id);
    if (alive.has(key)) continue;
    out.set(key, { key, collection: t.collection as EntryCollection, id: t.id, row: null, deletedAt: t.deletedAt, hash: DELETED });
    // Las etiquetas de una tarea borrada también desaparecen.
    if (t.collection === "tasks" && !out.has(keyOf("taskTags", t.id))) {
      const k2 = keyOf("taskTags", t.id);
      out.set(k2, { key: k2, collection: "taskTags", id: t.id, row: null, deletedAt: t.deletedAt, hash: DELETED });
    }
  }
  return out;
}

/** Huella "vista desde fuera": ausente y borrado significan lo mismo. */
export function norm(h: string | undefined): string {
  return h === undefined ? DELETED : h;
}
