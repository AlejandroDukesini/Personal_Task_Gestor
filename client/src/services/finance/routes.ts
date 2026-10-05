/**
 * Rutas del módulo de finanzas sobre la base local.
 *
 * Integridad que se garantiza aquí (y no en la UI, que puede fallar o ser
 * otra versión en otro dispositivo):
 *   - referencias válidas: no hay movimientos apuntando a cuentas inexistentes;
 *   - borrado seguro: una cuenta o categoría con historial no se borra, se
 *     archiva, para no dejar movimientos huérfanos ni alterar saldos pasados;
 *   - idempotencia: crear con un `id` ya existente devuelve lo que hay en vez
 *     de duplicar (reintentos, doble clic, dos dispositivos confirmando lo mismo);
 *   - atomicidad: `mutate` trabaja sobre una copia, así que un error a mitad
 *     de una operación no deja la base a medio escribir.
 */

import { z } from "zod";
import {
  ApiError,
  loadDb,
  mutate,
  newId,
  nowIso,
  tombstone,
  tagIdForOwner,
  tagOwnerActive,
  uniqueTagName,
  slugTag,
  type Db,
  type FinAllocation,
  type FinTagRow,
  type FinAccountRow,
  type FinBudgetRow,
  type FinCategoryRow,
  type FinGoalRow,
  type FinRecurringRow,
  type FinTransactionRow,
} from "@/services/localDb";
import { assign, created, find, noContent, ok, parse, type Route } from "@/services/routeKit";
import {
  accountInput,
  budgetInput,
  categoryInput,
  dateKey,
  goalInput,
  idSchema,
  positiveAmount,
  recurringInput,
  signedAmount,
  tagNameInput,
  transactionInput,
  allocationCap,
} from "./schemas";
import { accountBalances, allocationsOf, goalProgress, occurrencesBetween, recurringTxId } from "./calc";
import { todayKey } from "./dates";
import { applyFinanceImport, applyCsvImport, exportFinance, planCsvImport, planFinanceImport } from "./io";
import { applySmartImport, MAX_IMPORT_ROWS, planSmartImport } from "./import/engine";
import { IMPORT_FIELDS } from "./import/columns";
import { DUPLICATE_FIELDS, EDITABLE_FIELDS, type EntityChoice } from "./import/types";
import type { Cell } from "./import/normalize";

const ACCOUNT_COLORS: Record<string, string> = {
  cash: "#16a34a",
  bank: "#2563eb",
  savings: "#0d9488",
  credit_card: "#dc2626",
  wallet: "#9333ea",
  investment: "#ca8a04",
  other: "#64748b",
};

const ACCOUNT_ICONS: Record<string, string> = {
  cash: "Banknote",
  bank: "Landmark",
  savings: "PiggyBank",
  credit_card: "CreditCard",
  wallet: "Wallet",
  investment: "TrendingUp",
  other: "Circle",
};

/* ------------------------------------------------------------ validaciones */

type TxInput = z.infer<typeof transactionInput>;

type AllocationInput = { id?: string; tagId: string; amount: number; flow?: "assign" | "use" };

/**
 * Valida y normaliza las asignaciones de un movimiento:
 *  - cada etiqueta debe existir y, si es NUEVA en el movimiento, pertenecer a
 *    un presupuesto o meta activo (lo archivado conserva su historial pero no
 *    admite asignaciones nuevas);
 *  - la moneda de la finalidad debe coincidir con la del dinero asignado;
 *  - el total no puede superar el importe del movimiento;
 *  - una misma etiqueta y sentido se funden en una sola asignación.
 * El sentido (`flow`) se deduce del tipo salvo en transferencias, donde el
 * usuario elige aportar o retirar.
 */
function normalizeAllocations(
  db: Db,
  tx: { kind: FinTransactionRow["kind"]; amount: number; toAmount: number | null; accountId: string; toAccountId: string | null },
  input: AllocationInput[] | undefined,
  existing?: FinTransactionRow
): FinAllocation[] {
  if (!input || input.length === 0) return [];
  const previous = new Set((existing ? allocationsOf(db, existing) : []).map((a) => a.tagId));
  const currency = db.finAccounts.find((a) => a.id === (tx.kind === "transfer" ? tx.toAccountId : tx.accountId))?.currency;
  const merged = new Map<string, FinAllocation>();
  for (const a of input) {
    const tag = find(db.finTags, a.tagId, "Etiqueta financiera");
    if (!previous.has(tag.id) && !tagOwnerActive(db, tag)) {
      throw new ApiError(409, `#${tag.name} pertenece a un presupuesto o meta archivado o completado`);
    }
    const owner =
      tag.ownerType === "budget" ? db.finBudgets.find((b) => b.id === tag.ownerId) : db.finGoals.find((g) => g.id === tag.ownerId);
    if (owner && currency && owner.currency !== currency) {
      throw new ApiError(400, `#${tag.name} está en ${owner.currency} y este dinero en ${currency}`);
    }
    const flow: FinAllocation["flow"] =
      tx.kind === "income"
        ? "assign"
        : tx.kind === "expense"
          ? "use"
          : tx.kind === "adjustment"
            ? tx.amount > 0
              ? "assign"
              : "use"
            : a.flow ?? "assign";
    const key = `${tag.id}|${flow}`;
    const prev = merged.get(key);
    if (prev) prev.amount += a.amount;
    else merged.set(key, { id: a.id && /^[\w:-]{1,128}$/.test(a.id) ? a.id : newId(), tagId: tag.id, amount: a.amount, flow });
  }
  const out = [...merged.values()];
  const total = out.reduce((s, a) => s + a.amount, 0);
  if (total > allocationCap(tx)) {
    throw new ApiError(400, "Las asignaciones superan el importe del movimiento");
  }
  return out;
}

