/**
 * Rutas locales del módulo de notas (mismo patrón que tareas y finanzas).
 *
 * - Toda escritura pasa por `mutate` (atómica: si algo falla, no se escribe nada).
 * - El contenido se sanea SIEMPRE en el servidor local antes de guardarlo y
 *   se deriva su texto plano para búsquedas y vistas previas.
 * - Borrar una nota la manda a la papelera (`deletedAt`); solo «eliminar
 *   definitivamente» la quita y deja una lápida para la sincronización.
 * - Los binarios de los adjuntos no se tocan aquí: las rutas devuelven qué
 *   archivos han quedado sin ninguna nota que los use y el cliente los borra
 *   de su almacén (ver `files.ts`).
 */

import {
  ApiError,
  loadDb,
  mutate,
  newId,
  nowIso,
  tombstone,
  type Db,
  type NoteCategoryRow,
  type NoteRow,
} from "@/services/localDb";
import { created, find, noContent, ok, parse, type Route } from "@/services/routeKit";
import { docToText, EMPTY_DOC, sanitizeDoc, withCalculatedResults } from "./content";
import { DEFAULT_NOTE_ICON, NOTE_COLORS } from "./icons";
import { queryNotes, type NoteQuery } from "./query";
import { deleteCategoryInput, MAX_NOTE_TEXT, noteCategoryInput, noteInput } from "./schemas";

/** Archivos que ya no usa ninguna nota (incluidas las de la papelera). */
export function orphanFileKeys(db: Db, candidates: string[]): string[] {
  const used = new Set(db.notes.flatMap((n) => n.attachments.map((a) => a.fileKey)));
  return [...new Set(candidates)].filter((k) => !used.has(k));
}

/** Categoría y subcategoría coherentes: la subcategoría debe colgar de la categoría. */
function resolveCategories(db: Db, categoryId: string | null | undefined, subcategoryId: string | null | undefined): { categoryId: string | null; subcategoryId: string | null } {
  let cat = categoryId ? find(db.noteCategories, categoryId, "Categoría") : null;
  const sub = subcategoryId ? find(db.noteCategories, subcategoryId, "Subcategoría") : null;
  if (cat?.parentId) throw new ApiError(400, "La categoría elegida es una subcategoría");
  if (sub) {
    if (!sub.parentId) throw new ApiError(400, "La subcategoría elegida es una categoría principal");
    if (cat && sub.parentId !== cat.id) throw new ApiError(400, "La subcategoría no pertenece a la categoría elegida");
    cat ??= find(db.noteCategories, sub.parentId, "Categoría");
  }
  return { categoryId: cat?.id ?? null, subcategoryId: sub?.id ?? null };
}

/** Contenido saneado y su texto plano (con los resultados de los cálculos, para buscar y previsualizar). */
function withContent(content: unknown, math: { enabled: boolean; decimals: number | null }) {
  const doc = sanitizeDoc(content ?? EMPTY_DOC);
  return { content: doc, text: docToText(withCalculatedResults(doc, math)).slice(0, MAX_NOTE_TEXT) };
}

function readQuery(params: URLSearchParams): NoteQuery {
  const get = (k: string) => params.get(k) ?? undefined;
  const cat = params.get("categoryId");
  return {
    q: get("q"),
    status: (get("status") as NoteQuery["status"]) ?? "active",
    categoryId: cat === null ? undefined : cat === "none" ? null : cat,
    subcategoryId: get("subcategoryId"),
    from: get("from"),
    to: get("to"),
    dateField: get("dateField") === "createdAt" ? "createdAt" : "updatedAt",
    hasAttachments: params.get("hasAttachments") === "1",
    sort: (get("sort") as NoteQuery["sort"]) ?? "updated",
    dir: get("dir") === "asc" ? "asc" : "desc",
    offset: Number(get("offset") ?? 0) || 0,
    limit: Number(get("limit") ?? 0) || undefined,
  };
}

function activeNote(db: Db, id: string): NoteRow {
  const n = find(db.notes, id, "Nota");
  if (n.deletedAt) throw new ApiError(409, "La nota está en la papelera: restáurala para editarla");
  return n;
}

