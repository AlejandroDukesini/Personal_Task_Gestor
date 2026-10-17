/**
 * Validación de proyectos. Una sola definición para la API local, las copias
 * de seguridad y la sincronización (filas que llegan de otro dispositivo).
 */

import { z } from "zod";
import { hexColor, idSchema } from "@/services/notes/schemas";
import { isNoteIcon } from "@/services/notes/icons";

const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Marca de tiempo inválida");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)").refine((v) => !Number.isNaN(Date.parse(v)), "Fecha inválida");
const text = (max: number) => z.string().trim().max(max);
// Los proyectos usan la misma biblioteca de iconos que las notas.
const icon = z.string().max(40).refine(isNoteIcon, "Icono desconocido");
/** Porcentaje manual: entero de 0 a 100. Nada de negativos ni de más de 100. */
export const percent = z.number({ invalid_type_error: "El porcentaje debe ser un número" }).int("El porcentaje debe ser un número entero").min(0, "El porcentaje mínimo es 0 %").max(100, "El porcentaje máximo es 100 %");

export const MAX_STAGES = 200;
export const MAX_OBJECTIVES = 50;
export const PROJECT_STATUSES = ["active", "inactive", "finished"] as const;

export const stageRow = z.object({
  id: idSchema,
  title: text(200).min(1),
  description: text(20_000).nullable(),
  progress: percent,
  createdAt: iso,
  updatedAt: iso,
});

export const objectiveRow = z.object({
  id: idSchema,
  text: text(300).min(1, "El objetivo no puede estar vacío"),
  done: z.boolean(),
});

const uniqueIds = (rows: { id: string }[]) => new Set(rows.map((r) => r.id)).size === rows.length;

export const projectRow = z.object({
  id: idSchema,
  title: text(200).min(1),
  icon,
  color: hexColor,
  tag: text(40).nullable(),
  startDate: day.nullable(),
  endDate: day.nullable(),
  description: text(20_000).nullable(),
  status: z.enum(PROJECT_STATUSES),
  finishedAt: iso.nullable(),
  objectives: z.array(objectiveRow).max(MAX_OBJECTIVES).refine(uniqueIds, "Objetivo repetido"),
  stages: z.array(stageRow).max(MAX_STAGES).refine(uniqueIds, "Etapa repetida"),
  deletedAt: iso.nullable(),
  createdAt: iso,
  updatedAt: iso,
});

export const PROJECT_ROW_SCHEMAS = { projects: projectRow } as const;

/* ------------------------------------------------------ entradas de la API */

export const objectiveInput = z.object({
  id: idSchema.optional(),
  text: text(300).min(1, "El objetivo no puede estar vacío"),
  done: z.boolean().optional(),
});

export const projectInput = z.object({
  id: idSchema.optional(),
  title: text(200).min(1, "El título es obligatorio"),
  icon: icon.optional(),
  color: hexColor.optional(),
  tag: text(40).nullable().optional(),
  startDate: day.nullable().optional(),
  endDate: day.nullable().optional(),
  description: text(20_000).nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  objectives: z.array(objectiveInput).max(MAX_OBJECTIVES, `Máximo ${MAX_OBJECTIVES} objetivos`).optional(),
  /** Etapas iniciales opcionales (solo al crear): se crean al 0 %. */
  stages: z.array(z.object({ title: text(200).min(1, "La etapa necesita un título") })).max(MAX_STAGES).optional(),
});

export const projectPatch = projectInput.omit({ id: true, stages: true }).partial();

export const stageInput = z.object({
  title: text(200).min(1, "La etapa necesita un título"),
  description: text(20_000).nullable().optional(),
  progress: percent.optional(),
});

export const stagePatch = stageInput.partial();

export const reorderInput = z.object({ ids: z.array(idSchema).max(MAX_STAGES) });