/** Crea o renombra la etiqueta obligatoria de un presupuesto o meta. */
function upsertOwnerTag(
  db: Db,
  owner: { id: string; name: string; color?: string; createdAt: string },
  ownerType: FinTagRow["ownerType"],
  requested: string | undefined
): FinTagRow {
  const id = tagIdForOwner(owner.id);
  const existing = db.finTags.find((t) => t.ownerId === owner.id);
  const ts = nowIso();
  if (existing) {
    if (requested !== undefined) {
      const name = slugTag(requested);
      if (name !== existing.name) {
        assertTagNameFree(db, name, existing.id);
        existing.name = name;
        existing.updatedAt = ts;
      }
    }
    return existing;
  }
  let name: string;
  if (requested) {
    name = slugTag(requested);
    assertTagNameFree(db, name, id);
  } else {
    name = uniqueTagName(db, owner.name, id);
  }
  const row: FinTagRow = { id, name, ownerType, ownerId: owner.id, color: owner.color ?? "#6366f1", createdAt: ts, updatedAt: ts };
  db.finTags.push(row);
  return row;
}

/** Evita dos finalidades activas con la misma etiqueta (comparación sin tildes/mayúsculas). */
function assertTagNameFree(db: Db, name: string, exceptId: string) {
  const clash = db.finTags.find(
    (t) => t.id !== exceptId && t.name.toLowerCase() === name.toLowerCase() && tagOwnerActive(db, t)
  );
  if (clash) {
    throw new ApiError(409, `La etiqueta #${name} ya la usa otra finalidad activa. Elige otro nombre.`);
  }
}

function allocationsReferencing(db: Db, tagId: string): number {
  let n = 0;
  for (const tx of db.finTransactions) if (allocationsOf(db, tx).some((a) => a.tagId === tagId)) n++;
  return n;
}

/** Comprueba referencias y normaliza un movimiento. Lanza ApiError si no es válido. */
function normalizeTx(db: Db, data: TxInput, existing?: FinTransactionRow) {
  const account = find(db.finAccounts, data.accountId, "Cuenta");
  // Se permite editar movimientos antiguos de una cuenta archivada (corregir
  // el historial), pero no añadirle movimientos nuevos.
  if (account.archived && (!existing || existing.accountId !== account.id)) {
    throw new ApiError(409, `La cuenta «${account.name}» está archivada`);
  }

  let toAccountId: string | null = null;
  let toAmount: number | null = null;
  if (data.kind === "transfer") {
    const to = find(db.finAccounts, data.toAccountId!, "Cuenta de destino");
    if (to.archived && (!existing || existing.toAccountId !== to.id)) {
      throw new ApiError(409, `La cuenta «${to.name}» está archivada`);
    }
    toAccountId = to.id;
    if (to.currency !== account.currency) {
      // Entre monedas distintas el importe recibido lo fija el banco: no se
      // inventa un tipo de cambio.
      if (!data.toAmount) {
        throw new ApiError(400, `Indica cuánto llega a «${to.name}» en ${to.currency}`);
      }
      toAmount = data.toAmount;
    }
  }

  let categoryId: string | null = null;
  if (data.categoryId) {
    const cat = find(db.finCategories, data.categoryId, "Categoría");
    if (data.kind === "income" && cat.kind === "expense") {
      throw new ApiError(400, `«${cat.name}» es una categoría de gasto`);
    }
    if (data.kind === "expense" && cat.kind === "income") {
      throw new ApiError(400, `«${cat.name}» es una categoría de ingreso`);
    }
    categoryId = cat.id;
  }

  // Compatibilidad: un `goalId` enviado por un cliente antiguo se traduce a
  // una asignación completa a la etiqueta de la meta.
  // Una edición que no envía `allocations` conserva las que ya tenía: no se
  // borra el destino del dinero por omisión.
  let allocInput: AllocationInput[] | undefined =
    data.allocations ?? (existing?.allocations?.length ? existing.allocations : undefined);
  if (!allocInput && data.goalId) {
    const goal = find(db.finGoals, data.goalId, "Meta de ahorro");
    const cap = allocationCap({ kind: data.kind, amount: data.amount, toAmount: data.toAmount ?? null });
    allocInput = [{ tagId: tagIdForOwner(goal.id), amount: cap, flow: data.kind === "expense" ? "use" : "assign" }];
  }
  const allocations = normalizeAllocations(
    db,
    { kind: data.kind, amount: data.amount, toAmount, accountId: account.id, toAccountId },
    allocInput,
    existing
  );

  // Etiquetas: solo las que existen, sin repetir.
  const known = new Set(db.tags.map((t) => t.id));
  const tagIds = [...new Set(data.tagIds ?? [])].filter((id) => known.has(id));

  return {
    kind: data.kind,
    amount: data.amount,
    accountId: account.id,
    toAccountId,
    toAmount,
    categoryId,
    date: data.date,
    concept: data.concept.trim(),
    description: data.description?.trim() || null,
    tagIds,
    allocations,
    goalId: null,
    reason: data.kind === "adjustment" ? data.reason?.trim() || null : null,
  };
}