export const notesRoutes: Route[] = [
  /* ---------------------------------------------------------- categorías */
  ["GET", "/notes/categories", () => {
    const db = loadDb();
    const count = (id: string) => db.notes.filter((n) => !n.deletedAt && (n.categoryId === id || n.subcategoryId === id)).length;
    return ok(db.noteCategories.map((c) => ({ ...c, noteCount: count(c.id) })));
  }],
  ["POST", "/notes/categories", ({ body }) => {
    const data = parse(noteCategoryInput, body);
    return created(
      mutate((db) => {
        const parent = data.parentId ? find(db.noteCategories, data.parentId, "Categoría principal") : null;
        if (parent?.parentId) throw new ApiError(400, "Solo hay un nivel de subcategorías");
        const siblings = db.noteCategories.filter((c) => (c.parentId ?? null) === (parent?.id ?? null));
        if (siblings.some((c) => c.name.toLowerCase() === data.name.toLowerCase())) throw new ApiError(409, "Ya existe una categoría con ese nombre aquí");
        const ts = nowIso();
        const row: NoteCategoryRow = {
          id: newId(),
          name: data.name,
          color: data.color ?? parent?.color ?? NOTE_COLORS[7],
          icon: data.icon ?? parent?.icon ?? "Tag",
          parentId: parent?.id ?? null,
          createdAt: ts,
          updatedAt: ts,
        };
        db.noteCategories.push(row);
        return row;
      })
    );
  }],
  ["PUT", "/notes/categories/:id", ({ params, body }) => {
    const data = parse(noteCategoryInput.partial(), body);
    return ok(
      mutate((db) => {
        const c = find(db.noteCategories, params.id, "Categoría");
        if (data.parentId !== undefined && data.parentId !== c.parentId) {
          if (data.parentId === c.id) throw new ApiError(400, "Una categoría no puede ser su propia subcategoría");
          if (data.parentId) {
            const parent = find(db.noteCategories, data.parentId, "Categoría principal");
            if (parent.parentId) throw new ApiError(400, "Solo hay un nivel de subcategorías");
            if (db.noteCategories.some((x) => x.parentId === c.id)) throw new ApiError(409, "Tiene subcategorías: no puede convertirse en subcategoría");
          }
          // Las notas siguen coherentes: la categoría de las que la usaban se ajusta.
          for (const n of db.notes) {
            if (data.parentId && n.categoryId === c.id) Object.assign(n, { categoryId: data.parentId, subcategoryId: c.id, updatedAt: nowIso() });
            else if (!data.parentId && n.subcategoryId === c.id) Object.assign(n, { categoryId: c.id, subcategoryId: null, updatedAt: nowIso() });
          }
          c.parentId = data.parentId;
        }
        if (data.name !== undefined) {
          const dup = db.noteCategories.some((x) => x.id !== c.id && (x.parentId ?? null) === (c.parentId ?? null) && x.name.toLowerCase() === data.name!.toLowerCase());
          if (dup) throw new ApiError(409, "Ya existe una categoría con ese nombre aquí");
          c.name = data.name;
        }
        if (data.color !== undefined) c.color = data.color;
        if (data.icon !== undefined) c.icon = data.icon;
        c.updatedAt = nowIso();
        return c;
      })
    );
  }],
  /**
   * Borrar una categoría (y sus subcategorías). Sus notas NO se pierden sin
   * querer: el usuario elige reasignarlas, dejarlas sin categoría o mandarlas
   * a la papelera (de donde se pueden recuperar).
   */
  ["POST", "/notes/categories/:id/delete", ({ params, body }) => {
    const { strategy, targetId } = parse(deleteCategoryInput, body);
    return ok(
      mutate((db) => {
        const c = find(db.noteCategories, params.id, "Categoría");
        const removed = new Set([c.id, ...db.noteCategories.filter((x) => x.parentId === c.id).map((x) => x.id)]);
        let target: { categoryId: string | null; subcategoryId: string | null } | null = null;
        if (strategy === "reassign") {
          if (!targetId || removed.has(targetId)) throw new ApiError(400, "Elige otra categoría de destino");
          const t = find(db.noteCategories, targetId, "Categoría de destino");
          target = t.parentId ? { categoryId: t.parentId, subcategoryId: t.id } : { categoryId: t.id, subcategoryId: null };
        }
        const ts = nowIso();
        let affected = 0;
        for (const n of db.notes) {
          const hitsCategory = n.categoryId !== null && removed.has(n.categoryId);
          const hitsSub = n.subcategoryId !== null && removed.has(n.subcategoryId);
          if (!hitsCategory && !hitsSub) continue;
          affected++;
          if (target && !n.deletedAt) Object.assign(n, target);
          else if (hitsCategory) Object.assign(n, { categoryId: null, subcategoryId: null });
          else n.subcategoryId = null; // solo se borra la subcategoría: queda en la principal
          if (strategy === "trash" && !n.deletedAt) n.deletedAt = ts;
          n.updatedAt = ts;
        }
        db.noteCategories = db.noteCategories.filter((x) => !removed.has(x.id));
        for (const id of removed) tombstone(db, "noteCategories", id);
        return { deleted: removed.size, affectedNotes: affected };
      })
    );
  }],

  /* --------------------------------------------------------------- notas */
  ["GET", "/notes", ({ query }) => {
    const db = loadDb();
    const res = queryNotes(db.notes, db.noteCategories, readQuery(query));
    const counts = {
      active: db.notes.filter((n) => !n.deletedAt && !n.archived).length,
      archived: db.notes.filter((n) => !n.deletedAt && n.archived).length,
      trash: db.notes.filter((n) => n.deletedAt).length,
    };
    return ok({ ...res, counts });
  }],
  ["GET", "/notes/:id", ({ params }) => ok(find(loadDb().notes, params.id, "Nota"))],
  ["POST", "/notes", ({ body }) => {
    const data = parse(noteInput, body);
    return created(
      mutate((db) => {
        // Id opcional del cliente: crear dos veces lo mismo (doble clic) es idempotente.
        if (data.id) {
          const existing = db.notes.find((n) => n.id === data.id);
          if (existing) return existing;
        }
        const ts = nowIso();
        const row: NoteRow = {
          id: data.id ?? newId(),
          title: data.title,
          description: data.description ?? null,
          ...withContent(data.content, { enabled: data.mathEnabled ?? true, decimals: data.mathDecimals ?? null }),
          ...resolveCategories(db, data.categoryId, data.subcategoryId),
          color: data.color ?? null,
          icon: data.icon ?? DEFAULT_NOTE_ICON,
          attachments: data.attachments ?? [],
          archived: data.archived ?? false,
          deletedAt: null,
          mathEnabled: data.mathEnabled ?? true,
          mathDecimals: data.mathDecimals ?? null,
          createdAt: ts,
          updatedAt: ts,
        };
        db.notes.push(row);
        return row;
      })
    );
  }],
  ["PUT", "/notes/:id", ({ params, body }) => {
    const data = parse(noteInput.partial(), body);
    return ok(
      mutate((db) => {
        const n = activeNote(db, params.id);
        const before = n.attachments.map((a) => a.fileKey);
        if (data.title !== undefined) n.title = data.title;
        if (data.description !== undefined) n.description = data.description ?? null;

        if (data.categoryId !== undefined || data.subcategoryId !== undefined) {
          const categoryId = data.categoryId !== undefined ? data.categoryId : n.categoryId;
          // Cambiar de categoría sin decir subcategoría la deja vacía si ya no encaja.
          let subcategoryId = data.subcategoryId !== undefined ? data.subcategoryId : n.subcategoryId;
          if (data.subcategoryId === undefined && subcategoryId && db.noteCategories.find((c) => c.id === subcategoryId)?.parentId !== categoryId) subcategoryId = null;
          Object.assign(n, resolveCategories(db, categoryId, subcategoryId));
        }
        if (data.color !== undefined) n.color = data.color;
        if (data.icon !== undefined) n.icon = data.icon;
        if (data.attachments !== undefined) {
          const ids = new Set<string>();
          for (const a of data.attachments) {
            if (ids.has(a.id)) throw new ApiError(400, "Adjunto repetido");
            ids.add(a.id);
          }
          n.attachments = data.attachments;
        }
        if (data.archived !== undefined) n.archived = data.archived;
        if (data.mathEnabled !== undefined) n.mathEnabled = data.mathEnabled;
        if (data.mathDecimals !== undefined) n.mathDecimals = data.mathDecimals;
        // Tras aplicar los ajustes de cálculo: el texto derivado depende de ellos.
        if (data.content !== undefined || data.mathEnabled !== undefined || data.mathDecimals !== undefined) {
          Object.assign(n, withContent(data.content ?? n.content, { enabled: n.mathEnabled, decimals: n.mathDecimals }));
        }
        n.updatedAt = nowIso();
        return { note: n, orphanFileKeys: orphanFileKeys(db, before) };
      })
    );
  }],
  ["POST", "/notes/:id/duplicate", ({ params }) =>
    created(
      mutate((db) => {
        const src = find(db.notes, params.id, "Nota");
        const ts = nowIso();
        const copy: NoteRow = {
          ...structuredClone(src),
          id: newId(),
          title: `${src.title} (copia)`.slice(0, 200),
          // Mismo archivo (se comparte el binario), adjunto independiente.
          attachments: src.attachments.map((a) => ({ ...a, id: newId() })),
          archived: false,
          deletedAt: null,
          createdAt: ts,
          updatedAt: ts,
        };
        db.notes.push(copy);
        return copy;
      })
    ),
  ],
  ["POST", "/notes/:id/archive", ({ params }) =>
    ok(
      mutate((db) => {
        const n = activeNote(db, params.id);
        n.archived = true;
        n.updatedAt = nowIso();
        return n;
      })
    ),
  ],
  ["POST", "/notes/:id/unarchive", ({ params }) =>
    ok(
      mutate((db) => {
        const n = activeNote(db, params.id);
        n.archived = false;
        n.updatedAt = nowIso();
        return n;
      })
    ),
  ],
  // Borrar = mandar a la papelera (recuperable).
  ["DELETE", "/notes/:id", ({ params }) => {
    mutate((db) => {
      const n = find(db.notes, params.id, "Nota");
      if (!n.deletedAt) {
        n.deletedAt = nowIso();
        n.updatedAt = n.deletedAt;
      }
    });
    return noContent();
  }],
  ["POST", "/notes/:id/restore", ({ params }) =>
    ok(
      mutate((db) => {
        const n = find(db.notes, params.id, "Nota");
        n.deletedAt = null;
        // Si su categoría desapareció mientras estaba en la papelera, queda sin categoría.
        if (n.categoryId && !db.noteCategories.some((c) => c.id === n.categoryId)) n.categoryId = null;
        if (n.subcategoryId && !db.noteCategories.some((c) => c.id === n.subcategoryId)) n.subcategoryId = null;
        n.updatedAt = nowIso();
        return n;
      })
    ),
  ],
  ["DELETE", "/notes/:id/purge", ({ params }) =>
    ok(
      mutate((db) => {
        const n = find(db.notes, params.id, "Nota");
        if (!n.deletedAt) throw new ApiError(409, "Solo se eliminan definitivamente las notas de la papelera");
        db.notes = db.notes.filter((x) => x.id !== n.id);
        tombstone(db, "notes", n.id);
        return { orphanFileKeys: orphanFileKeys(db, n.attachments.map((a) => a.fileKey)) };
      })
    ),
  ],
  ["POST", "/notes/trash/empty", () =>
    ok(
      mutate((db) => {
        const gone = db.notes.filter((n) => n.deletedAt);
        db.notes = db.notes.filter((n) => !n.deletedAt);
        for (const n of gone) tombstone(db, "notes", n.id);
        return { purged: gone.length, orphanFileKeys: orphanFileKeys(db, gone.flatMap((n) => n.attachments.map((a) => a.fileKey))) };
      })
    ),
  ],
];
