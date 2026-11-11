/**
 * Lógica pura de las metas personales: fase temporal (derivada, nunca
 * guardada), tiempo restante y etiquetas. La usan la API local, la línea del
 * tiempo y las pruebas.
 */

import type { PersonalGoalRow, PersonalGoalStatus } from "@/services/localDb";

/** Ventana para «próxima a comenzar» y «próxima a finalizar». */
export const SOON_DAYS = 30;

export type GoalPhase = "completed" | "overdue" | "paused" | "starting_soon" | "future" | "ending_soon" | "running";

export const PHASE_LABEL: Record<GoalPhase, string> = {
  completed: "Finalizada",
  overdue: "Retrasada",
  paused: "En pausa",
  starting_soon: "Próxima a comenzar",
  future: "Futura",
  ending_soon: "Próxima a finalizar",
  running: "En ejecución",
};

export const STATUS_LABEL: Record<PersonalGoalStatus, string> = {
  planned: "Planificada",
  in_progress: "En curso",
  paused: "En pausa",
  completed: "Completada",
};

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000);
}

/**
 * Dónde está la meta respecto a hoy. Orden de prioridad: completada,
 * retrasada (pasó la fecha objetivo), en pausa, aún no empieza (próxima o
 * futura), termina pronto, en ejecución.
 */
export function phaseOf(g: Pick<PersonalGoalRow, "status" | "startDate" | "targetDate">, today: string): GoalPhase {
  if (g.status === "completed") return "completed";
  if (g.targetDate < today) return "overdue";
  if (g.status === "paused") return "paused";
  const notStarted = g.startDate ? g.startDate > today : g.status === "planned";
  if (notStarted) {
    const start = g.startDate ?? g.targetDate;
    return daysBetween(today, start) <= SOON_DAYS && g.startDate ? "starting_soon" : "future";
  }
  return daysBetween(today, g.targetDate) <= SOON_DAYS ? "ending_soon" : "running";
}

/** «Faltan 3 meses», «Vence hoy», «Hace 12 días»… */
export function timeLeftLabel(targetDate: string, today: string): string {
  const d = daysBetween(today, targetDate);
  if (d === 0) return "Vence hoy";
  const abs = Math.abs(d);
  const unit = abs >= 730 ? `${Math.round(abs / 365)} años` : abs >= 60 ? `${Math.round(abs / 30.4)} meses` : `${abs} ${abs === 1 ? "día" : "días"}`;
  return d > 0 ? `Faltan ${unit}` : `Hace ${unit}`;
}

/** Año (número) de una fecha `YYYY-MM-DD`. */
export const yearOf = (day: string) => Number(day.slice(0, 4));