/** Igualdad de contenido (sin marcas de tiempo) para la idempotencia. */
function sameTx(a: Omit<FinTransactionRow, "id" | "createdAt" | "updatedAt" | "recurringId">, b: FinTransactionRow) {
  return (
    a.kind === b.kind &&
    a.amount === b.amount &&
    a.accountId === b.accountId &&
    a.toAccountId === b.toAccountId &&
    a.toAmount === b.toAmount &&
    a.categoryId === b.categoryId &&
    a.date === b.date &&
    a.concept === b.concept &&
    JSON.stringify((a.allocations ?? []).map((x) => [x.tagId, x.amount, x.flow])) ===
      JSON.stringify((b.allocations ?? []).map((x) => [x.tagId, x.amount, x.flow]))
  );
}

function usage(db: Db, accountId: string) {
  return {
    transactions: db.finTransactions.filter((t) => t.accountId === accountId || t.toAccountId === accountId).length,
    recurring: db.finRecurring.filter((r) => r.accountId === accountId || r.toAccountId === accountId).length,
    budgets: db.finBudgets.filter((b) => b.accountIds.includes(accountId)).length,
    goals: db.finGoals.filter((g) => g.accountIds.includes(accountId)).length,
  };
}

function checkAccounts(db: Db, ids: string[]) {
  for (const id of ids) find(db.finAccounts, id, "Cuenta");
}

function checkCategories(db: Db, ids: string[]) {
  for (const id of ids) find(db.finCategories, id, "Categoría");
}

/* ---------------------------------------------------------------- rutas */

