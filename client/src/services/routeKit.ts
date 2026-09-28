// Piezas comunes del router local: tipos de handler, respuestas y validación.
// Viven aparte para que cada módulo (tareas, finanzas…) declare sus rutas en su
// propio fichero sin importar `localApi.ts` (que a su vez los importa a ellos).

import { z } from "zod";
import { ApiError } from "./localDb";

export interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
}

export type Result = { status: number; body?: unknown };
export type Handler = (ctx: Ctx) => Result | Promise<Result>;
export type Route = [method: string, pattern: string, handler: Handler];

export const ok = (body: unknown): Result => ({ status: 200, body });
export const created = (body: unknown): Result => ({ status: 201, body });
export const noContent = (): Result => ({ status: 204 });

/**
 * Valida con zod. El mensaje incluye el primer campo erróneo: "ValidationError"
 * a secas no le dice al usuario qué corregir en el formulario.
 */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    throw new ApiError(400, `Datos no válidos — ${where}${issue?.message ?? "formato incorrecto"}`);
  }
  return r.data;
}

export function find<T extends { id: string }>(rows: T[], id: string, what = "Registro"): T {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new ApiError(404, `${what} no encontrado`);
  return row;
}

/**
 * Claves que nunca deben escribirse por asignación dinámica: `__proto__`
 * dispara el setter del prototipo y contaminaría Object.prototype.
 */
export const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Descarta recursivamente claves peligrosas de un objeto de datos externo. */
export function stripDangerousKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripDangerousKeys) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!FORBIDDEN_KEYS.has(k)) out[k] = stripDangerousKeys(v);
    }
    return out as T;
  }
  return value;
}

/** Aplica solo las claves definidas, como hace Prisma con `data`. */
export function assign<T extends object>(row: T, data: Partial<T>): T {
  for (const [k, v] of Object.entries(data)) {
    // Los esquemas zod ya descartan claves desconocidas; el filtro es una
    // segunda barrera por si alguna ruta futura pasa datos sin validar.
    if (v !== undefined && !FORBIDDEN_KEYS.has(k)) (row as any)[k] = v;
  }
  return row;
}
