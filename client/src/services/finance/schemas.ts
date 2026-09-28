/**
 * Esquemas de validación de finanzas. Se usan en tres fronteras:
 *   1. La API local (lo que llega de los formularios).
 *   2. La importación de ficheros (entrada NO confiable).
 *   3. La sincronización (filas que llegan de otro dispositivo).
 * Una sola definición para las tres: si una regla cambia, cambia en todas.
 */

import { z } from "zod";
import { MAX_AMOUNT } from "@/lib/money";
import { isDateKey } from "./dates";

export const idSchema = z.string().min(1).max(128);
export const dateKey = z.string().refine(isDateKey, "Fecha inválida (AAAA-MM-DD)");
const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Marca de tiempo inválida");
const color = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "Color inválido");
const currency = z.string().regex(/^[A-Z]{3}$/, "Moneda inválida (código ISO de 3 letras)");
const text = (max: number) => z.string().trim().max(max);

/** Céntimos enteros, positivos. */
export const positiveAmount = z
  .number()
  .int("El importe debe ir en céntimos enteros")
  .positive("El importe debe ser mayor que cero")
  .max(MAX_AMOUNT, "Importe demasiado grande");

/** Céntimos enteros con signo (saldos iniciales, correcciones). */
export const signedAmount = z
  .number()
  .int("El importe debe ir en céntimos enteros")
  .min(-MAX_AMOUNT)
  .max(MAX_AMOUNT);

export const ACCOUNT_TYPES = [
  "cash",
  "bank",
  "savings",
  "credit_card",
  "wallet",
  "investment",
  "other",
] as const;
export const TX_KINDS = ["income", "expense", "transfer", "adjustment"] as const;
export const FREQUENCIES = ["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly"] as const;
export const PERIODS = ["weekly", "monthly", "quarterly", "yearly", "custom"] as const;

/* ------------------------------------------------ etiquetas y asignaciones */

/** Nombre de etiqueta financiera tal como lo escribe el usuario (con o sin "#"). */
export const tagNameInput = z
  .string()
  .trim()
  .max(40)
  .refine((v) => v.replace(/^#/, "").trim().length > 0, "La etiqueta no puede estar vacía");

export const allocationInput = z.object({
  id: idSchema.optional(),
  tagId: idSchema,
  amount: positiveAmount,
  flow: z.enum(["assign", "use"]).optional(),
});

export const allocationRow = z.object({
  id: idSchema,
  tagId: idSchema,
  amount: positiveAmount,
  flow: z.enum(["assign", "use"]),
});

/** Tope que pueden sumar las asignaciones de un movimiento. */
export function allocationCap(t: { kind: string; amount: number; toAmount?: number | null }): number {
  if (t.kind === "transfer") return t.toAmount ?? t.amount;
  return Math.abs(t.amount);
}

/* ------------------------------------------------------ entradas de la API */

export const accountInput = z.object({
  name: text(60).min(1, "El nombre es obligatorio"),
  type: z.enum(ACCOUNT_TYPES),
  currency,
  initialBalance: signedAmount.default(0),
  description: text(500).nullable().optional(),
  color: color.optional(),
  icon: text(40).optional(),
  archived: z.boolean().optional(),
  includeInTotal: z.boolean().optional(),
});

export const categoryInput = z.object({
  name: text(60).min(1, "El nombre es obligatorio"),
  kind: z.enum(["income", "expense", "both"]),
  color: color.optional(),
  icon: text(40).optional(),
  archived: z.boolean().optional(),
});

export const transactionInput = z
  .object({
    /** Clave de idempotencia opcional generada por el cliente. */
    id: idSchema.optional(),
    kind: z.enum(TX_KINDS),
    amount: signedAmount,
    accountId: idSchema,
    toAccountId: idSchema.nullable().optional(),
    toAmount: positiveAmount.nullable().optional(),
    categoryId: idSchema.nullable().optional(),
    date: dateKey,
    concept: text(120).min(1, "El concepto es obligatorio"),
    description: text(2000).nullable().optional(),
    tagIds: z.array(idSchema).max(20).optional(),
    goalId: idSchema.nullable().optional(),
    reason: text(300).nullable().optional(),
    allocations: z.array(allocationInput).max(20).optional(),
  })
  .superRefine((t, ctx) => {
    const total = (t.allocations ?? []).reduce((s, a) => s + a.amount, 0);
    if (total > allocationCap(t)) {
      ctx.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "Las asignaciones superan el importe del movimiento",
      });
    }
    if (t.kind === "adjustment") {
      if (t.amount === 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "Una corrección no puede ser 0" });
      if (!t.reason?.trim()) ctx.addIssue({ code: "custom", path: ["reason"], message: "Indica el motivo de la corrección" });
    } else if (t.amount <= 0) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "El importe debe ser mayor que cero" });
    }
    if (t.kind === "transfer") {
      if (!t.toAccountId) ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Elige la cuenta de destino" });
      else if (t.toAccountId === t.accountId)
        ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Origen y destino deben ser distintos" });
    }
  });