export const financeRoutes: Route[] = [
  /**
   * Estado completo del módulo. Los cálculos (resúmenes, gráficos,
   * presupuestos) los hace el cliente con `calc.ts` sobre estas filas: así un
   * cambio de filtro no necesita otra petición.
   */
  ["GET", "/finance/state", () => {
    const db = loadDb();
    const balances = accountBalances(db);
    return ok({
      accounts: db.finAccounts.map((a) => ({ ...a, balance: balances.get(a.id) ?? a.initialBalance })),
      categories: db.finCategories,
      transactions: [...db.finTransactions].sort(
        (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
      ),
      budgets: db.finBudgets,
      goals: db.finGoals,
      recurring: db.finRecurring,
      finTags: db.finTags,
      tags: db.tags,
      defaultCurrency: db.settings.currency,
    });
  }],

  /* ---------------------------------------------------------- cuentas */
  ["POST", "/finance/accounts", ({ body }) => {
    const data = parse(accountInput, body);
    return created(
      mutate((db) => {
        if (db.finAccounts.some((a) => !a.archived && a.name.toLowerCase() === data.name.toLowerCase())) {
          throw new ApiError(409, "Ya tienes una cuenta activa con ese nombre");
        }
        const ts = nowIso();
        const row: FinAccountRow = {
          id: newId(),
          name: data.name,
          type: data.type,
          currency: data.currency,
          initialBalance: data.initialBalance,
          description: data.description ?? null,
          color: data.color ?? ACCOUNT_COLORS[data.type],
          icon: data.icon ?? ACCOUNT_ICONS[data.type],
          archived: data.archived ?? false,
          includeInTotal: data.includeInTotal ?? true,
          createdAt: ts,
          updatedAt: ts,
        };
        db.finAccounts.push(row);
        return row;
      })
    );
  }],
  ["PUT", "/finance/accounts/:id", ({ params, body }) => {
    const data = parse(accountInput.partial(), body);
    return ok(
      mutate((db) => {
        const row = find(db.finAccounts, params.id, "Cuenta");
        if (data.currency && data.currency !== row.currency && usage(db, row.id).transactions > 0) {
          // Cambiar la moneda reinterpretaría todos los importes ya anotados.
          throw new ApiError(409, "No se puede cambiar la moneda de una cuenta con movimientos");
        }
        if (
          data.name &&
          db.finAccounts.some(
            (a) => a.id !== row.id && !a.archived && a.name.toLowerCase() === data.name!.toLowerCase()
          )
        ) {
          throw new ApiError(409, "Ya tienes una cuenta activa con ese nombre");
        }
        assign(row, data as Partial<FinAccountRow>);
        row.updatedAt = nowIso();
        return row;
      })
    );
  }],
  ["DELETE", "/finance/accounts/:id", ({ params }) => {
    mutate((db) => {
      const row = find(db.finAccounts, params.id, "Cuenta");
      const u = usage(db, row.id);
      if (u.transactions || u.recurring || u.budgets || u.goals) {
        throw new ApiError(
          409,
          `«${row.name}» tiene historial (${u.transactions} movimientos, ${u.recurring} recurrentes). Archívala para conservarlo.`
        );
      }
      db.finAccounts = db.finAccounts.filter((a) => a.id !== row.id);
      tombstone(db, "finAccounts", row.id);
    });
    return noContent();
  }],
  /**
   * Conciliación: el usuario dice cuánto hay de verdad en la cuenta y se
   * registra una corrección por la diferencia, con su motivo. El historial no
   * se reescribe: queda constancia del ajuste.
   */
  ["POST", "/finance/accounts/:id/reconcile", ({ params, body }) => {
    const data = parse(
      z.object({
        balance: signedAmount,
        date: dateKey.optional(),
        reason: z.string().trim().min(1, "Indica el motivo").max(300),
        id: idSchema.optional(),
      }),
      body
    );
    return mutate((db) => {
      const account = find(db.finAccounts, params.id, "Cuenta");
      const date = data.date ?? todayKey();
      const current = accountBalances(db, date).get(account.id) ?? 0;
      const delta = data.balance - current;
      if (delta === 0) return ok({ adjusted: false, delta: 0 });
      if (data.id && db.finTransactions.some((t) => t.id === data.id)) {
        return ok({ adjusted: false, delta: 0, duplicate: true });
      }
      const ts = nowIso();
      const tx: FinTransactionRow = {
        id: data.id ?? newId(),
        kind: "adjustment",
        amount: delta,
        accountId: account.id,
        toAccountId: null,
        toAmount: null,
        categoryId: null,
        date,
        concept: "Corrección de saldo",
        description: null,
        tagIds: [],
        goalId: null,
        allocations: [],
        recurringId: null,
        reason: data.reason,
        createdAt: ts,
        updatedAt: ts,
      };
      db.finTransactions.push(tx);
      return created({ adjusted: true, delta, transaction: tx });
    });
  }],

  /* -------------------------------------------------------- categorías */
  ["POST", "/finance/categories", ({ body }) => {
    const data = parse(categoryInput, body);
    return created(
      mutate((db) => {
        if (db.finCategories.some((c) => !c.archived && c.name.toLowerCase() === data.name.toLowerCase())) {
          throw new ApiError(409, "Ya existe una categoría con ese nombre");
        }
        const ts = nowIso();
        const row: FinCategoryRow = {
          id: newId(),
          name: data.name,
          kind: data.kind,
          color: data.color ?? "#64748b",
          icon: data.icon ?? "Tag",
          archived: data.archived ?? false,
          createdAt: ts,
          updatedAt: ts,
        };
        db.finCategories.push(row);
        return row;
      })
    );
  }],
  ["PUT", "/finance/categories/:id", ({ params, body }) => {
    const data = parse(categoryInput.partial(), body);
    return ok(
      mutate((db) => {
        const row = find(db.finCategories, params.id, "Categoría");
        if (data.kind && data.kind !== row.kind && data.kind !== "both") {
          const clash = db.finTransactions.some(
            (t) => t.categoryId === row.id && (t.kind === "income" || t.kind === "expense") && t.kind !== data.kind
          );
          if (clash) {
            throw new ApiError(409, "Hay movimientos del otro tipo en esta categoría; usa «ambos»");
          }
        }
        assign(row, data as Partial<FinCategoryRow>);
        row.updatedAt = nowIso();
        return row;
      })
    );
  }],
  ["DELETE", "/finance/categories/:id", ({ params }) => {
    mutate((db) => {
      const row = find(db.finCategories, params.id, "Categoría");
      const used =
        db.finTransactions.some((t) => t.categoryId === row.id) ||
        db.finRecurring.some((r) => r.categoryId === row.id) ||
        db.finBudgets.some((b) => b.categoryIds.includes(row.id));
      if (used) {
        throw new ApiError(409, `«${row.name}» está en uso. Archívala para ocultarla sin perder el historial.`);
      }
      db.finCategories = db.finCategories.filter((c) => c.id !== row.id);
      tombstone(db, "finCategories", row.id);
    });
    return noContent();
  }],

  /* ------------------------------------------------------- movimientos */
  ["POST", "/finance/transactions", ({ body }) => {
    const data = parse(transactionInput, body);
    return mutate((db) => {
      const fields = normalizeTx(db, data);
      if (data.id) {
        const prev = db.finTransactions.find((t) => t.id === data.id);
        if (prev) {
          // Reintento del mismo envío: se devuelve lo guardado, sin duplicar.
          if (sameTx(fields, prev)) return ok(prev);
          throw new ApiError(409, "Ya existe otro movimiento con ese identificador");
        }
      }
      const ts = nowIso();
      const row: FinTransactionRow = {
        id: data.id ?? newId(),
        ...fields,
        recurringId: null,
        createdAt: ts,
        updatedAt: ts,
      };
      db.finTransactions.push(row);
      return created(row);
    });
  }],
  ["PUT", "/finance/transactions/:id", ({ params, body }) => {
    const data = parse(transactionInput, body);
    return ok(
      mutate((db) => {
        const row = find(db.finTransactions, params.id, "Movimiento");
        // Se valida el movimiento COMPLETO resultante, no solo los campos
        // enviados: una edición parcial no puede dejar una transferencia sin destino.
        Object.assign(row, normalizeTx(db, data, row));
        row.updatedAt = nowIso();
        return row;
      })
    );
  }],
  ["DELETE", "/finance/transactions/:id", ({ params }) => {
    mutate((db) => {
      const row = find(db.finTransactions, params.id, "Movimiento");
      db.finTransactions = db.finTransactions.filter((t) => t.id !== row.id);
      tombstone(db, "finTransactions", row.id);
    });
    return noContent();
  }],

  /* ------------------------------------------------------- presupuestos */
  ["POST", "/finance/budgets", ({ body }) => {
    const data = parse(budgetInput, body);
    return created(
      mutate((db) => {
        checkCategories(db, data.categoryIds);
        checkAccounts(db, data.accountIds);
        const ts = nowIso();
        const row: FinBudgetRow = {
          id: newId(),
          name: data.name,
          description: data.description ?? null,
          kind: data.kind,
          amount: data.amount,
          currency: data.currency,
          categoryIds: data.kind === "saving" ? [] : [...new Set(data.categoryIds)],
          accountIds: [...new Set(data.accountIds)],
          period: data.period,
          startDate: data.startDate,
          endDate: data.endDate ?? null,
          status: data.status ?? "active",
          alertPercent: data.alertPercent,
          createdAt: ts,
          updatedAt: ts,
        };
        db.finBudgets.push(row);
        // Etiqueta obligatoria: la indicada o una generada del nombre.
        const tag = upsertOwnerTag(db, row, "budget", data.tag);
        return { ...row, tag };
      })
    );
  }],
  ["PUT", "/finance/budgets/:id", ({ params, body }) => {
    const data = parse(budgetInput, body);
    return ok(
      mutate((db) => {
        const row = find(db.finBudgets, params.id, "Presupuesto");
        checkCategories(db, data.categoryIds);
        checkAccounts(db, data.accountIds);
        const { tag: tagName, ...fields } = data;
        if (fields.currency !== row.currency && allocationsReferencing(db, tagIdForOwner(row.id)) > 0) {
          throw new ApiError(409, "No se puede cambiar la moneda: hay movimientos vinculados a su etiqueta");
        }
        assign(row, {
          ...fields,
          description: data.description ?? null,
          endDate: data.endDate ?? null,
          categoryIds: data.kind === "saving" ? [] : [...new Set(data.categoryIds)],
          accountIds: [...new Set(data.accountIds)],
        } as Partial<FinBudgetRow>);
        row.updatedAt = nowIso();
        const tag = upsertOwnerTag(db, row, "budget", tagName);
        return { ...row, tag };
      })
    );
  }],
  ["PATCH", "/finance/budgets/:id/status", ({ params, body }) => {
    const { status } = parse(z.object({ status: z.enum(["active", "paused", "archived"]) }), body);
    return ok(
      mutate((db) => {
        const row = find(db.finBudgets, params.id, "Presupuesto");
        row.status = status;
        row.updatedAt = nowIso();
        return row;
      })
    );
  }],
  ["DELETE", "/finance/budgets/:id", ({ params }) => {
    mutate((db) => {
      const row = find(db.finBudgets, params.id, "Presupuesto");
      const tagId = tagIdForOwner(row.id);
      const linked = allocationsReferencing(db, tagId);
      if (linked > 0) {
        // Borrarlo dejaría movimientos apuntando a una finalidad inexistente.
        throw new ApiError(409, `«${row.name}» tiene ${linked} movimiento(s) vinculados a su etiqueta. Archívalo para conservar el historial.`);
      }
      db.finBudgets = db.finBudgets.filter((b) => b.id !== params.id);
      tombstone(db, "finBudgets", params.id);
      if (db.finTags.some((t) => t.id === tagId)) {
        db.finTags = db.finTags.filter((t) => t.id !== tagId);
        tombstone(db, "finTags", tagId);
      }
    });
    return noContent();
  }],

  /* ------------------------------------------------------ metas de ahorro */
  ["POST", "/finance/goals", ({ body }) => {
    const data = parse(goalInput, body);
    return created(
      mutate((db) => {
        checkAccounts(db, data.accountIds);
        const ts = nowIso();
        const row: FinGoalRow = {
          id: newId(),
          name: data.name,
          description: data.description ?? null,
          targetAmount: data.targetAmount,
          currency: data.currency,
          startDate: data.startDate,
          deadline: data.deadline ?? null,
          accountIds: [...new Set(data.accountIds)],
          icon: data.icon ?? "PiggyBank",
          color: data.color ?? "#0d9488",
          status: data.status ?? "active",
          createdAt: ts,
          updatedAt: ts,
        };
        db.finGoals.push(row);
        const tag = upsertOwnerTag(db, row, "goal", data.tag);
        return { ...row, tag };
      })
    );
  }],
  ["PUT", "/finance/goals/:id", ({ params, body }) => {
    const data = parse(goalInput, body);
    return ok(
      mutate((db) => {
        const row = find(db.finGoals, params.id, "Meta de ahorro");
        checkAccounts(db, data.accountIds);
        const { tag: tagName, ...fields } = data;
        if (fields.currency !== row.currency && allocationsReferencing(db, tagIdForOwner(row.id)) > 0) {
          throw new ApiError(409, "No se puede cambiar la moneda: hay movimientos vinculados a su etiqueta");
        }
        assign(row, {
          ...fields,
          description: data.description ?? null,
          deadline: data.deadline ?? null,
          accountIds: [...new Set(data.accountIds)],
        } as Partial<FinGoalRow>);
        row.updatedAt = nowIso();
        const tag = upsertOwnerTag(db, row, "goal", tagName);
        if (tag.color !== row.color) {
          tag.color = row.color;
          tag.updatedAt = nowIso();
        }
        return { ...row, tag };
      })
    );
  }],
  ["PATCH", "/finance/goals/:id/status", ({ params, body }) => {
    const { status } = parse(
      z.object({ status: z.enum(["active", "paused", "completed", "archived"]) }),
      body
    );
    return ok(
      mutate((db) => {
        const row = find(db.finGoals, params.id, "Meta de ahorro");
        row.status = status;
        row.updatedAt = nowIso();
        return row;
      })
    );
  }],
  ["DELETE", "/finance/goals/:id", ({ params }) => {
    mutate((db) => {
      const row = find(db.finGoals, params.id, "Meta de ahorro");
      const tagId = tagIdForOwner(row.id);
      const linked = allocationsReferencing(db, tagId);
      if (linked > 0) {
        throw new ApiError(409, `«${row.name}» tiene ${linked} movimiento(s) vinculados. Archívala para conservar el historial.`);
      }
      db.finGoals = db.finGoals.filter((g) => g.id !== row.id);
      tombstone(db, "finGoals", row.id);
      if (db.finTags.some((t) => t.id === tagId)) {
        db.finTags = db.finTags.filter((t) => t.id !== tagId);
        tombstone(db, "finTags", tagId);
      }
      // Los objetivos generales vinculados pasan a seguimiento manual.
      for (const g of db.goals) {
        if (g.finGoalId === row.id) {
          g.finGoalId = null;
          g.source = "manual";
          g.updatedAt = nowIso();
        }
      }
    });
    return noContent();
  }],
  /**
   * Aportación a una meta: una transferencia real entre cuentas (o un ingreso
   * directo) marcada con la meta. El dinero se cuenta una vez: mueve saldo
   * entre cuentas y además suma a la meta, sin crear ingresos ficticios.
   */
  ["POST", "/finance/goals/:id/contribute", ({ params, body }) => {
    const data = parse(
      z.object({
        id: idSchema.optional(),
        amount: positiveAmount,
        date: dateKey,
        fromAccountId: idSchema,
        toAccountId: idSchema.nullable().optional(),
        withdraw: z.boolean().optional(),
        concept: z.string().trim().max(120).optional(),
      }),
      body
    );
    return mutate((db) => {
      const goal = find(db.finGoals, params.id, "Meta de ahorro");
      if (data.id) {
        const prev = db.finTransactions.find((t) => t.id === data.id);
        if (prev) return ok(prev);
      }
      if (!data.toAccountId) {
        throw new ApiError(400, "Elige la cuenta donde guardas el ahorro de esta meta");
      }
      // Aportar solo a metas activas (pausada = sin aportes; completada o
      // archivada = cerrada). Retirar se permite salvo archivada: es historial.
      if (!data.withdraw && goal.status !== "active") {
        throw new ApiError(409, `La meta «${goal.name}» no está activa: reactívala para aportar`);
      }
      if (data.withdraw) {
        if (goal.status === "archived") {
          throw new ApiError(409, `La meta «${goal.name}» está archivada: no admite retiradas`);
        }
        const saved = goalProgress(db, goal, todayKey()).saved;
        if (data.amount > saved) {
          throw new ApiError(409, "No puedes retirar más de lo ahorrado en esta meta");
        }
      }
      const [from, to] = data.withdraw
        ? [data.toAccountId, data.fromAccountId]
        : [data.fromAccountId, data.toAccountId];
      const fields = normalizeTx(db, {
        kind: "transfer",
        amount: data.amount,
        accountId: from,
        toAccountId: to,
        toAmount: null,
        categoryId: null,
        date: data.date,
        concept: data.concept || (data.withdraw ? `Retiro de «${goal.name}»` : `Aporte a «${goal.name}»`),
        allocations: [{ tagId: upsertOwnerTag(db, goal, "goal", undefined).id, amount: data.amount, flow: data.withdraw ? "use" : "assign" }],
      });
      // La cuenta del ahorro queda vinculada a la meta: así una retirada
      // posterior desde ella resta (ver `goalContribution`).
      if (!goal.accountIds.includes(data.toAccountId)) {
        goal.accountIds.push(data.toAccountId);
        goal.updatedAt = nowIso();
      }
      const ts = nowIso();
      const row: FinTransactionRow = { id: data.id ?? newId(), ...fields, recurringId: null, createdAt: ts, updatedAt: ts };
      db.finTransactions.push(row);
      const progress = goalProgress(db, goal, todayKey());
      if (goal.status === "active" && progress.remaining === 0) {
        goal.status = "completed";
        goal.updatedAt = nowIso();
      }
      return created(row);
    });
  }],

  /* -------------------------------------------------------- recurrentes */
  ["POST", "/finance/recurring", ({ body }) => {
    const data = parse(recurringInput, body);
    return created(
      mutate((db) => {
        find(db.finAccounts, data.accountId, "Cuenta");
        if (data.toAccountId) find(db.finAccounts, data.toAccountId, "Cuenta de destino");
        if (data.categoryId) find(db.finCategories, data.categoryId, "Categoría");
        if (data.goalId) find(db.finGoals, data.goalId, "Meta de ahorro");
        const ts = nowIso();
        const row: FinRecurringRow = {
          id: newId(),
          name: data.name,
          kind: data.kind,
          amount: data.amount,
          accountId: data.accountId,
          toAccountId: data.kind === "transfer" ? data.toAccountId ?? null : null,
          categoryId: data.kind === "transfer" ? null : data.categoryId ?? null,
          goalId: data.goalId ?? null,
          frequency: data.frequency,
          startDate: data.startDate,
          endDate: data.endDate ?? null,
          status: data.status ?? "active",
          skipped: [],
          note: data.note ?? null,
          allocations: checkTemplate(db, data.allocations),
          createdAt: ts,
          updatedAt: ts,
        };
        db.finRecurring.push(row);
        return row;
      })
    );
  }],
  ["PUT", "/finance/recurring/:id", ({ params, body }) => {
    const data = parse(recurringInput, body);
    return ok(
      mutate((db) => {
        const row = find(db.finRecurring, params.id, "Movimiento recurrente");
        find(db.finAccounts, data.accountId, "Cuenta");
        if (data.toAccountId) find(db.finAccounts, data.toAccountId, "Cuenta de destino");
        if (data.categoryId) find(db.finCategories, data.categoryId, "Categoría");
        if (data.goalId) find(db.finGoals, data.goalId, "Meta de ahorro");
        // Cambiar la fecha inicial o la frecuencia renumera las ocurrencias:
        // las ya confirmadas conservan su movimiento (son hechos reales).
        assign(row, {
          ...data,
          toAccountId: data.kind === "transfer" ? data.toAccountId ?? null : null,
          categoryId: data.kind === "transfer" ? null : data.categoryId ?? null,
          goalId: data.goalId ?? null,
          endDate: data.endDate ?? null,
          note: data.note ?? null,
          allocations: data.allocations === undefined ? row.allocations : checkTemplate(db, data.allocations),
        } as Partial<FinRecurringRow>);
        row.updatedAt = nowIso();
        return row;
      })
    );
  }],
  ["DELETE", "/finance/recurring/:id", ({ params }) => {
    mutate((db) => {
      find(db.finRecurring, params.id, "Movimiento recurrente");
      // Los movimientos ya registrados se conservan: ocurrieron de verdad.
      db.finRecurring = db.finRecurring.filter((r) => r.id !== params.id);
      tombstone(db, "finRecurring", params.id);
    });
    return noContent();
  }],
  /**
   * Registra como REAL una ocurrencia prevista. Idempotente por diseño: el id
   * del movimiento se deriva de (serie, fecha), así que confirmar dos veces
   * —o en dos dispositivos sin conexión— produce una sola fila.
   */
  ["POST", "/finance/recurring/:id/confirm", ({ params, body }) => {
    const data = parse(
      z.object({
        date: dateKey,
        paidDate: dateKey.optional(),
        amount: positiveAmount.optional(),
        accountId: idSchema.optional(),
        concept: z.string().trim().max(120).optional(),
      }),
      body
    );
    return mutate((db) => {
      const r = find(db.finRecurring, params.id, "Movimiento recurrente");
      if (occurrencesBetween(r, data.date, data.date).length !== 1) {
        throw new ApiError(400, "Esa fecha no corresponde a una ocurrencia de la serie");
      }
      const txId = recurringTxId(r.id, data.date);
      const prev = db.finTransactions.find((t) => t.id === txId);
      if (prev) return ok({ transaction: prev, created: false });

      const fields = normalizeTx(db, {
        kind: r.kind,
        amount: data.amount ?? r.amount,
        accountId: data.accountId ?? r.accountId,
        toAccountId: r.toAccountId,
        toAmount: null,
        categoryId: r.categoryId,
        date: data.paidDate ?? data.date,
        concept: data.concept || r.name,
        description: r.note,
        goalId: r.allocations?.length ? null : r.goalId,
        allocations: fitTemplate(db, r, data.amount ?? r.amount, txId),
      });
      const ts = nowIso();
      const row: FinTransactionRow = { id: txId, ...fields, recurringId: r.id, createdAt: ts, updatedAt: ts };
      db.finTransactions.push(row);
      if (r.skipped.includes(data.date)) {
        r.skipped = r.skipped.filter((d) => d !== data.date);
        r.updatedAt = nowIso();
      }
      return created({ transaction: row, created: true });
    });
  }],
  ["POST", "/finance/recurring/:id/skip", ({ params, body }) => {
    const { date, undo } = parse(z.object({ date: dateKey, undo: z.boolean().optional() }), body);
    return ok(
      mutate((db) => {
        const r = find(db.finRecurring, params.id, "Movimiento recurrente");
        if (occurrencesBetween(r, date, date).length !== 1) {
          throw new ApiError(400, "Esa fecha no corresponde a una ocurrencia de la serie");
        }
        const set = new Set(r.skipped);
        if (undo) set.delete(date);
        else set.add(date);
        r.skipped = [...set].sort();
        r.updatedAt = nowIso();
        return r;
      })
    );
  }],

  /* ------------------------------------------------ etiquetas financieras */
  ["PUT", "/finance/tags/:id", ({ params, body }) => {
    const data = parse(
      z.object({ name: tagNameInput.optional(), color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional() }),
      body
    );
    return ok(
      mutate((db) => {
        const tag = find(db.finTags, params.id, "Etiqueta financiera");
        // Renombrar no altera el historial: los movimientos la referencian por id.
        if (data.name !== undefined) {
          const name = slugTag(data.name);
          assertTagNameFree(db, name, tag.id);
          tag.name = name;
        }
        if (data.color) tag.color = data.color;
        tag.updatedAt = nowIso();
        return tag;
      })
    );
  }],
  ["DELETE", "/finance/tags/:id", ({ params }) => {
    mutate((db) => {
      const tag = find(db.finTags, params.id, "Etiqueta financiera");
      const ownerExists =
        tag.ownerType === "budget" ? db.finBudgets.some((b) => b.id === tag.ownerId) : db.finGoals.some((g) => g.id === tag.ownerId);
      if (ownerExists) {
        throw new ApiError(409, "Esta etiqueta es obligatoria para su presupuesto o meta. Renómbrala o archiva la finalidad.");
      }
      const linked = allocationsReferencing(db, tag.id);
      if (linked > 0) {
        throw new ApiError(409, `#${tag.name} tiene ${linked} movimiento(s) en su historial y no se puede borrar.`);
      }
      db.finTags = db.finTags.filter((t) => t.id !== tag.id);
      tombstone(db, "finTags", tag.id);
    });
    return noContent();
  }],

  /* ------------------------------------------------- importar / exportar */
  ["GET", "/finance/export", () => ok(exportFinance(loadDb()))],
  ["POST", "/finance/import/preview", ({ body }) => {
    const { data, mode } = parse(importBody, body);
    return ok(planFinanceImport(loadDb(), data, mode).summary);
  }],
  ["POST", "/finance/import", ({ body }) => {
    const { data, mode } = parse(importBody, body);
    return ok(mutate((db) => applyFinanceImport(db, data, mode)));
  }],
  ["POST", "/finance/import/csv/preview", ({ body }) => {
    const input = parse(csvBody, body);
    return ok(planCsvImport(loadDb(), input.text, input.options).summary);
  }],
  ["POST", "/finance/import/csv", ({ body }) => {
    const input = parse(csvBody, body);
    return ok(mutate((db) => applyCsvImport(db, input.text, input.options)));
  }],
  // Importación inteligente (CSV, Excel, JSON, SQLite, Cashew): fila a fila.
  ["POST", "/finance/import/smart/preview", ({ body }) => {
    const input = parse(smartBody, body);
    return ok(planSmartImport(loadDb(), input).preview);
  }],
  ["POST", "/finance/import/smart", ({ body }) => {
    const input = parse(smartBody, body);
    return ok(mutate((db) => applySmartImport(db, input)));
  }],
];

/** Celdas primitivas y acotadas. Bucle simple: con 50.000 filas zod celda a celda es lento. */
const isCell = (v: unknown): v is Cell => v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 10_000);
const cellRows = z.custom<Cell[][]>(
  (rows) => Array.isArray(rows) && rows.length <= MAX_IMPORT_ROWS + 1000 && rows.every((r) => Array.isArray(r) && r.length <= 300 && r.every(isCell)),
  "Filas con formato no válido"
);
const cellRecords = (max: number) =>
  z.custom<Record<string, Cell>[]>(
    (rows) => Array.isArray(rows) && rows.length <= max && rows.every((r) => !!r && typeof r === "object" && !Array.isArray(r) && Object.values(r).every(isCell)),
    "Registros con formato no válido"
  );
