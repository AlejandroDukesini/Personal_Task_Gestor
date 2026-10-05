// Reglas de negocio del núcleo (tareas, eventos, objetivos, hábitos).
// Funciones puras: las usa la API local como autoridad final y los formularios
// para avisar antes de enviar. Una sola definición evita que el formulario
// acepte algo que luego la API rechaza (o al revés).

import { z } from "zod";

/** Texto obligatorio: sin espacios a los lados y nunca vacío. */
export const requiredText = (label: string, max: number) =>
  z
    .string({ required_error: `${label} es obligatorio`, invalid_type_error: `${label} es obligatorio` })
    .trim()
    .min(1, `${label} es obligatorio`)
    .max(max, `${label} admite como máximo ${max} caracteres`);

const isValidDate = (v: string) => !Number.isNaN(new Date(v).getTime());

/** Fecha/instante obligatorio en cualquier formato que entienda `Date`; sale en ISO. */
export const isoDate = (label = "Fecha") =>
  z
    .string({ required_error: `${label}: es obligatoria`, invalid_type_error: `${label}: es obligatoria` })
    .refine(isValidDate, `${label}: fecha no válida`)
    .transform((v) => new Date(v).toISOString());

/** Fecha opcional: ausente no la toca, null o "" la borra. */
export const isoDateOrNull = (label = "Fecha") =>
  z
    .union([z.string(), z.null()])
    .optional()
    .refine((v) => v === undefined || v === null || v === "" || isValidDate(v), `${label}: fecha no válida`)
    .transform((v) => (v === undefined ? undefined : v === null || v === "" ? null : new Date(v).toISOString()));

/** "HH:mm" 24 h; "" equivale a sin hora. */
export const timeOrNull = z
  .union([z.string(), z.null()])
  .optional()
  .refine((v) => !v || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), "Hora no válida (HH:mm)")
  .transform((v) => (v === undefined ? undefined : v || null));

/**
 * Día de calendario de un valor de fecha. Las fechas sin hora se guardan como
 * medianoche UTC del día elegido ("2026-10-05" -> 2026-10-05T00:00Z), así que
 * su día es la parte AAAA-MM-DD del ISO.
 */
export const dayOf = (v: string) => new Date(v).toISOString().slice(0, 10);

/** Día de hoy en la zona del dispositivo, como AAAA-MM-DD. */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export const MESSAGES = {
  taskDates: "La fecha de inicio no puede ser posterior a la de vencimiento.",
  taskTimeWithoutDate: "Indica la fecha de vencimiento para fijar una hora.",
  taskReminderWithoutDate: "Para programar un recordatorio indica la fecha de vencimiento.",
  eventRange: "La fecha de fin debe ser posterior a la de inicio.",
  goalDates: "La fecha límite no puede ser anterior a la fecha de inicio.",
  goalPastDeadline: "La fecha límite no puede estar en el pasado.",
  goalTarget: "La meta debe ser mayor que cero.",
  goalFinance: "Elige la meta de ahorro a seguir.",
  habitDates: "La fecha de fin no puede ser anterior a la de inicio.",
  habitDays: "Elige al menos un día de la semana para la frecuencia personalizada.",
  habitFutureLog: "No puedes registrar un hábito en un día que aún no ha llegado.",
  habitArchived: "El hábito está archivado: reactívalo para registrar avances.",
} as const;

/* -------------------------------------------------------------- tareas */

export function taskDatesError(t: { startDate?: string | null; dueDate?: string | null; dueTime?: string | null }): string | null {
  if (t.startDate && t.dueDate && dayOf(t.startDate) > dayOf(t.dueDate)) return MESSAGES.taskDates;
  if (t.dueTime && !t.dueDate) return MESSAGES.taskTimeWithoutDate;
  return null;
}

/**
 * Con checklist, "completada" significa todos los pasos hechos: es la misma
 * regla que cierra la tarea al marcar el último paso y la reabre al desmarcar uno.
 */
export function taskCompletionError(steps: { done: boolean }[]): string | null {
  const pending = steps.filter((s) => !s.done).length;
  if (pending === 0) return null;
  return `Completa los sub-pasos pendientes antes de cerrar la tarea (${steps.length - pending} de ${steps.length} hechos).`;
}

/* ------------------------------------------------------------- eventos */

/** Un evento ocupa un intervalo: el fin es estrictamente posterior al inicio. */
export function eventRangeError(e: { start?: string | null; end?: string | null }): string | null {
  if (!e.start || !e.end) return null;
  return new Date(e.end).getTime() > new Date(e.start).getTime() ? null : MESSAGES.eventRange;
}

/* ----------------------------------------------------------- objetivos */

/** Se compara por día: un objetivo diario empieza y vence el mismo día. */
export function goalDatesError(g: { startDate?: string | null; endDate?: string | null }): string | null {
  if (!g.startDate || !g.endDate) return null;
  return dayOf(g.endDate) < dayOf(g.startDate) ? MESSAGES.goalDates : null;
}

/* ------------------------------------------------------------- hábitos */

export function habitDatesError(h: { startDate?: string | null; endDate?: string | null }): string | null {
  if (!h.startDate || !h.endDate) return null;
  return dayOf(h.endDate) < dayOf(h.startDate) ? MESSAGES.habitDates : null;
}

/** "0,3,5": días 0 (domingo) a 6 (sábado), sin repetir. */
export function parseDaysOfWeek(v: string | null | undefined): number[] {
  return [...new Set((v ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number))];
}

export function habitDaysError(h: { frequency?: string; daysOfWeek?: string | null }): string | null {
  if (h.frequency !== "custom") return null;
  return parseDaysOfWeek(h.daysOfWeek).length > 0 ? null : MESSAGES.habitDays;
}
