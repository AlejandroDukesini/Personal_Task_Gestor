/**
 * Lógica pura del módulo académico: horarios, conflictos, estado derivado de
 * las actividades, filtros y el panel. Sin acceso al almacenamiento: la usan
 * la API local, las vistas y las pruebas.
 */

import type { AcadActivityRow, AcadActivityStatus, AcadActivityType, AcadClassRow, AcadSubjectRow } from "@/services/localDb";
import { fold } from "@/services/notes/query";

/* ---------------------------------------------------------------- etiquetas */

export const DAY_LABELS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] as const;
export const DAY_SHORT = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;

export const TYPE_LABEL: Record<AcadActivityType, string> = {
  task: "Tarea",
  exam: "Parcial",
  presentation: "Exposición",
  final_project: "Proyecto final",
  group_work: "Trabajo grupal",
  research: "Investigación",
  reading: "Lectura",
  delivery: "Entrega",
  other: "Otra",
};

/** Estado que ve el usuario: el guardado más «Vencida», que se deriva. */
export type ActivityState = AcadActivityStatus | "overdue";

export const STATE_LABEL: Record<ActivityState, string> = {
  pending: "Pendiente",
  in_progress: "En progreso",
  review: "En revisión",
  done: "Completada",
  overdue: "Vencida",
};

export const PRIORITY_LABEL: Record<AcadActivityRow["priority"], string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};
export const PRIORITY_RANK: Record<AcadActivityRow["priority"], number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function typeLabel(a: Pick<AcadActivityRow, "type" | "customType">): string {
  return a.type === "other" && a.customType ? a.customType : TYPE_LABEL[a.type];
}

/* ----------------------------------------------------------------- horario */

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Dos franjas se solapan si comparten algún minuto (terminar a las 10:00 y empezar a las 10:00 no choca). */
export function overlaps(a: Pick<AcadClassRow, "day" | "startTime" | "endTime">, b: Pick<AcadClassRow, "day" | "startTime" | "endTime">): boolean {
  return a.day === b.day && toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);
}

/** Clases del mismo semestre con las que chocaría `slot` (excluida ella misma). */
type Slot = Pick<AcadClassRow, "semesterId" | "day" | "startTime" | "endTime">;

export function conflictsFor<T extends Slot & { id: string }>(slot: Slot & { id?: string }, classes: T[]): T[] {
  return classes.filter((c) => c.id !== slot.id && c.semesterId === slot.semesterId && overlaps(c, slot));
}

/** Ids de todas las clases que chocan con alguna otra. */
export function conflictingIds(classes: Pick<AcadClassRow, "id" | "semesterId" | "day" | "startTime" | "endTime">[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < classes.length; i++) {
    for (let j = i + 1; j < classes.length; j++) {
      if (classes[i].semesterId === classes[j].semesterId && overlaps(classes[i], classes[j])) {
        out.add(classes[i].id);
        out.add(classes[j].id);
      }
    }
  }
  return out;
}

/**
 * Carriles para pintar clases que se solapan una al lado de la otra en la
 * cuadrícula semanal: devuelve, por clase, su carril y cuántos carriles tiene
 * su grupo de solapes. Sin solapes, todas ocupan el ancho completo.
 */
export function layoutDay<T extends Pick<AcadClassRow, "id" | "startTime" | "endTime">>(classes: T[]): Map<string, { lane: number; lanes: number }> {
  const sorted = [...classes].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime) || toMinutes(a.endTime) - toMinutes(b.endTime));
  const out = new Map<string, { lane: number; lanes: number }>();
  let group: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const close = () => {
    for (const g of group) out.set(g.id, { lane: g.lane, lanes: laneEnds.length });
    group = [];
    laneEnds = [];
  };
  for (const c of sorted) {
    const s = toMinutes(c.startTime);
    const e = toMinutes(c.endTime);
    if (s >= groupEnd) close();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(e);
    } else laneEnds[lane] = e;
    group.push({ id: c.id, lane });
    groupEnd = Math.max(groupEnd, e);
  }
  close();
  return out;
}

/** Horas totales de clase a la semana (para el resumen). */
export function weeklyHours(classes: Pick<AcadClassRow, "startTime" | "endTime">[]): number {
  return classes.reduce((s, c) => s + Math.max(0, toMinutes(c.endTime) - toMinutes(c.startTime)), 0) / 60;
}

/* -------------------------------------------------------------- actividades */

export function activityState(a: Pick<AcadActivityRow, "status" | "dueDate">, today: string): ActivityState {
  if (a.status === "done") return "done";
  if (a.dueDate && a.dueDate < today) return "overdue";
  return a.status;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000);
}