const notes = z.array(z.string().max(500)).max(40).optional();
/** Nombre normalizado de una cuenta/categoría del archivo -> decisión del usuario. */
const entityMap = z
  .record(z.string().regex(/^(create|none|exclude|id:[\w:.-]{1,128})$/, "Decisión no válida"))
  .refine((m) => Object.keys(m).length <= 5000, "Demasiadas asignaciones") as z.ZodType<Record<string, EntityChoice>>;

const smartBody = z.object({
  source: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("table"),
      format: z.enum(["csv", "tsv", "xlsx", "xls", "json", "sqlite", "sql"]),
      name: z.string().max(200).optional(),
      headers: z.array(z.string().max(500)).max(300),
      rows: cellRows,
      firstRow: z.number().int().min(1).max(10_000_000),
      notes,
      idColumns: z.array(z.string().max(500)).max(300).optional(),
    }),
    z.object({
      type: z.literal("cashew"),
      wallets: cellRecords(2000),
      categories: cellRecords(5000),
      transactions: cellRecords(MAX_IMPORT_ROWS),
      objectives: cellRecords(2000).optional().transform((v) => v ?? []),
      notes,
      origin: z.enum(["sqlite", "sql"]).optional(),
    }),
  ]),
  mapping: z.array(z.enum(IMPORT_FIELDS).nullable()).max(300).optional(),
  options: z
    .object({
      dateOrder: z.enum(["auto", "dmy", "mdy", "ymd"]),
      decimal: z.enum(["auto", ",", "."]),
      zone: z.enum(["local", "utc"]),
      allowRounding: z.boolean(),
      defaultAccountId: idSchema.nullable(),
      defaultCurrency: z.string().regex(/^[A-Z]{3}$/, "Moneda inválida (código ISO de 3 letras)").nullable(),
      createAccounts: z.boolean(),
      createCategories: z.boolean(),
      accountMap: entityMap,
      categoryMap: entityMap,
      duplicateFields: z.array(z.enum(DUPLICATE_FIELDS)).max(DUPLICATE_FIELDS.length),
      confirmed: z.array(z.enum(["dateOrder", "decimal", "currency", "mapping"])).max(4),
    })
    .partial()
    .optional(),
  edits: z
    .record(z.object(Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, z.string().max(2000).optional()]))))
    .refine((e) => Object.keys(e).length <= MAX_IMPORT_ROWS, "Demasiadas correcciones")
    .optional(),
  decisions: z.record(z.enum(["include", "exclude"])).optional(),
});

