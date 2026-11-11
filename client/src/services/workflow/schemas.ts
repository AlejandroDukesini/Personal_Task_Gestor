/**
 * Validación de la estructura de trabajo compartida (SOP, plantillas y
 * proyectos profesionales). Una sola definición para la API local, las copias
 * de seguridad y la sincronización.
 */

import { z } from "zod";
import { hexColor, idSchema } from "@/services/notes/schemas";

const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Marca de tiempo inválida");
export const wfDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)").refine((v) => !Number.isNaN(Date.parse(v)), "Fecha inválida");
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullable().optional();
export const wfPercent = z.number({ error: (iss) => (iss.input === undefined ? undefined : "El porcentaje debe ser un número") }).int("El porcentaje debe ser un número entero").min(0, "El porcentaje mínimo es 0 %").max(100, "El porcentaje máximo es 100 %");

export const WF_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const WF_ACTIVITY_STATUSES = ["pending", "in_progress", "blocked", "done"] as const;
export const WF_STAGE_STATUSES = ["pending", "in_progress", "on_hold", "done"] as const;

/** Límites amplios: solo evitan que una fila corrupta o maliciosa crezca sin fin. */
export const WF_MAX_STAGES = 200;
export const WF_MAX_ITEMS = 500;
export const WF_MAX_CHECKS = 300;

const uniqueIds = (rows: { id: string }[]) => new Set(rows.map((r) => r.id)).size === rows.length;

export const checkItemRow = z.object({ id: idSchema, text: text(300).min(1, "El elemento no puede estar vacío"), done: z.boolean() });
const checklist = z.array(checkItemRow).max(WF_MAX_CHECKS).refine(uniqueIds, "Elemento repetido");

export const procedureRow = z.object({
  id: idSchema,
  title: text(200).min(1),
  instructions: text(20_000).nullable(),
  observations: text(5000).nullable(),
  checklist,
  createdAt: iso,
  updatedAt: iso,
});

export const activityRow = z.object({
  id: idSchema,
  title: text(200).min(1),
  description: text(20_000).nullable(),
  dueDate: wfDay.nullable(),
  priority: z.enum(WF_PRIORITIES),
  status: z.enum(WF_ACTIVITY_STATUSES),
  progress: wfPercent.nullable(),
  observations: text(5000).nullable(),
  checklist,
  dependsOn: z.array(idSchema).max(WF_MAX_ITEMS),
  completedAt: iso.nullable(),
  createdAt: iso,
  updatedAt: iso,
});

/** Campos ampliados de una etapa. Opcionales: las etapas de proyecto anteriores a la v10 no los tienen. */
export const stageExtraRow = {
  subtitle: text(200).nullable().optional(),
  objective: text(5000).nullable().optional(),
  color: hexColor.nullable().optional(),
  startDate: wfDay.nullable().optional(),
  endDate: wfDay.nullable().optional(),
  priority: z.enum(WF_PRIORITIES).nullable().optional(),
  status: z.enum(WF_STAGE_STATUSES).nullable().optional(),
  procedures: z.array(procedureRow).max(WF_MAX_ITEMS).refine(uniqueIds, "Procedimiento repetido").optional(),
  activities: z.array(activityRow).max(WF_MAX_ITEMS).refine(uniqueIds, "Actividad repetida").optional(),
  checklist: checklist.optional(),
  documentation: text(50_000).nullable().optional(),
  observations: text(5000).nullable().optional(),
};

export const stageBaseRow = {
  id: idSchema,
  title: text(200).min(1),
  description: text(20_000).nullable(),
  progress: wfPercent,
  createdAt: iso,
  updatedAt: iso,
};

/** Etapa completa (SOP y plantillas). */
export const fullStageRow = z.object({ ...stageBaseRow, ...stageExtraRow }).required();

export const stagesArray = <T extends z.ZodTypeAny>(stage: T) => z.array(stage).max(WF_MAX_STAGES).refine((s) => uniqueIds(s as { id: string }[]), "Etapa repetida");

/* ------------------------------------------------------- operaciones (API) */

const stageData = z.object({
  title: text(200).min(1, "La etapa necesita un título"),
  subtitle: optText(200),
  description: optText(20_000),
  objective: optText(5000),
  color: hexColor.nullable().optional(),
  startDate: wfDay.nullable().optional(),
  endDate: wfDay.nullable().optional(),
  priority: z.enum(WF_PRIORITIES).nullable().optional(),
  status: z.enum(WF_STAGE_STATUSES).nullable().optional(),
  progress: wfPercent.optional(),
  documentation: optText(50_000),
  observations: optText(5000),
});

const procedureData = z.object({
  title: text(200).min(1, "El procedimiento necesita un título"),
  instructions: optText(20_000),
  observations: optText(5000),
});

const activityData = z.object({
  title: text(200).min(1, "La actividad necesita un título"),
  description: optText(20_000),
  dueDate: wfDay.nullable().optional(),
  priority: z.enum(WF_PRIORITIES).optional(),
  status: z.enum(WF_ACTIVITY_STATUSES).optional(),
  progress: wfPercent.nullable().optional(),
  observations: optText(5000),
  dependsOn: z.array(idSchema).max(WF_MAX_ITEMS).optional(),
});

/** Dónde vive una lista de verificación: la etapa, uno de sus procedimientos o una actividad. */
const owner = z.object({ stageId: idSchema, procedureId: idSchema.optional(), activityId: idSchema.optional() });
const ids = z.array(idSchema).max(WF_MAX_ITEMS);

export const structureOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("stage.add"), data: stageData, after: idSchema.nullable().optional() }),
  z.object({ op: z.literal("stage.update"), stageId: idSchema, data: stageData.partial() }),
  z.object({ op: z.literal("stage.delete"), stageId: idSchema }),
  z.object({ op: z.literal("stage.duplicate"), stageId: idSchema }),
  z.object({ op: z.literal("stage.reorder"), ids: ids }),
  z.object({ op: z.literal("procedure.add"), stageId: idSchema, data: procedureData }),
  z.object({ op: z.literal("procedure.update"), stageId: idSchema, procedureId: idSchema, data: procedureData.partial() }),
  z.object({ op: z.literal("procedure.delete"), stageId: idSchema, procedureId: idSchema }),
  z.object({ op: z.literal("procedure.reorder"), stageId: idSchema, ids }),
  z.object({ op: z.literal("activity.add"), stageId: idSchema, data: activityData }),
  z.object({ op: z.literal("activity.update"), stageId: idSchema, activityId: idSchema, data: activityData.partial() }),
  z.object({ op: z.literal("activity.delete"), stageId: idSchema, activityId: idSchema }),
  z.object({ op: z.literal("activity.reorder"), stageId: idSchema, ids }),
  z.object({ op: z.literal("activity.move"), stageId: idSchema, activityId: idSchema, toStageId: idSchema }),
  z.object({ op: z.literal("check.add"), owner, text: text(300).min(1, "El elemento no puede estar vacío") }),
  z.object({ op: z.literal("check.update"), owner, itemId: idSchema, text: text(300).min(1, "El elemento no puede estar vacío").optional(), done: z.boolean().optional() }),
  z.object({ op: z.literal("check.delete"), owner, itemId: idSchema }),
  z.object({ op: z.literal("check.reorder"), owner, ids }),
]);

export type StructureOp = z.infer<typeof structureOp>;
export type StageData = z.infer<typeof stageData>;
export type ActivityData = z.infer<typeof activityData>;
export type ProcedureData = z.infer<typeof procedureData>;
