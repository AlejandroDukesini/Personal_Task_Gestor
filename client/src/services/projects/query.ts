/**
 * Consulta de proyectos: búsqueda, filtros y orden, en memoria (la base local
 * ya está cargada). La búsqueda no distingue mayúsculas ni tildes y exige que
 * todas las palabras aparezcan en título, descripción, etiqueta u objetivos.
 */

import type { ProjectRow, ProjectStatus } from "@/services/localDb";
import { fold } from "@/services/notes/query";
import { projectProgress } from "./progress";

export type ProjectView = ProjectStatus | "all" | "trash";
export type ProjectSort = "updated" | "created" | "title" | "start" | "end" | "progress";

export interface ProjectQuery {
  q?: string;
  view?: ProjectView;
  tag?: string;
  sort?: ProjectSort;
  dir?: "asc" | "desc";
}

/** Plazo respecto a la fecha final prevista. Solo informa: nunca cambia el estado. */
export type Deadline = "overdue" | "soon" | null;
export const SOON_DAYS = 7;

export function deadlineOf(p: Pick<ProjectRow, "endDate" | "status">, today: string): Deadline {
  if (!p.endDate || p.status === "finished") return null;
  if (p.endDate < today) return "overdue";
  const days = (Date.parse(p.endDate) - Date.parse(today)) / 86_400_000;
  return days <= SOON_DAYS ? "soon" : null;
}

/** Proyecto para listas: sin las descripciones de las etapas, con lo derivado. */
export type ProjectSummary = Omit<ProjectRow, "stages"> & {
  progress: number;
  stagesDone: number;
  stagesTotal: number;
  deadline: Deadline;
};

export function summarize(p: ProjectRow, today: string): ProjectSummary {
  const { stages, ...rest } = p;
  return {
    ...rest,
    progress: projectProgress(stages),
    stagesDone: stages.filter((s) => s.progress >= 100).length,
    stagesTotal: stages.length,
    deadline: deadlineOf(p, today),
  };
}

export function queryProjects(projects: ProjectRow[], today: string, q: ProjectQuery = {}): ProjectSummary[] {
  const view = q.view ?? "all";
  const words = fold(q.q ?? "").split(/\s+/).filter(Boolean);
  const tag = q.tag ? fold(q.tag) : null;

  const items = projects
    .filter((p) => {
      if (view === "trash") {
        if (!p.deletedAt) return false;
      } else if (p.deletedAt || (view !== "all" && p.status !== view)) return false;
      if (tag && fold(p.tag ?? "") !== tag) return false;
      if (words.length) {
        const hay = fold([p.title, p.description ?? "", p.tag ?? "", ...p.objectives.map((o) => o.text)].join("\n"));
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    })
    .map((p) => summarize(p, today));

  const dir = q.dir === "asc" ? 1 : -1;
  const sort = q.sort ?? "updated";
  const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
  // Sin fecha, al final en cualquier sentido.
  const byDate = (a: string | null, b: string | null) => (a && b ? a.localeCompare(b) * dir : a ? -1 : b ? 1 : 0);
  items.sort((a, b) => {
    let r = 0;
    if (sort === "updated") r = a.updatedAt.localeCompare(b.updatedAt) * dir;
    else if (sort === "created") r = a.createdAt.localeCompare(b.createdAt) * dir;
    else if (sort === "title") r = collator.compare(a.title, b.title) * dir;
    else if (sort === "start") r = byDate(a.startDate, b.startDate);
    else if (sort === "end") r = byDate(a.endDate, b.endDate);
    else r = (a.progress - b.progress) * dir;
    return r || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  });
  return items;
}
