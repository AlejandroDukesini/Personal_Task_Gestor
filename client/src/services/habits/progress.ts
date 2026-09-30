// Progreso diario de los hábitos: distingue la META (dailyTarget) de las veces
// REALIZADAS (count). Funciones puras: las usan el router local, el calendario
// y las pruebas.

import { localDateKey, startOfDay, type HabitLogRow, type HabitRow } from "@/services/localDb";

/** Máximo de veces registrables en un día (evita contadores absurdos por error). */
export const MAX_DAILY_COUNT = 10000;
/** Operaciones que se conservan en la traza de un registro. */
export const TRAIL_LIMIT = 30;

export interface DayProgress {
  /** `YYYY-MM-DD` local. */
  date: string;
  count: number;
  target: number;
  /** 0-100, nunca por encima de 100 aunque `count` supere la meta. */
  percent: number;
  done: boolean;
}

/** Clave del registro de un día: medianoche local en ISO (formato histórico). */
export function logDateOf(date: Date | string): string {
  return startOfDay(new Date(date)).toISOString();
}

/** Día local (`YYYY-MM-DD`) de un registro. */
export function logDayKey(log: Pick<HabitLogRow, "date">): string {
  return localDateKey(new Date(log.date));
}

/**
 * Meta que rige un registro. Los registros nuevos guardan la meta vigente ese
 * día, así que cambiar la meta del hábito no altera días pasados. Los de
 * versiones anteriores no la tienen: entonces se consideraban cumplidos con
 * cualquier marca, y se respeta (no se reescribe la historia): su meta es
 * min(veces, meta actual).
 */
export function logTarget(log: Pick<HabitLogRow, "count" | "target">, habit: Pick<HabitRow, "dailyTarget">): number {
  if (typeof log.target === "number" && log.target >= 1) return log.target;
  return Math.max(1, Math.min(Math.max(1, log.count), Math.max(1, habit.dailyTarget)));
}

export function progressOf(count: number, target: number, date: string): DayProgress {
  const t = Math.max(1, target);
  const c = Math.max(0, count);
  return { date, count: c, target: t, percent: Math.min(100, (c / t) * 100), done: c >= t };
}

/**
 * Un registro por día. Si la sincronización o una versión antigua dejaron dos
 * filas del mismo (hábito, día), se toma la de mayor contador: sumar contaría
 * dos veces la misma realización vista desde dos dispositivos.
 */
export function logsByDay(logs: HabitLogRow[]): Map<string, HabitLogRow> {
  const out = new Map<string, HabitLogRow>();
  for (const l of logs) {
    const k = logDayKey(l);
    const prev = out.get(k);
    if (!prev || l.count > prev.count || (l.count === prev.count && (l.updatedAt ?? "") > (prev.updatedAt ?? ""))) {
      out.set(k, l);
    }
  }
  return out;
}

export function dayProgress(habit: HabitRow, logs: HabitLogRow[], dateKey: string): DayProgress {
  const log = logsByDay(logs.filter((l) => l.habitId === habit.id)).get(dateKey);
  if (!log) return progressOf(0, habit.dailyTarget, dateKey);
  return progressOf(log.count, logTarget(log, habit), dateKey);
}

/** Nuevo valor del contador: `count` fija, `delta` suma/resta, nada = +1. */
export function nextCount(current: number, change: { count?: number; delta?: number }): number {
  const raw = change.count !== undefined ? change.count : current + (change.delta ?? 1);
  return Math.min(MAX_DAILY_COUNT, Math.max(0, Math.round(raw)));
}

export function appendTrail<T>(trail: T[] | undefined, item: T): T[] {
  return [...(trail ?? []), item].slice(-TRAIL_LIMIT);
}

export interface HabitStatsResult {
  streak: number;
  best: number;
  successRate: number;
  last30: { date: string; done: boolean; count: number; target: number }[];
  today: DayProgress;
}

/**
 * Racha, mejor racha y últimos 30 días. Un día cuenta como cumplido solo si
 * alcanzó SU meta (la vigente ese día). Antes cualquier registro contaba.
 */
export function habitStats(habit: HabitRow, logs: HabitLogRow[], now = new Date()): HabitStatsResult {
  const byDay = logsByDay(logs.filter((l) => l.habitId === habit.id));
  const doneDays = new Set<string>();
  for (const [k, l] of byDay) if (l.count >= logTarget(l, habit)) doneDays.add(k);

  const today = startOfDay(now);
  const keyAt = (offset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    return d;
  };

  // La racha no se rompe por el día de hoy mientras siga abierto.
  let streak = 0;
  const todayKey = localDateKey(today);
  for (let i = doneDays.has(todayKey) ? 0 : 1; i < 3660; i++) {
    if (doneDays.has(localDateKey(keyAt(i)))) streak++;
    else break;
  }

  let best = 0;
  let cur = 0;
  let prev: Date | null = null;
  for (const k of [...doneDays].sort()) {
    const [y, m, d] = k.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const diff = prev ? Math.round((date.getTime() - prev.getTime()) / 86400000) : 0;
    cur = prev && diff === 1 ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = date;
  }

  const last30 = Array.from({ length: 30 }, (_, i) => {
    const d = keyAt(29 - i);
    const k = localDateKey(d);
    const l = byDay.get(k);
    const target = l ? logTarget(l, habit) : Math.max(1, habit.dailyTarget);
    return { date: d.toISOString(), done: doneDays.has(k), count: l?.count ?? 0, target };
  });

  const tl = byDay.get(todayKey);
  const todayProgress = tl ? progressOf(tl.count, logTarget(tl, habit), todayKey) : progressOf(0, habit.dailyTarget, todayKey);

  return {
    streak,
    best,
    successRate: last30.filter((d) => d.done).length / 30,
    last30,
    today: todayProgress,
  };
}