export const budgetInput = z
  .object({
    name: text(60).min(1, "El nombre es obligatorio"),
    description: text(500).nullable().optional(),
    kind: z.enum(["spending", "saving"]),
    amount: positiveAmount,
    currency,
    categoryIds: z.array(idSchema).max(50).default([]),
    accountIds: z.array(idSchema).max(50).default([]),
    period: z.enum(PERIODS),
    startDate: dateKey,
    endDate: dateKey.nullable().optional(),
    status: z.enum(["active", "paused", "archived"]).optional(),
    alertPercent: z.number().int().min(1).max(100).default(80),
    /** Etiqueta financiera; vacía = se genera a partir del nombre. */
    tag: tagNameInput.optional(),
  })
  .refine((b) => !b.endDate || b.endDate >= b.startDate, {
    path: ["endDate"],
    message: "La fecha final no puede ser anterior a la inicial",
  })
  .refine((b) => b.period !== "custom" || !!b.endDate, {
    path: ["endDate"],
    message: "Un presupuesto personalizado necesita fecha final",
  });

export const goalInput = z
  .object({
    name: text(60).min(1, "El nombre es obligatorio"),
    description: text(500).nullable().optional(),
    targetAmount: positiveAmount,
    currency,
    startDate: dateKey,
    deadline: dateKey.nullable().optional(),
    accountIds: z.array(idSchema).max(20).default([]),
    icon: text(40).optional(),
    color: color.optional(),
    status: z.enum(["active", "paused", "completed", "archived"]).optional(),
    tag: tagNameInput.optional(),
  })
  .refine((g) => !g.deadline || g.deadline >= g.startDate, {
    path: ["deadline"],
    message: "La fecha límite no puede ser anterior al inicio",
  });

export const recurringInput = z
  .object({
    name: text(80).min(1, "El nombre es obligatorio"),
    kind: z.enum(["income", "expense", "transfer"]),
    amount: positiveAmount,
    accountId: idSchema,
    toAccountId: idSchema.nullable().optional(),
    categoryId: idSchema.nullable().optional(),
    goalId: idSchema.nullable().optional(),
    frequency: z.enum(FREQUENCIES),
    startDate: dateKey,
    endDate: dateKey.nullable().optional(),
    status: z.enum(["active", "paused", "ended"]).optional(),
    note: text(500).nullable().optional(),
    allocations: z.array(allocationInput.omit({ id: true })).max(20).optional(),
  })
  .refine((r) => (r.allocations ?? []).reduce((s, a) => s + a.amount, 0) <= r.amount, {
    path: ["allocations"],
    message: "Las asignaciones superan el importe previsto",
  })
  .refine((r) => !r.endDate || r.endDate >= r.startDate, {
    path: ["endDate"],
    message: "La fecha final no puede ser anterior a la inicial",
  })
  .refine((r) => r.kind !== "transfer" || (!!r.toAccountId && r.toAccountId !== r.accountId), {
    path: ["toAccountId"],
    message: "Una transferencia necesita una cuenta de destino distinta",
  });

