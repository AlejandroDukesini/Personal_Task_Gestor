/**
 * Validación del módulo académico. Una sola definición para la API local, las
 * copias de seguridad y la sincronización (filas que llegan de otro dispositivo).
 */

import { z } from "zod";
import { hexColor, idSchema } from "@/services/notes/schemas";
import { percent } from "@/services/projects/schemas";

const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Marca de tiempo inválida");
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)").refine((v) => !Number.isNaN(Date.parse(v)), "Fecha inválida");
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:mm)");
const text = (max: number) => z.string().trim().max(max);
/** Texto opcional: cadena vacía = sin valor. */
const optText = (max: number) => text(max).nullable().optional();

export const ACTIVITY_TYPES = ["task", "exam", "presentation", "final_project", "group_work", "research", "reading", "delivery", "other"] as const;
export const ACTIVITY_STATUSES = ["pending", "in_progress", "review", "done"] as const;
export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const MAX_REFERENCES = 30;

export const semesterRow = z.object({
  id: idSchema,
  name: text(120).min(1),
  startDate: day,
  endDate: day,
  active: z.boolean(),
  notes: text(5000).nullable(),
  createdAt: iso,
  updatedAt: iso,
});

export const subjectRow = z.object({
  id: idSchema,
  semesterId: idSchema,
  name: text(150).min(1),
  code: text(40).nullable(),
  professor: text(120).nullable(),
  professorContact: text(300).nullable(),
  room: text(80).nullable(),
  credits: z.number().min(0).max(100).nullable(),
  description: text(5000).nullable(),
  color: hexColor,
  createdAt: iso,
  updatedAt: iso,
});

export const classRow = z.object({
  id: idSchema,
  semesterId: idSchema,
  subjectId: idSchema,
  day: z.number().int().min(1).max(7),
  startTime: time,
  endTime: time,
  professor: text(120).nullable(),
  room: text(80).nullable(),
  createdAt: iso,
  updatedAt: iso,
});

const url = z.string().trim().max(2000).refine((v) => /^https?:\/\//i.test(v), "El enlace debe empezar por http:// o https://");

export const referenceRow = z.object({
  id: idSchema,
  label: text(200).min(1, "La referencia necesita un nombre"),
  url: url.nullable(),
});

export const activityRow = z.object({
  id: idSchema,
  semesterId: idSchema,
  subjectId: idSchema.nullable(),
  title: text(200).min(1),
  description: text(20_000).nullable(),
  type: z.enum(ACTIVITY_TYPES),
  customType: text(60).nullable(),
  dueDate: day.nullable(),
  dueTime: time.nullable(),
  priority: z.enum(PRIORITIES),
  status: z.enum(ACTIVITY_STATUSES),
  progress: percent,
  references: z.array(referenceRow).max(MAX_REFERENCES),
  observations: text(5000).nullable(),
  completedAt: iso.nullable(),
  createdAt: iso,
  updatedAt: iso,
});

export const ACADEMIC_ROW_SCHEMAS = {
  acadSemesters: semesterRow,
  acadSubjects: subjectRow,
  acadClasses: classRow,
  acadActivities: activityRow,
} as const;

/* ------------------------------------------------------ entradas de la API */

export const semesterInput = z.object({
  id: idSchema.optional(),
  name: text(120).min(1, "El nombre es obligatorio"),
  startDate: day,
  endDate: day,
  active: z.boolean().optional(),
  notes: optText(5000),
});
export const semesterPatch = semesterInput.omit({ id: true }).partial();

export const subjectInput = z.object({
  id: idSchema.optional(),
  semesterId: idSchema,
  name: text(150).min(1, "El nombre de la materia es obligatorio"),
  code: optText(40),
  professor: optText(120),
  professorContact: optText(300),
  room: optText(80),
  credits: z.number().min(0, "Los créditos no pueden ser negativos").max(100).nullable().optional(),
  description: optText(5000),
  color: hexColor.optional(),
});
export const subjectPatch = subjectInput.omit({ id: true, semesterId: true }).partial();

export const classInput = z.object({
  id: idSchema.optional(),
  subjectId: idSchema,
  day: z.number().int().min(1, "Día inválido").max(7, "Día inválido"),
  startTime: time,
  endTime: time,
  professor: optText(120),
  room: optText(80),
  /** Guardar aunque se solape con otra clase (el usuario ya vio el aviso). */
  allowOverlap: z.boolean().optional(),
});
export const classPatch = classInput.omit({ id: true }).partial();

export const referenceInput = z.object({
  id: idSchema.optional(),
  label: text(200).min(1, "La referencia necesita un nombre"),
  url: z.union([url, z.literal("")]).nullable().optional(),
});

export const activityInput = z.object({
  id: idSchema.optional(),
  semesterId: idSchema,
  subjectId: idSchema.nullable().optional(),
  title: text(200).min(1, "El título es obligatorio"),
  description: optText(20_000),
  type: z.enum(ACTIVITY_TYPES).optional(),
  customType: optText(60),
  dueDate: day.nullable().optional(),
  dueTime: time.nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(ACTIVITY_STATUSES).optional(),
  progress: percent.optional(),
  references: z.array(referenceInput).max(MAX_REFERENCES, `Máximo ${MAX_REFERENCES} referencias`).optional(),
  observations: optText(5000),
});
export const activityPatch = activityInput.omit({ id: true, semesterId: true }).partial();
