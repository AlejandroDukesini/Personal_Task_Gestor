/**
 * Consulta de notas: búsqueda, filtros, orden y paginación.
 *
 * Se ejecuta en memoria (la base local ya está cargada). La búsqueda no
 * distingue mayúsculas ni tildes y exige que TODAS las palabras aparezcan en
 * título, descripción, contenido, categoría, subcategoría o adjuntos.
 */

import type { NoteCategoryRow, NoteRow } from "@/services/localDb";

export type NoteStatus = "active" | "archived" | "trash" | "all";
export type NoteSort = "updated" | "created" | "title" | "category";

export interface NoteQuery {
  q?: string;
  status?: NoteStatus;
  categoryId?: string | null;
  subcategoryId?: string | null;
  /** Rango de fechas (AAAA-MM-DD, inclusivo) sobre `dateField`. */
  from?: string;
  to?: string;
  dateField?: "updatedAt" | "createdAt";
  hasAttachments?: boolean;
  sort?: NoteSort;
  dir?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

/** Nota sin el documento (las listas no lo necesitan y pesa). */
export type NoteSummary = Omit<NoteRow, "content"> & { preview: string };

export const PAGE_SIZE = 30;

export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function summarize(n: NoteRow): NoteSummary {
  const { content: _content, ...rest } = n;
  return { ...rest, preview: n.text.replace(/\s+/g, " ").slice(0, 240) };
}

export function queryNotes(notes: NoteRow[], categories: NoteCategoryRow[], q: NoteQuery = {}): { items: NoteSummary[]; total: number; nextOffset: number | null } {
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const status = q.status ?? "active";
  const words = fold(q.q ?? "").split(/\s+/).filter(Boolean);
  const field = q.dateField ?? "updatedAt";

  const filtered = notes.filter((n) => {
    if (status === "active" && (n.archived || n.deletedAt)) return false;
    if (status === "archived" && (!n.archived || n.deletedAt)) return false;
    if (status === "trash" && !n.deletedAt) return false;
    if (q.categoryId !== undefined && q.categoryId !== null && n.categoryId !== q.categoryId) return false;
    if (q.categoryId === null && n.categoryId !== null) return false;
    if (q.subcategoryId && n.subcategoryId !== q.subcategoryId) return false;
    if (q.hasAttachments && !n.attachments.length) return false;
    if (q.from || q.to) {
      const day = localDay(n[field]);
      if (q.from && day < q.from) return false;
      if (q.to && day > q.to) return false;
    }
    if (words.length) {
      const hay = fold(
        [n.title, n.description ?? "", n.text, catName.get(n.categoryId ?? "") ?? "", catName.get(n.subcategoryId ?? "") ?? "", ...n.attachments.flatMap((a) => [a.name, a.label ?? ""])].join("\n")
      );
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });

  const dir = q.dir === "asc" ? 1 : -1;
  const sort = q.sort ?? "updated";
  const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
  filtered.sort((a, b) => {
    let r = 0;
    if (sort === "updated") r = a.updatedAt.localeCompare(b.updatedAt);
    else if (sort === "created") r = a.createdAt.localeCompare(b.createdAt);
    else if (sort === "title") r = collator.compare(a.title, b.title);
    else r = collator.compare(catName.get(a.categoryId ?? "") ?? "￿", catName.get(b.categoryId ?? "") ?? "￿") || collator.compare(a.title, b.title);
    return r * dir || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  });

  const offset = Math.max(0, q.offset ?? 0);
  const limit = Math.min(200, Math.max(1, q.limit ?? PAGE_SIZE));
  const page = filtered.slice(offset, offset + limit);
  return { items: page.map(summarize), total: filtered.length, nextOffset: offset + limit < filtered.length ? offset + limit : null };
}
