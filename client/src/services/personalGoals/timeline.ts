/**
 * Disposición de la línea del tiempo de metas (función pura, sin DOM).
 *
 * - Los años se calculan a partir de las fechas de las metas (y el año actual,
 *   para que «hoy» siempre tenga dónde mostrarse). Nada de posiciones fijas.
 * - Dentro de cada año, las entradas van en orden de fecha. La separación
 *   entre dos entradas crece con los días que las separan, pero acotada: dos
 *   metas el mismo día no se superponen (mínimo) y un año vacío no deja un
 *   hueco enorme (máximo). Así la escala es coherente y siempre legible.
 */

import { daysBetween, yearOf } from "./logic";

export interface TimelineGoal {
  id: string;
  startDate: string | null;
  targetDate: string;
}

export type TimelineEntry<G> =
  | { kind: "goal"; date: string; goal: G; gap: number }
  | { kind: "start"; date: string; goal: G; gap: number }
  | { kind: "today"; date: string; gap: number };

export interface TimelineYear<G> {
  year: number;
  entries: TimelineEntry<G>[];
}

export const GAP_MIN = 12;
export const GAP_MAX = 96;
const PX_PER_DAY = 1.2;

/** Separación (px) que corresponde a `days` días. */
export function gapFor(days: number): number {
  return Math.round(Math.min(GAP_MAX, GAP_MIN + Math.max(0, days) * PX_PER_DAY));
}

/**
 * Construye los segmentos por año. `showStarts` añade una marca ligera en la
 * fecha de inicio de cada meta (si es distinta de la objetivo).
 */
export function buildTimeline<G extends TimelineGoal>(goals: G[], today: string, showStarts = true): TimelineYear<G>[] {
  type Raw = { kind: "goal" | "start" | "today"; date: string; goal?: G; order: number };
  const raw: Raw[] = [{ kind: "today", date: today, order: 1 }];
  for (const g of goals) {
    // Orden dentro del mismo día: inicios, hoy, objetivos.
    raw.push({ kind: "goal", date: g.targetDate, goal: g, order: 2 });
    if (showStarts && g.startDate && g.startDate !== g.targetDate) raw.push({ kind: "start", date: g.startDate, goal: g, order: 0 });
  }
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || (a.goal?.id ?? "").localeCompare(b.goal?.id ?? ""));

  const years = new Map<number, TimelineEntry<G>[]>();
  let prev: string | null = null;
  for (const r of raw) {
    const y = yearOf(r.date);
    const list = years.get(y) ?? [];
    // La primera entrada del año se mide desde el 1 de enero.
    const from = prev && yearOf(prev) === y ? prev : `${y}-01-01`;
    const gap = gapFor(daysBetween(from, r.date));
    list.push(r.kind === "today" ? { kind: "today", date: r.date, gap } : { kind: r.kind, date: r.date, goal: r.goal!, gap });
    years.set(y, list);
    prev = r.date;
  }
  return [...years.entries()].sort((a, b) => a[0] - b[0]).map(([year, entries]) => ({ year, entries }));
}
