/**
 * Validación de las metas personales. Una sola definición para la API local,
 * las copias de seguridad y la sincronización.
 */

import { z } from "zod";
import { hexColor, idSchema } from "@/services/notes/schemas";
import { WF_PRIORITIES, wfDay, wfPercent } from "@/services/workflow/schemas";

const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Marca de tiempo inválida");
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullable().optional();

export const GOAL_STATUSES = ["planned", "in_progress", "paused", "completed"] as const;
export const MAX_HISTORY = 100;

export const personalGoalRow = z.object({
  id: idSchema,
  title: text(200).min(1),
  description: text(20_000).nullable(),
  category: text(60).nullable(),
  color: hexColor,
  priority: z.enum(WF_PRIORITIES),
  status: z.enum(GOAL_STATUSES),
  progress: wfPercent,
  startDate: wfDay.nullable(),
  targetDate: wfDay,
  observations: text(5000).nullable(),
  archived: z.boolean(),
  completedAt: iso.nullable(),
  history: z.array(z.object({ at: iso, text: text(300) })).max(MAX_HISTORY),
  sourceProjectId: idSchema.nullable(),
  createdAt: iso,
  updatedAt: iso,
});

export const PERSONAL_GOAL_ROW_SCHEMAS = { personalGoals: personalGoalRow } as const;

export const goalInput = z.object({
  id: idSchema.optional(),
  title: text(200).min(1, "El nombre de la meta es obligatorio"),
  description: optText(20_000),
  category: optText(60),
  color: hexColor.optional(),
  priority: z.enum(WF_PRIORITIES).optional(),
  status: z.enum(GOAL_STATUSES).optional(),
  progress: wfPercent.optional(),
  startDate: wfDay.nullable().optional(),
  targetDate: wfDay,
  observations: optText(5000),
});

export const goalPatch = goalInput.omit({ id: true }).partial();
