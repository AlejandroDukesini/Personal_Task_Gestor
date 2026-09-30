/**
 * Espacio de claves sincronizable: cada dato de la app se ve como una entrada
 * `colección:id` con su contenido y una huella (hash) de ese contenido.
 *
 * Comparar huellas permite saber, sin enviar los datos, qué cambió desde la
 * última sincronización con un dispositivo (su "base"): una fila cuya huella
 * coincide con la base no se ha tocado y no hace falta transferirla.
 *
 * Además de las colecciones normales:
 *  - `taskTags:<tareaId>`: las etiquetas de una tarea como un conjunto (la
 *    tabla puente no tiene id propio).
 *  - `settings:shared`: la parte de los ajustes que tiene sentido compartir
 *    (nombre, idioma, moneda…). El PIN, el tema y los avisos son propios de
 *    cada dispositivo y nunca viajan.
 *  - borrados: una lápida se representa con la huella especial `DELETED`.
 */

import {
  SYNCED_COLLECTIONS,
  FINANCE_COLLECTIONS,
  type Db,
  type SyncedCollection,
} from "@/services/localDb";

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

/** Ajustes que se comparten entre dispositivos. */
export const SHARED_SETTINGS = [
  "appName",
  "appLogo",
  "userName",
  "language",
  "dateFormat",
  "timezone",
  "currency",
] as const;

const FINANCE = new Set<string>(FINANCE_COLLECTIONS);

export function isFinanceCollection(c: string): boolean {
  return FINANCE.has(c);
}

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

export function hashRow(row: unknown): string {
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

export type Manifest = Record<string, string>;

export function manifestOf(entries: Map<string, Entry>): Manifest {
  const m: Manifest = {};
  for (const [k, e] of entries) m[k] = e.hash;
  return m;
}

/** Huella "vista desde fuera": ausente y borrado significan lo mismo. */
export function norm(h: string | undefined): string {
  return h === undefined ? DELETED : h;
}

/* --------------------------------------------------------- referencias */

type Ref = { field: string; target: EntryCollection; many?: boolean };

/**
 * Qué referencia cada colección. Se usa para (a) enviar junto a una fila
 * cambiada las filas de las que depende y (b) no aplicar nunca un borrado que
 * dejaría a otra fila apuntando a algo inexistente.
 */
const REFS: Partial<Record<EntryCollection, Ref[]>> = {
  categories: [{ field: "parentId", target: "categories" }],
  tasks: [
    { field: "categoryId", target: "categories" },
    { field: "goalId", target: "goals" },
  ],
  subtasks: [{ field: "taskId", target: "tasks" }],
  habits: [{ field: "categoryId", target: "categories" }],
  habitLogs: [{ field: "habitId", target: "habits" }],
  events: [{ field: "categoryId", target: "categories" }],
  reminders: [
    { field: "taskId", target: "tasks" },
    { field: "habitId", target: "habits" },
    { field: "eventId", target: "events" },
  ],
  goals: [
    { field: "categoryId", target: "categories" },
    { field: "finGoalId", target: "finGoals" },
  ],
  taskTags: [{ field: "tagIds", target: "tags", many: true }],
  finTransactions: [
    { field: "accountId", target: "finAccounts" },
    { field: "toAccountId", target: "finAccounts" },
    { field: "categoryId", target: "finCategories" },
    { field: "goalId", target: "finGoals" },
  ],
  finRecurring: [
    { field: "accountId", target: "finAccounts" },
    { field: "toAccountId", target: "finAccounts" },
    { field: "categoryId", target: "finCategories" },
  ],
  finBudgets: [
    { field: "categoryIds", target: "finCategories", many: true },
    { field: "accountIds", target: "finAccounts", many: true },
  ],
  finGoals: [{ field: "accountIds", target: "finAccounts", many: true }],
  noteCategories: [{ field: "parentId", target: "noteCategories" }],
  notes: [
    { field: "categoryId", target: "noteCategories" },
    { field: "subcategoryId", target: "noteCategories" },
  ],
};

/** Claves a las que apunta una fila. */
export function referencesOf(collection: EntryCollection, row: Record<string, unknown> | null): string[] {
  if (!row) return [];
  const out: string[] = [];
  for (const r of REFS[collection] ?? []) {
    const v = row[r.field];
    if (r.many && Array.isArray(v)) for (const id of v) out.push(keyOf(r.target, String(id)));
    else if (typeof v === "string" && v) out.push(keyOf(r.target, v));
  }
  // Asignaciones por finalidad -> etiqueta financiera.
  const allocs = row.allocations;
  if (Array.isArray(allocs)) for (const a of allocs) if (a && typeof a.tagId === "string") out.push(keyOf("finTags", a.tagId));
  // Etiqueta financiera -> su presupuesto o meta.
  if (collection === "finTags" && typeof row.ownerId === "string") {
    out.push(keyOf(row.ownerType === "budget" ? "finBudgets" : "finGoals", row.ownerId));
  }
  return out;
}

/** Texto breve para mostrar una entrada al usuario. */
export function labelOf(e: { collection: string; row: Record<string, unknown> | null; id: string }): string {
  const r = e.row;
  if (!r) return e.id;
  const v = r.title ?? r.name ?? r.concept ?? (e.collection === "settings" ? "Ajustes compartidos" : undefined);
  if (v) return String(v).slice(0, 80);
  if (e.collection === "habitLogs") return `Registro del ${String(r.date ?? "").slice(0, 10)}`;
  if (e.collection === "taskTags") return "Etiquetas de una tarea";
  return e.id;
}

export const COLLECTION_LABEL: Record<string, string> = {
  categories: "Categoría",
  tags: "Etiqueta",
  tasks: "Tarea",
  subtasks: "Sub-paso",
  habits: "Hábito",
  habitLogs: "Registro de hábito",
  events: "Evento",
  reminders: "Recordatorio",
  goals: "Objetivo",
  finAccounts: "Cuenta",
  finCategories: "Categoría financiera",
  finTransactions: "Movimiento",
  finBudgets: "Presupuesto",
  finGoals: "Meta de ahorro",
  finRecurring: "Recurrente",
  finTags: "Etiqueta financiera",
  noteCategories: "Categoría de notas",
  notes: "Nota",
  taskTags: "Etiquetas de tarea",
  settings: "Ajustes",
};
