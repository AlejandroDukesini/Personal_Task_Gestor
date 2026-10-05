// Reglas de negocio compartidas por las rutas. Son las mismas que aplica la API
// local del cliente (client/src/services/rules.ts): si cambia una, cambian ambas.

import { z } from "zod";

/** Error con código HTTP y mensaje para el usuario (el middleware lo devuelve tal cual). */
export class RuleError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RuleError";
    this.status = status;
  }
}

/** Rechaza la operación (nada se guarda) si la condición no se cumple. */
export function rule(ok: boolean, message: string, status = 400): void {
  if (!ok) throw new RuleError(status, message);
}

export const requiredText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} es obligatorio`)
    .max(max, `${label} admite como máximo ${max} caracteres`);

const isValidDate = (v: string) => !Number.isNaN(new Date(v).getTime());

export const dateField = (label: string) =>
  z
    .string()
    .refine(isValidDate, `${label}: fecha no válida`)
    .transform((v) => new Date(v));

/** Ausente no la toca, null o "" la borra. */
export const dateOrNull = (label: string) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .refine((v) => v === undefined || v === null || v === "" || isValidDate(v), `${label}: fecha no válida`)
    .transform((v) => (v === undefined ? undefined : v === null || v === "" ? null : new Date(v)));

/** Día de calendario de una fecha sin hora (guardada como medianoche UTC). */
export const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export const MESSAGES = {
  taskDates: "La fecha de inicio no puede ser posterior a la de vencimiento.",
  eventRange: "La fecha de fin debe ser posterior a la de inicio.",
  goalDates: "La fecha límite no puede ser anterior a la fecha de inicio.",
  goalPastDeadline: "La fecha límite no puede estar en el pasado.",
  goalTarget: "La meta debe ser mayor que cero.",
  habitDates: "La fecha de fin no puede ser anterior a la de inicio.",
  habitDays: "Elige al menos un día de la semana para la frecuencia personalizada.",
} as const;

/** Fila con los cambios aplicados: se valida el resultado, no solo lo enviado. */
export function merged<T extends object>(row: T, data: object): T {
  return { ...row, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };
}

export const touches = (data: object, keys: string[]) =>
  keys.some((k) => (data as Record<string, unknown>)[k] !== undefined);