/* ------------------------------------------- filas completas (import/sync) */

const stamps = { createdAt: iso, updatedAt: iso };

export const accountRow = z.object({
  id: idSchema,
  name: text(60).min(1),
  type: z.enum(ACCOUNT_TYPES),
  currency,
  initialBalance: signedAmount,
  description: text(500).nullable(),
  color,
  icon: text(40),
  archived: z.boolean(),
  includeInTotal: z.boolean(),
  ...stamps,
});

export const categoryRow = z.object({
  id: idSchema,
  name: text(60).min(1),
  kind: z.enum(["income", "expense", "both"]),
  color,
  icon: text(40),
  archived: z.boolean(),
  ...stamps,
});

export const transactionRow = z
  .object({
  id: idSchema,
  kind: z.enum(TX_KINDS),
  amount: signedAmount,
  accountId: idSchema,
  toAccountId: idSchema.nullable(),
  toAmount: positiveAmount.nullable(),
  categoryId: idSchema.nullable(),
  date: dateKey,
  concept: text(120).min(1),
  description: text(2000).nullable(),
  tagIds: z.array(idSchema).max(20),
  goalId: idSchema.nullable(),
  recurringId: idSchema.nullable(),
  reason: text(300).nullable(),
  allocations: z.array(allocationRow).max(20).optional(),
  ...stamps,
  })
  // Filas importadas o sincronizadas: mismas reglas que la API.
  .refine((t) => (t.allocations ?? []).reduce((s, a) => s + a.amount, 0) <= allocationCap(t), {
    path: ["allocations"],
    message: "Las asignaciones superan el importe del movimiento",
  });

export const budgetRow = z.object({
  id: idSchema,
  name: text(60).min(1),
  description: text(500).nullable(),
  kind: z.enum(["spending", "saving"]),
  amount: positiveAmount,
  currency,
  categoryIds: z.array(idSchema).max(50),
  accountIds: z.array(idSchema).max(50),
  period: z.enum(PERIODS),
  startDate: dateKey,
  endDate: dateKey.nullable(),
  status: z.enum(["active", "paused", "archived"]),
  alertPercent: z.number().int().min(1).max(100),
  ...stamps,
});

export const goalRow = z.object({
  id: idSchema,
  name: text(60).min(1),
  description: text(500).nullable(),
  targetAmount: positiveAmount,
  currency,
  startDate: dateKey,
  deadline: dateKey.nullable(),
  accountIds: z.array(idSchema).max(20),
  icon: text(40),
  color,
  status: z.enum(["active", "paused", "completed", "archived"]),
  ...stamps,
});

export const recurringRow = z.object({
  id: idSchema,
  name: text(80).min(1),
  kind: z.enum(["income", "expense", "transfer"]),
  amount: positiveAmount,
  accountId: idSchema,
  toAccountId: idSchema.nullable(),
  categoryId: idSchema.nullable(),
  goalId: idSchema.nullable(),
  frequency: z.enum(FREQUENCIES),
  startDate: dateKey,
  endDate: dateKey.nullable(),
  status: z.enum(["active", "paused", "ended"]),
  skipped: z.array(dateKey).max(2000),
  note: text(500).nullable(),
  allocations: z.array(allocationRow.omit({ id: true })).max(20).optional(),
  ...stamps,
});

export const tagRow = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(40),
  ownerType: z.enum(["budget", "goal"]),
  ownerId: idSchema,
  color,
  ...stamps,
});

/** Esquema de fila por colección financiera. */
export const FINANCE_ROW_SCHEMAS = {
  finAccounts: accountRow,
  finCategories: categoryRow,
  finTransactions: transactionRow,
  finBudgets: budgetRow,
  finGoals: goalRow,
  finRecurring: recurringRow,
  finTags: tagRow,
} as const;