const importBody = z.object({
  data: z.unknown(),
  /** `merge`: añade y actualiza por id sin tocar lo demás. `newer`: solo sobrescribe si lo importado es más reciente. */
  mode: z.enum(["merge", "newer"]).default("newer"),
});

const csvBody = z.object({
  text: z.string().max(5_000_000, "El CSV supera 5 MB"),
  options: z
    .object({
      defaultAccountId: idSchema.nullable().optional(),
      createCategories: z.boolean().optional(),
    })
    .default({}),
});

/** Valida una plantilla de asignaciones de un recurrente. */
function checkTemplate(db: Db, input: { tagId: string; amount: number; flow?: "assign" | "use" }[] | undefined) {
  if (!input || input.length === 0) return [];
  return input.map((a) => {
    const tag = find(db.finTags, a.tagId, "Etiqueta financiera");
    if (!tagOwnerActive(db, tag)) throw new ApiError(409, `#${tag.name} no está activa`);
    return { tagId: tag.id, amount: a.amount, flow: a.flow ?? "assign" };
  });
}

/**
 * Asignaciones de una ocurrencia confirmada a partir de la plantilla. Si el
 * importe real es menor que el previsto, se reparte en orden hasta agotarlo
 * (nunca se asigna más de lo que entró). Ids deterministas: confirmar la misma
 * ocurrencia en dos dispositivos produce las mismas asignaciones. Se omiten
 * las finalidades ya archivadas.
 */
function fitTemplate(db: Db, r: FinRecurringRow, amount: number, txId: string) {
  let left = amount;
  const out: { id: string; tagId: string; amount: number; flow: "assign" | "use" }[] = [];
  (r.allocations ?? []).forEach((a, i) => {
    const tag = db.finTags.find((t) => t.id === a.tagId);
    if (!tag || !tagOwnerActive(db, tag) || left <= 0) return;
    const take = Math.min(a.amount, left);
    left -= take;
    out.push({ id: `${txId}-a${i}`.slice(0, 128), tagId: a.tagId, amount: take, flow: a.flow });
  });
  return out;
}
