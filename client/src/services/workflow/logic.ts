/**
 * Lógica pura de la estructura de trabajo: valores por defecto, avance,
 * estados derivados, dependencias y copia independiente (plantillas).
 * Sin acceso al almacenamiento: la usan la API local, las vistas y las pruebas.
 */

import { newId, type ProjectStage, type WfActivity, type WfActivityStatus, type WfCheckItem, type WfPriority, type WfProcedure, type WfStage, type WfStageStatus } from "@/services/localDb";

export const PRIORITY_LABEL: Record<WfPriority, string> = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" };
export const PRIORITY_RANK: Record<WfPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export const ACTIVITY_STATUS_LABEL: Record<WfActivityStatus, string> = { pending: "Pendiente", in_progress: "En progreso", blocked: "Bloqueada", done: "Completada" };
export const STAGE_STATUS_LABEL: Record<WfStageStatus, string> = { pending: "Pendiente", in_progress: "En curso", on_hold: "En pausa", done: "Completada" };

/** Etapa con todos sus campos (las antiguas no tienen los de la v10). Copia: no muta la original. */
export function normalizeStage(s: ProjectStage): WfStage {
  return {
    ...s,
    subtitle: s.subtitle ?? null,
    objective: s.objective ?? null,
    color: s.color ?? null,
    startDate: s.startDate ?? null,
    endDate: s.endDate ?? null,
    priority: s.priority ?? null,
    status: s.status ?? null,
    procedures: s.procedures ?? [],
    activities: s.activities ?? [],
    checklist: s.checklist ?? [],
    documentation: s.documentation ?? null,
    observations: s.observations ?? null,
  };
}

/** Avance de una actividad: completada = 100; si no, su porcentaje (o 0). */
export function activityProgress(a: Pick<WfActivity, "status" | "progress">): number {
  return a.status === "done" ? 100 : (a.progress ?? 0);
}

/**
 * Avance de una etapa: con actividades, la media de las actividades (así no
 * hay dos fuentes de verdad); sin ellas, el porcentaje manual.
 */
export function stageProgressOf(s: Pick<WfStage, "progress"> & { activities?: WfActivity[] }): number {
  const acts = s.activities ?? [];
  if (!acts.length) return s.progress;
  return Math.round(acts.reduce((t, a) => t + activityProgress(a), 0) / acts.length);
}

/** Estado visible: el elegido por el usuario o, si no eligió, el que dicta el avance. */
export function stageStatusOf(s: Pick<WfStage, "progress"> & { status?: WfStageStatus | null }): WfStageStatus {
  if (s.status) return s.status;
  return s.progress >= 100 ? "done" : s.progress > 0 ? "in_progress" : "pending";
}

/** Actividades de las que depende `a` y que aún no están completadas. */
export function blockersOf(a: Pick<WfActivity, "dependsOn">, all: WfActivity[]): WfActivity[] {
  if (!a.dependsOn.length) return [];
  const byId = new Map(all.map((x) => [x.id, x]));
  return a.dependsOn.map((id) => byId.get(id)).filter((x): x is WfActivity => !!x && x.status !== "done");
}

/** ¿Crearía un ciclo que `id` dependa de `deps`? (recorrido en profundidad) */
export function createsCycle(id: string, deps: string[], all: Pick<WfActivity, "id" | "dependsOn">[]): boolean {
  const graph = new Map(all.map((a) => [a.id, a.id === id ? deps : a.dependsOn]));
  const seen = new Set<string>();
  const stack = [...deps];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === id) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(graph.get(cur) ?? []));
  }
  return false;
}

export function allActivities(stages: { activities?: WfActivity[] }[]): WfActivity[] {
  return stages.flatMap((s) => s.activities ?? []);
}

export interface StructureStats {
  stages: number;
  stagesDone: number;
  procedures: number;
  activities: number;
  activitiesDone: number;
  checks: number;
  checksDone: number;
  /** Media del avance de las etapas (0-100). */
  progress: number;
}

export function structureStats(stages: ProjectStage[]): StructureStats {
  const full = stages.map(normalizeStage);
  const acts = allActivities(full);
  const checks: WfCheckItem[] = full.flatMap((s) => [...s.checklist, ...s.procedures.flatMap((p) => p.checklist), ...s.activities.flatMap((a) => a.checklist)]);
  return {
    stages: full.length,
    stagesDone: full.filter((s) => stageStatusOf(s) === "done").length,
    procedures: full.reduce((t, s) => t + s.procedures.length, 0),
    activities: acts.length,
    activitiesDone: acts.filter((a) => a.status === "done").length,
    checks: checks.length,
    checksDone: checks.filter((c) => c.done).length,
    progress: full.length ? full.reduce((t, s) => t + s.progress, 0) / full.length : 0,
  };
}

/**
 * Copia independiente de una estructura: ids nuevos en todos los niveles (y
 * dependencias reasignadas a las copias). Con `reset`, la copia empieza de
 * cero: sin avances, estados ni casillas marcadas. Es lo que se hace al
 * aplicar una plantilla: los cambios posteriores nunca tocan el original.
 */
export function cloneStages(stages: ProjectStage[], ts: string, reset = true): WfStage[] {
  const full = stages.map(normalizeStage);
  const actIds = new Map<string, string>();
  for (const a of allActivities(full)) actIds.set(a.id, newId());
  const checks = (items: WfCheckItem[]): WfCheckItem[] => items.map((c) => ({ id: newId(), text: c.text, done: reset ? false : c.done }));
  return full.map((s) => ({
    ...s,
    id: newId(),
    progress: reset ? 0 : s.progress,
    status: reset ? null : s.status,
    procedures: s.procedures.map((p): WfProcedure => ({ ...p, id: newId(), checklist: checks(p.checklist), createdAt: ts, updatedAt: ts })),
    activities: s.activities.map(
      (a): WfActivity => ({
        ...a,
        id: actIds.get(a.id)!,
        status: reset ? "pending" : a.status,
        progress: reset ? (a.progress === null ? null : 0) : a.progress,
        completedAt: reset ? null : a.completedAt,
        checklist: checks(a.checklist),
        dependsOn: a.dependsOn.map((d) => actIds.get(d)).filter((d): d is string => !!d),
        createdAt: ts,
        updatedAt: ts,
      })
    ),
    checklist: checks(s.checklist),
    createdAt: ts,
    updatedAt: ts,
  }));
}
