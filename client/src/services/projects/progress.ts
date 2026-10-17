/**
 * Progreso de un proyecto: ÚNICA definición, usada por la API local, la
 * lista y el detalle. El progreso general nunca se guarda; se calcula aquí a
 * partir de las etapas, así que no puede quedar desactualizado.
 *
 *   P = Σ (pᵢ · wᵢ) / Σ wᵢ
 *
 * Hoy todas las etapas pesan lo mismo (wᵢ = 1, media aritmética). Si algún
 * día las etapas tienen peso, basta con que traigan `weight`: la fórmula ya
 * lo admite y una etapa sin peso sigue valiendo 1.
 */

export interface WeightedProgress {
  progress: number;
  weight?: number;
}

/** Normaliza un porcentaje manual: entero entre 0 y 100 (null si no es un número). */
export function normalizePercent(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Progreso general (0-100, sin redondear). Sin etapas: 0. */
export function projectProgress(stages: readonly WeightedProgress[]): number {
  let sum = 0;
  let weights = 0;
  for (const s of stages) {
    const w = s.weight ?? 1;
    if (!(w > 0)) continue;
    sum += Math.min(100, Math.max(0, s.progress)) * w;
    weights += w;
  }
  return weights > 0 ? sum / weights : 0;
}

export type StageState = "pending" | "in_progress" | "done";

/** Estado de una etapa, derivado de su porcentaje (no hay dos fuentes de verdad). */
export function stageState(progress: number): StageState {
  return progress >= 100 ? "done" : progress > 0 ? "in_progress" : "pending";
}

export const STAGE_STATE_LABEL: Record<StageState, string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  done: "Completada",
};

/** «62,5 %» (detalle, con decimales solo si aportan) o «63 %» (listas). */
export function formatPercent(p: number, decimals = 0): string {
  const f = 10 ** decimals;
  const v = Math.round(p * f) / f;
  return `${v.toLocaleString("es", { maximumFractionDigits: decimals })} %`;
}