export function addDays(dayKey: string, n: number): string {
  const d = new Date(`${dayKey}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Lunes y domingo de la semana de `today`. */
export function weekOf(today: string): { from: string; to: string } {
  const dow = new Date(`${today}T00:00:00`).getDay() || 7;
  const from = addDays(today, 1 - dow);
  return { from, to: addDays(from, 6) };
}

export interface ActivityFilter {
  q?: string;
  subjectId?: string | "none";
  state?: ActivityState;
  priority?: AcadActivityRow["priority"];
  type?: AcadActivityType;
  from?: string;
  to?: string;
}

export type ActivitySort = "due" | "priority" | "created" | "title";

/** Filtra y ordena (las sin fecha, al final). Todas las palabras deben aparecer. */
export function filterActivities(items: AcadActivityRow[], subjects: Pick<AcadSubjectRow, "id" | "name">[], today: string, f: ActivityFilter = {}, sort: ActivitySort = "due"): AcadActivityRow[] {
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
  const words = fold(f.q ?? "").split(/\s+/).filter(Boolean);
  const out = items.filter((a) => {
    if (f.subjectId === "none" ? a.subjectId !== null : f.subjectId && a.subjectId !== f.subjectId) return false;
    if (f.state && activityState(a, today) !== f.state) return false;
    if (f.priority && a.priority !== f.priority) return false;
    if (f.type && a.type !== f.type) return false;
    if ((f.from || f.to) && !a.dueDate) return false;
    if (f.from && a.dueDate! < f.from) return false;
    if (f.to && a.dueDate! > f.to) return false;
    if (words.length) {
      const hay = fold([a.title, a.description ?? "", a.observations ?? "", a.customType ?? "", subjectName.get(a.subjectId ?? "") ?? ""].join("\n"));
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
  const due = (a: AcadActivityRow) => `${a.dueDate ?? "9999-99-99"} ${a.dueTime ?? "99:99"}`;
  out.sort((a, b) => {
    let r = 0;
    if (sort === "due") r = due(a).localeCompare(due(b));
    else if (sort === "priority") r = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || due(a).localeCompare(due(b));
    else if (sort === "created") r = b.createdAt.localeCompare(a.createdAt);
    else r = collator.compare(a.title, b.title);
    return r || a.id.localeCompare(b.id);
  });
  return out;
}

/* ------------------------------------------------------------------- panel */

export const UPCOMING_DAYS = 14;

export interface AcademicOverview {
  upcoming: AcadActivityRow[];
  upcomingExams: AcadActivityRow[];
  overdue: AcadActivityRow[];
  pendingCount: number;
  doneCount: number;
  totalCount: number;
  /** Media del avance de todas las actividades (las completadas cuentan 100). */
  averageProgress: number;
  week: {
    from: string;
    to: string;
    due: AcadActivityRow[];
    classes: number;
    hours: number;
    /** Clases de hoy, ordenadas por hora. */
    today: AcadClassRow[];
  };
}

/** Datos del panel académico de un semestre. Se calcula al leer: nunca queda desactualizado. */
export function overviewOf(activities: AcadActivityRow[], classes: AcadClassRow[], today: string): AcademicOverview {
  const horizon = addDays(today, UPCOMING_DAYS);
  const open = activities.filter((a) => a.status !== "done");
  const byDue = (a: AcadActivityRow, b: AcadActivityRow) => `${a.dueDate} ${a.dueTime ?? "99:99"}`.localeCompare(`${b.dueDate} ${b.dueTime ?? "99:99"}`);
  const inWindow = open.filter((a) => a.dueDate && a.dueDate >= today && a.dueDate <= horizon).sort(byDue);
  const wk = weekOf(today);
  const dow = new Date(`${today}T00:00:00`).getDay() || 7;
  const done = activities.filter((a) => a.status === "done").length;
  return {
    upcoming: inWindow.filter((a) => a.type !== "exam"),
    upcomingExams: open.filter((a) => a.type === "exam" && a.dueDate && a.dueDate >= today).sort(byDue),
    overdue: open.filter((a) => a.dueDate && a.dueDate < today).sort(byDue),
    pendingCount: open.length,
    doneCount: done,
    totalCount: activities.length,
    averageProgress: activities.length ? activities.reduce((s, a) => s + (a.status === "done" ? 100 : a.progress), 0) / activities.length : 0,
    week: {
      ...wk,
      due: activities.filter((a) => a.dueDate && a.dueDate >= wk.from && a.dueDate <= wk.to).sort(byDue),
      classes: classes.length,
      hours: weeklyHours(classes),
      today: classes.filter((c) => c.day === dow).sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime)),
    },
  };
}
