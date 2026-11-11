/**
 * Validación de los SOP y plantillas. Una sola definición para la API local,
 * las copias de seguridad y la sincronización.
 */

import { z } from "zod";
import { hexColor, idSchema } from "@/services/notes/schemas";
import { fullStageRow, stagesArray } from "@/services/workflow/schemas";

const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Marca de tiempo inválida");
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullable().optional();

export const SOP_KINDS = ["sop", "template"] as const;
export const SOP_STATUSES = ["draft", "active", "archived"] as const;

export const sopRow = z.object({
  id: idSchema,
  kind: z.enum(SOP_KINDS),
  name: text(200).min(1),
  description: text(20_000).nullable(),
  objective: text(5000).nullable(),
  category: text(60).nullable(),
  version: text(30).min(1),
  status: z.enum(SOP_STATUSES),
  owner: text(120).nullable(),
  color: hexColor,
  stages: stagesArray(fullStageRow),
  createdAt: iso,
  updatedAt: iso,
});

export const SOP_ROW_SCHEMAS = { sops: sopRow } as const;

/** Origen de la estructura al crear: otro SOP o plantilla, o un proyecto. */
export const structureSource = z.object({ type: z.enum(["sop", "project"]), id: idSchema });

export const sopInput = z.object({
  id: idSchema.optional(),
  kind: z.enum(SOP_KINDS).optional(),
  name: text(200).min(1, "El nombre es obligatorio"),
  description: optText(20_000),
  objective: optText(5000),
  category: optText(60),
  version: text(30).min(1, "Indica una versión").optional(),
  status: z.enum(["draft", "active"]).optional(),
  owner: optText(120),
  color: hexColor.optional(),
  /** Copiar la estructura (copia independiente, desde cero). */
  from: structureSource.optional(),
});

export const sopPatch = sopInput.omit({ id: true, kind: true, from: true }).partial();

export const duplicateInput = z.object({
  /** Tipo de la copia: duplicar, guardar como plantilla o crear un SOP desde una plantilla. */
  kind: z.enum(SOP_KINDS).optional(),
  name: text(200).min(1).optional(),
});
