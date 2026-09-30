/**
 * Validación de notas. Una sola definición para la API local, las copias de
 * seguridad y la sincronización (filas que llegan de otro dispositivo).
 */

import { z } from "zod";
import { isSafeDoc } from "./content";
import { isNoteIcon } from "./icons";

export const idSchema = z.string().min(1).max(128);
const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Marca de tiempo inválida");
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido (#rrggbb)");
const icon = z.string().max(40).refine(isNoteIcon, "Icono desconocido");
const text = (max: number) => z.string().trim().max(max);

export const MAX_ATTACHMENTS = 30;
export const MAX_NOTE_TEXT = 200_000;

export const attachmentRow = z.object({
  id: idSchema,
  fileKey: z.string().regex(/^[0-9a-f]{64}$/, "Referencia de archivo inválida"),
  name: text(160).min(1),
  label: text(160).nullable(),
  kind: z.string().max(20),
  mime: z.string().max(100),
  size: z.number().int().min(0).max(100 * 1024 * 1024),
  addedAt: iso,
});

const content = z.custom<unknown>((v) => isSafeDoc(v), "Contenido con formato no permitido");

export const noteRow = z.object({
  id: idSchema,
  title: text(200).min(1),
  description: text(1000).nullable(),
  content,
  text: z.string().max(MAX_NOTE_TEXT),
  categoryId: idSchema.nullable(),
  subcategoryId: idSchema.nullable(),
  color: hexColor.nullable(),
  icon,
  attachments: z.array(attachmentRow).max(MAX_ATTACHMENTS),
  archived: z.boolean(),
  deletedAt: iso.nullable(),
  mathEnabled: z.boolean(),
  mathDecimals: z.number().int().min(0).max(10).nullable(),
  createdAt: iso,
  updatedAt: iso,
});

export const noteCategoryRow = z.object({
  id: idSchema,
  name: text(60).min(1),
  color: hexColor,
  icon,
  parentId: idSchema.nullable(),
  createdAt: iso,
  updatedAt: iso,
});

export const NOTE_ROW_SCHEMAS = { notes: noteRow, noteCategories: noteCategoryRow } as const;

/* ------------------------------------------------------ entradas de la API */

export const noteInput = z.object({
  id: idSchema.optional(),
  title: text(200).min(1, "El título es obligatorio"),
  description: text(1000).nullable().optional(),
  content: z.unknown().optional(),
  categoryId: idSchema.nullable().optional(),
  subcategoryId: idSchema.nullable().optional(),
  color: hexColor.nullable().optional(),
  icon: icon.optional(),
  attachments: z.array(attachmentRow).max(MAX_ATTACHMENTS, `Máximo ${MAX_ATTACHMENTS} adjuntos por nota`).optional(),
  archived: z.boolean().optional(),
  mathEnabled: z.boolean().optional(),
  mathDecimals: z.number().int().min(0).max(10).nullable().optional(),
});

export const noteCategoryInput = z.object({
  name: text(60).min(1, "El nombre es obligatorio"),
  color: hexColor.optional(),
  icon: icon.optional(),
  parentId: idSchema.nullable().optional(),
});

export const deleteCategoryInput = z.object({
  /** Qué hacer con las notas de la categoría (y de sus subcategorías). */
  strategy: z.enum(["reassign", "uncategorize", "trash"]),
  targetId: idSchema.nullable().optional(),
});
