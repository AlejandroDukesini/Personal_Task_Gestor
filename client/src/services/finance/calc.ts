/**
 * Motor de cálculo financiero. Funciones PURAS sobre las filas guardadas:
 * no leen almacenamiento ni reloj (la fecha de hoy entra como parámetro), así
 * que se prueban sin montar nada y dan el mismo resultado en todos los
 * dispositivos que tengan los mismos datos.
 *
 * Reglas contables que se aplican en todo el módulo:
 *  - Ingreso y gasto son flujos EXTERNOS. Una transferencia entre cuentas
 *    propias no es ninguna de las dos cosas: mueve saldo, no lo crea.
 *  - Una corrección cambia el saldo pero no es ingreso ni gasto: se informa
 *    aparte para que un ajuste de conciliación no infle las estadísticas.
 *  - Todo importe es un entero de céntimos (ver `lib/money.ts`).
 */

import { tagIdForOwner } from "@/services/localDb";
import type {
  FinAccountRow,
  FinAllocation,
  FinTagRow,
  FinBudgetRow,
  FinCategoryRow,
  FinFrequency,
  FinGoalRow,
  FinRecurringRow,
  FinTransactionRow,
  TagRow,
} from "@/services/localDb";
import {
  addDays,
  addMonths,
  bucketFor,
  bucketKey,
  bucketsBetween,
  diffDays,
  inRange,
  maxKey,
  minKey,
  previousRange,
  rangeFor,
  type Bucket,
  type DateKey,
  type DateRange,
} from "./dates";

export interface FinState {
  finAccounts: FinAccountRow[];
  finCategories: FinCategoryRow[];
  finTransactions: FinTransactionRow[];
  finBudgets: FinBudgetRow[];
  finGoals: FinGoalRow[];
  finRecurring: FinRecurringRow[];
  finTags?: FinTagRow[];
  tags?: TagRow[];
}

/* ------------------------------------------------------------------ saldos */

/** Efecto con signo de un movimiento sobre UNA cuenta concreta. */
export function txEffect(tx: FinTransactionRow, accountId: string): number {
  switch (tx.kind) {
    case "income":
      return tx.accountId === accountId ? tx.amount : 0;
    case "expense":
      return tx.accountId === accountId ? -tx.amount : 0;
    case "adjustment":
      return tx.accountId === accountId ? tx.amount : 0;
    case "transfer": {
      let v = 0;
      if (tx.accountId === accountId) v -= tx.amount;
      if (tx.toAccountId === accountId) v += tx.toAmount ?? tx.amount;
      return v;
    }
  }
}

/**
 * Saldo de cada cuenta = saldo inicial + efecto de sus movimientos hasta
 * `asOf` (incluido). Sin `asOf`, incluye también los movimientos futuros
 * ya registrados.
 */
export function accountBalances(state: FinState, asOf?: DateKey): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of state.finAccounts) out.set(a.id, a.initialBalance);
  for (const tx of state.finTransactions) {
    if (asOf && tx.date > asOf) continue;
    if (out.has(tx.accountId)) out.set(tx.accountId, out.get(tx.accountId)! + txEffect(tx, tx.accountId));
    if (tx.kind === "transfer" && tx.toAccountId && tx.toAccountId !== tx.accountId && out.has(tx.toAccountId)) {
      out.set(tx.toAccountId, out.get(tx.toAccountId)! + txEffect(tx, tx.toAccountId));
    }
  }
  return out;
}

/** Saldo total por moneda de las cuentas que cuentan para el total. */
export function totalsByCurrency(
  state: FinState,
  balances = accountBalances(state),
  includeArchived = false
): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of state.finAccounts) {
    if (!a.includeInTotal) continue;
    if (a.archived && !includeArchived) continue;
    out.set(a.currency, (out.get(a.currency) ?? 0) + (balances.get(a.id) ?? 0));
  }
  return out;
}

/**
 * Moneda principal: la de más cuentas activas. No se convierten monedas entre
 * sí: sin un tipo de cambio fiable, cualquier conversión sería un dato
 * inventado. Las demás monedas se muestran por separado.
 */
export function baseCurrency(state: FinState, fallback: string): string {
  const count = new Map<string, number>();
  for (const a of state.finAccounts) {
    if (a.archived) continue;
    count.set(a.currency, (count.get(a.currency) ?? 0) + 1);
  }
  let best = fallback;
  let max = 0;
  for (const [c, n] of count) {
    if (n > max || (n === max && c === fallback)) {
      best = c;
      max = n;
    }
  }
  return best;
}

export function currencyOf(state: FinState, accountId: string | null | undefined): string | null {
  if (!accountId) return null;
  return state.finAccounts.find((a) => a.id === accountId)?.currency ?? null;
}

/* ------------------------------------------------------------ resúmenes */

export interface PeriodSummary {
  income: number;
  expense: number;
  /** income - expense: ahorro del periodo por flujos externos. */
  net: number;
  /** Suma con signo de las correcciones del periodo. */
  adjustments: number;
  /** Volumen movido entre cuentas propias (informativo). */
  transfers: number;
  count: number;
  /** Tasa de ahorro sobre ingresos (0-100). null si no hubo ingresos. */
  savingsRate: number | null;
}

function txInCurrency(state: FinState, tx: FinTransactionRow, currency: string): boolean {
  return currencyOf(state, tx.accountId) === currency;
}

export function periodSummary(state: FinState, range: DateRange, currency: string): PeriodSummary {
  let income = 0;
  let expense = 0;
  let adjustments = 0;
  let transfers = 0;
  let count = 0;
  for (const tx of state.finTransactions) {
    if (!inRange(tx.date, range) || !txInCurrency(state, tx, currency)) continue;
    count++;
    if (tx.kind === "income") income += tx.amount;
    else if (tx.kind === "expense") expense += tx.amount;
    else if (tx.kind === "adjustment") adjustments += tx.amount;
    else transfers += tx.amount;
  }
  const net = income - expense;
  return {
    income,
    expense,
    net,
    adjustments,
    transfers,
    count,
    savingsRate: income > 0 ? (net / income) * 100 : null,
  };
}

export interface CategorySlice {
  categoryId: string | null;
  name: string;
  color: string;
  total: number;
  count: number;
  txIds: string[];
}

/** Ingresos o gastos del periodo agrupados por categoría, de mayor a menor. */
export function categoryBreakdown(
  state: FinState,
  range: DateRange,
  kind: "income" | "expense",
  currency: string
): CategorySlice[] {
  const byId = new Map<string | null, CategorySlice>();
  for (const tx of state.finTransactions) {
    if (tx.kind !== kind || !inRange(tx.date, range) || !txInCurrency(state, tx, currency)) continue;
    const cat = state.finCategories.find((c) => c.id === tx.categoryId);
    const key = cat ? cat.id : null;
    let slice = byId.get(key);
    if (!slice) {
      slice = {
        categoryId: key,
        name: cat?.name ?? "Sin categoría",
        color: cat?.color ?? "#94a3b8",
        total: 0,
        count: 0,
        txIds: [],
      };
      byId.set(key, slice);
    }
    slice.total += tx.amount;
    slice.count++;
    slice.txIds.push(tx.id);
  }
  return [...byId.values()].sort((a, b) => b.total - a.total);
}

export interface CashflowPoint {
  key: DateKey;
  income: number;
  expense: number;
  net: number;
  adjustments: number;
  txIds: string[];
}

/** Ingresos/gastos por cubeta temporal, con cubetas vacías incluidas. */
export function cashflowSeries(
  state: FinState,
  range: DateRange,
  currency: string,
  bucket: Bucket = bucketFor(range)
): CashflowPoint[] {
  const points = new Map<DateKey, CashflowPoint>();
  for (const key of bucketsBetween(range, bucket)) {
    points.set(key, { key, income: 0, expense: 0, net: 0, adjustments: 0, txIds: [] });
  }
  for (const tx of state.finTransactions) {
    if (!inRange(tx.date, range) || !txInCurrency(state, tx, currency)) continue;
    const p = points.get(bucketKey(tx.date, bucket));
    if (!p) continue;
    if (tx.kind === "income") p.income += tx.amount;
    else if (tx.kind === "expense") p.expense += tx.amount;
    else if (tx.kind === "adjustment") p.adjustments += tx.amount;
    else continue; // las transferencias no son flujo externo
    p.net = p.income - p.expense;
    p.txIds.push(tx.id);
  }
  return [...points.values()];
}

export interface BalancePoint {
  key: DateKey;
  balance: number;
  /** Ahorro acumulado (ingresos - gastos) desde el inicio del rango. */
  savings: number;
}

/**
 * Saldo total al cierre de cada cubeta (cuentas que cuentan para el total, en
 * la moneda pedida). Incluye transferencias y correcciones: es el saldo real.
 */
export function balanceSeries(
  state: FinState,
  range: DateRange,
  currency: string,
  bucket: Bucket = bucketFor(range)
): BalancePoint[] {
  const accounts = state.finAccounts.filter((a) => a.includeInTotal && a.currency === currency);
  const ids = new Set(accounts.map((a) => a.id));
  const effect = (tx: FinTransactionRow) => {
    let v = 0;
    if (ids.has(tx.accountId)) v += txEffect(tx, tx.accountId);
    if (tx.kind === "transfer" && tx.toAccountId && tx.toAccountId !== tx.accountId && ids.has(tx.toAccountId)) {
      v += txEffect(tx, tx.toAccountId);
    }
    return v;
  };

  let balance = accounts.reduce((s, a) => s + a.initialBalance, 0);
  const sorted = [...state.finTransactions].sort((a, b) => a.date.localeCompare(b.date));
  let i = 0;
  // Saldo de apertura: todo lo anterior al rango.
  while (i < sorted.length && sorted[i].date < range.from) balance += effect(sorted[i++]);

  const keys = bucketsBetween(range, bucket);
  const out: BalancePoint[] = [];
  let savings = 0;
  for (let k = 0; k < keys.length; k++) {
    const end = k + 1 < keys.length ? addDays(keys[k + 1], -1) : range.to;
    while (i < sorted.length && sorted[i].date <= end) {
      const tx = sorted[i++];
      balance += effect(tx);
      if (txInCurrency(state, tx, currency)) {
        if (tx.kind === "income") savings += tx.amount;
        else if (tx.kind === "expense") savings -= tx.amount;
      }
    }
    out.push({ key: keys[k], balance, savings });
  }
  return out;
}

export interface AccountFlow {
  accountId: string;
  name: string;
  color: string;
  currency: string;
  income: number;
  expense: number;
  transferIn: number;
  transferOut: number;
  adjustments: number;
  net: number;
}

/** Entradas y salidas de cada cuenta, separando flujos externos e internos. */
export function accountFlows(state: FinState, range: DateRange): AccountFlow[] {
  const map = new Map<string, AccountFlow>();
  for (const a of state.finAccounts) {
    map.set(a.id, {
      accountId: a.id,
      name: a.name,
      color: a.color,
      currency: a.currency,
      income: 0,
      expense: 0,
      transferIn: 0,
      transferOut: 0,
      adjustments: 0,
      net: 0,
    });
  }
  for (const tx of state.finTransactions) {
    if (!inRange(tx.date, range)) continue;
    const from = map.get(tx.accountId);
    if (tx.kind === "income" && from) from.income += tx.amount;
    if (tx.kind === "expense" && from) from.expense += tx.amount;
    if (tx.kind === "adjustment" && from) from.adjustments += tx.amount;
    if (tx.kind === "transfer") {
      if (from) from.transferOut += tx.amount;
      const to = tx.toAccountId ? map.get(tx.toAccountId) : undefined;
      if (to) to.transferIn += tx.toAmount ?? tx.amount;
    }
  }
  for (const f of map.values()) {
    f.net = f.income - f.expense + f.transferIn - f.transferOut + f.adjustments;
  }
  return [...map.values()].filter(
    (f) => f.income || f.expense || f.transferIn || f.transferOut || f.adjustments
  );
}

/* -------------------------------------------------------------- presupuestos */

/** Ventana del presupuesto que contiene `day`, recortada a su vigencia. */
export function budgetWindow(b: FinBudgetRow, day: DateKey): DateRange | null {
  if (b.period === "custom") {
    const to = b.endDate ?? maxKey(day, b.startDate);
    return { from: b.startDate, to };
  }
  const preset = { weekly: "week", monthly: "month", quarterly: "quarter", yearly: "year" } as const;
  const win = rangeFor(preset[b.period], day);
  const from = maxKey(win.from, b.startDate);
  const to = b.endDate ? minKey(win.to, b.endDate) : win.to;
  if (from > to) return null;
  return { from, to };
}

/** Ventanas anteriores a la actual (más reciente primero), hasta `limit`. */
export function budgetHistory(b: FinBudgetRow, today: DateKey, limit = 12): DateRange[] {
  if (b.period === "custom") return [];
  const out: DateRange[] = [];
  const current = budgetWindow(b, today);
  let cursor = current ? addDays(current.from, -1) : today;
  while (out.length < limit && cursor >= b.startDate) {
    const w = budgetWindow(b, cursor);
    if (!w) break;
    out.push(w);
    cursor = addDays(w.from, -1);
  }
  return out;
}

/* ------------------------------------------------ finalidades (etiquetas) */

/**
 * Asignaciones efectivas de un movimiento. Las filas antiguas con `goalId`
 * (antes de las etiquetas) se leen como una asignación completa a la meta,
 * con el mismo signo que tenían: no se reescriben, así un dispositivo sin
 * actualizar y otro actualizado interpretan igual la misma fila.
 */
export function allocationsOf(state: FinState, tx: FinTransactionRow): FinAllocation[] {
  if (tx.allocations && tx.allocations.length) return tx.allocations;
  if (!tx.goalId) return [];
  const goal = state.finGoals.find((g) => g.id === tx.goalId);
  const v = goalContribution(tx, goal);
  if (v === 0) return [];
  return [{ id: `legacy-${tx.id}`, tagId: tagIdForOwner(tx.goalId), amount: Math.abs(v), flow: v > 0 ? "assign" : "use" }];
}

export function tagOf(state: FinState, ownerId: string): FinTagRow | undefined {
  return (state.finTags ?? []).find((t) => t.ownerId === ownerId);
}

export function tagLabel(tag: Pick<FinTagRow, "name"> | undefined | null): string {
  return tag ? `#${tag.name}` : "#—";
}

/** Nombre del presupuesto/meta dueño de la etiqueta, para desambiguar en la UI. */
export function tagOwner(state: FinState, tag: FinTagRow) {
  if (tag.ownerType === "budget") {
    const b = state.finBudgets.find((x) => x.id === tag.ownerId);
    return b ? { kind: "budget" as const, name: b.name, status: b.status, currency: b.currency, row: b } : null;
  }
  const g = state.finGoals.find((x) => x.id === tag.ownerId);
  return g ? { kind: "goal" as const, name: g.name, status: g.status, currency: g.currency, row: g } : null;
}

export interface TagStats {
  /** Destinado a la finalidad (flujo `assign`). */
  assigned: number;
  /** Gastado con cargo a la finalidad (flujo `use`). */
  used: number;
  /** assigned - used: lo que sigue apartado para la finalidad. */
  net: number;
  /** Importe vinculado desde ingresos / hacia gastos (independiente del flujo). */
  incomeLinked: number;
  expenseLinked: number;
  txIds: string[];
}

/** Totales de una etiqueta, opcionalmente dentro de un rango y con un filtro extra. */
export function tagStats(
  state: FinState,
  tagId: string,
  range?: DateRange,
  filter?: (tx: FinTransactionRow) => boolean
): TagStats {
  const s: TagStats = { assigned: 0, used: 0, net: 0, incomeLinked: 0, expenseLinked: 0, txIds: [] };
  for (const tx of state.finTransactions) {
    if (range && !inRange(tx.date, range)) continue;
    let touched = false;
    for (const a of allocationsOf(state, tx)) {
      if (a.tagId !== tagId) continue;
      if (filter && !filter(tx)) continue;
      touched = true;
      if (a.flow === "assign") s.assigned += a.amount;
      else s.used += a.amount;
      if (tx.kind === "income") s.incomeLinked += a.amount;
      if (tx.kind === "expense") s.expenseLinked += a.amount;
    }
    if (touched) s.txIds.push(tx.id);
  }
  s.net = s.assigned - s.used;
  return s;
}

/** Parte de un movimiento que queda sin finalidad. */
export function unallocatedOf(state: FinState, tx: FinTransactionRow): number {
  const cap = tx.kind === "transfer" ? tx.toAmount ?? tx.amount : Math.abs(tx.amount);
  return cap - allocationsOf(state, tx).reduce((s, a) => s + a.amount, 0);
}

export interface PurposeSlice {
  tagId: string | null;
  label: string;
  owner: string;
  color: string;
  amount: number;
  txIds: string[];
}

/**
 * Cómo se reparten los INGRESOS del periodo entre finalidades, más lo que
 * quedó sin asignar. La suma de las porciones es exactamente el total de
 * ingresos: una asignación reparte, no duplica.
 */
export function purposeDistribution(state: FinState, range: DateRange, currency: string): PurposeSlice[] {
  const byTag = new Map<string, PurposeSlice>();
  const free: PurposeSlice = { tagId: null, label: "Sin asignar", owner: "Dinero disponible", color: "#94a3b8", amount: 0, txIds: [] };
  for (const tx of state.finTransactions) {
    if (tx.kind !== "income" || !inRange(tx.date, range) || currencyOf(state, tx.accountId) !== currency) continue;
    let allocated = 0;
    for (const a of allocationsOf(state, tx)) {
      const tag = (state.finTags ?? []).find((t) => t.id === a.tagId);
      let slice = byTag.get(a.tagId);
      if (!slice) {
        const owner = tag ? tagOwner(state, tag) : null;
        slice = { tagId: a.tagId, label: tagLabel(tag), owner: owner?.name ?? "Finalidad eliminada", color: tag?.color ?? "#64748b", amount: 0, txIds: [] };
        byTag.set(a.tagId, slice);
      }
      slice.amount += a.amount;
      if (!slice.txIds.includes(tx.id)) slice.txIds.push(tx.id);
      allocated += a.amount;
    }
    const rest = tx.amount - allocated;
    if (rest > 0) {
      free.amount += rest;
      free.txIds.push(tx.id);
    }
  }
  const out = [...byTag.values()].sort((a, b) => b.amount - a.amount);
  if (free.amount > 0) out.push(free);
  return out;
}

/** Evolución acumulada (asignado − usado) de una etiqueta por cubeta. */
export function tagSeries(state: FinState, tagId: string, range: DateRange, bucket: Bucket = bucketFor(range)) {
  let opening = 0;
  for (const tx of state.finTransactions) {
    if (tx.date >= range.from) continue;
    for (const a of allocationsOf(state, tx)) if (a.tagId === tagId) opening += a.flow === "assign" ? a.amount : -a.amount;
  }
  const keys = bucketsBetween(range, bucket);
  const points = keys.map((key) => ({ key, assigned: 0, used: 0, balance: 0 }));
  const index = new Map(keys.map((k, i) => [k, i]));
  for (const tx of state.finTransactions) {
    if (!inRange(tx.date, range)) continue;
    const i = index.get(bucketKey(tx.date, bucket));
    if (i === undefined) continue;
    for (const a of allocationsOf(state, tx)) {
      if (a.tagId !== tagId) continue;
      if (a.flow === "assign") points[i].assigned += a.amount;
      else points[i].used += a.amount;
    }
  }
  let run = opening;
  for (const p of points) {
    run += p.assigned - p.used;
    p.balance = run;
  }
  return points;
}

/* -------------------------------------------------------------- presupuestos */

export type BudgetState = "ok" | "warning" | "exceeded" | "achieved" | "behind" | "upcoming";

export interface BudgetProgress {
  window: DateRange;
  /** Gasto: gastado con cargo a la etiqueta. Ahorro: neto apartado. */
  used: number;
  /** Destinado a la etiqueta en la ventana (fondos asignados). */
  assigned: number;
  remaining: number;
  /** Porcentaje usado (gasto) o conseguido (ahorro). Sin recortar. */
  pct: number;
  /** Porcentaje de la ventana ya transcurrido. */
  elapsedPct: number;
  daysLeft: number;
  /** Proyección lineal al cierre de la ventana al ritmo actual. */
  projected: number;
  state: BudgetState;
  txIds: string[];
  /** false si el presupuesto aún no tiene etiqueta (datos de otra versión). */
  tagged: boolean;
}

/** Criterios adicionales configurados (categoría, cuenta, moneda). */
function matchesBudget(state: FinState, b: FinBudgetRow, tx: FinTransactionRow): boolean {
  if (currencyOf(state, tx.kind === "transfer" ? tx.toAccountId : tx.accountId) !== b.currency) return false;
  if (b.categoryIds.length && !b.categoryIds.includes(tx.categoryId ?? "")) return false;
  if (b.accountIds.length && !b.accountIds.includes(tx.accountId) && !b.accountIds.includes(tx.toAccountId ?? "")) return false;
  return true;
}

/**
 * Progreso de un presupuesto. SOLO cuentan los movimientos vinculados a su
 * etiqueta (y que además cumplan sus criterios de fecha, categoría y cuenta):
 * un gasto de Alimentación sin la etiqueta #Alimentacion no consume ese
 * presupuesto. Nada se asigna automáticamente.
 *
 * - Gasto: `used` = gastado con cargo a la etiqueta (flujo `use`).
 * - Ahorro: `used` = neto apartado (asignado − retirado). Un ingreso cuenta
 *   solo por la parte que el usuario asignó explícitamente.
 */
export function budgetProgress(
  state: FinState,
  b: FinBudgetRow,
  window: DateRange,
  today: DateKey
): BudgetProgress {
  const tag = tagOf(state, b.id);
  const st = tag
    ? tagStats(state, tag.id, window, (tx) => matchesBudget(state, b, tx))
    : { assigned: 0, used: 0, net: 0, incomeLinked: 0, expenseLinked: 0, txIds: [] };
  const used = b.kind === "spending" ? st.used : st.net;

  const total = diffDays(window.from, window.to) + 1;
  const elapsed = today < window.from ? 0 : Math.min(total, diffDays(window.from, today) + 1);
  const elapsedPct = (elapsed / total) * 100;
  const pct = b.amount > 0 ? (used / b.amount) * 100 : 0;
  const projected = elapsed > 0 ? Math.round((used / elapsed) * total) : 0;

  let state_: BudgetState;
  if (today < window.from) state_ = "upcoming";
  else if (b.kind === "spending") {
    state_ = pct >= 100 ? "exceeded" : pct >= b.alertPercent || projected > b.amount ? "warning" : "ok";
  } else {
    // Ahorro "retrasado" si va más de 15 puntos por detrás del calendario.
    state_ = pct >= 100 ? "achieved" : elapsedPct - pct > 15 ? "behind" : "ok";
  }

  return {
    window,
    used,
    assigned: st.assigned,
    remaining: b.amount - used,
    pct,
    elapsedPct,
    daysLeft: Math.max(0, diffDays(today, window.to)),
    projected,
    state: state_,
    txIds: st.txIds,
    tagged: !!tag,
  };
}

/* ------------------------------------------------------- metas de ahorro */

/**
 * Aportación con signo de un movimiento con `goalId` (formato antiguo). Solo
 * se usa para interpretar filas previas a las etiquetas (ver `allocationsOf`).
 */
export function goalContribution(
  tx: FinTransactionRow,
  goal?: Pick<FinGoalRow, "accountIds">
): number {
  switch (tx.kind) {
    case "income":
      return tx.amount;
    case "transfer": {
      // Si la meta tiene cuentas propias, sacar dinero DE ellas es retirar.
      const own = goal?.accountIds ?? [];
      const fromOwn = own.includes(tx.accountId);
      const toOwn = !!tx.toAccountId && own.includes(tx.toAccountId);
      if (fromOwn && !toOwn) return -tx.amount;
      return tx.toAmount ?? tx.amount;
    }
    case "expense":
      return -tx.amount;
    case "adjustment":
      return tx.amount;
  }
}

export interface GoalProgress {
  /** Neto apartado: asignado − usado. */
  saved: number;
  assigned: number;
  used: number;
  remaining: number;
  pct: number;
  contributions: FinTransactionRow[];
  daysLeft: number | null;
  /** Aportación mensual necesaria para llegar a tiempo. null sin fecha límite. */
  requiredPerMonth: number | null;
  /** Media mensual aportada desde el inicio. */
  averagePerMonth: number;
  /** Fecha estimada de llegada al ritmo medio actual. null si no hay ritmo. */
  eta: DateKey | null;
  overdue: boolean;
}

/**
 * Progreso de una meta a partir de las asignaciones a su etiqueta. El dinero
 * cuenta cuando el usuario lo destina explícitamente (una asignación), no por
 * el mero hecho de haber entrado un ingreso.
 */
export function goalProgress(state: FinState, g: FinGoalRow, today: DateKey): GoalProgress {
  const tag = tagOf(state, g.id);
  const tagId = tag?.id ?? tagIdForOwner(g.id);
  const st = tagStats(state, tagId);
  const ids = new Set(st.txIds);
  const contributions = state.finTransactions.filter((tx) => ids.has(tx.id)).sort((a, b) => b.date.localeCompare(a.date));
  const saved = st.net;
  const remaining = Math.max(0, g.targetAmount - saved);
  const pct = g.targetAmount > 0 ? (saved / g.targetAmount) * 100 : 0;

  const daysLeft = g.deadline ? diffDays(today, g.deadline) : null;
  const monthsLeft = daysLeft !== null ? Math.max(daysLeft / 30.44, 0) : null;
  const requiredPerMonth =
    monthsLeft === null ? null : remaining === 0 ? 0 : Math.ceil(remaining / Math.max(monthsLeft, 1));

  const monthsElapsed = Math.max(diffDays(g.startDate, today) / 30.44, 1);
  const averagePerMonth = Math.round(saved / monthsElapsed);
  const eta =
    remaining === 0
      ? today
      : averagePerMonth > 0
        ? addDays(today, Math.ceil((remaining / averagePerMonth) * 30.44))
        : null;

  return {
    saved,
    assigned: st.assigned,
    used: st.used,
    remaining,
    pct,
    contributions,
    daysLeft,
    requiredPerMonth,
    averagePerMonth,
    eta,
    overdue: daysLeft !== null && daysLeft < 0 && remaining > 0,
  };
}

/* -------------------------------------------------------------- recurrentes */

/**
 * Id del movimiento que materializa la ocurrencia `date` de un recurrente.
 * Es DETERMINISTA a propósito: si el PC y el móvil confirman el mismo pago
 * sin conexión, generan la misma fila y la sincronización las funde en una.
 * El salario no se cobra dos veces por pulsar "confirmar" en dos pantallas.
 */
export function recurringTxId(recurringId: string, date: DateKey): string {
  return `rec-${recurringId}-${date}`;
}

const MAX_OCCURRENCES = 5000;

/** n-ésima fecha de la serie (n = 0 es `startDate`). */
export function nthOccurrence(r: Pick<FinRecurringRow, "startDate" | "frequency">, n: number): DateKey {
  const anchorDay = Number(r.startDate.slice(8, 10));
  switch (r.frequency) {
    case "daily":
      return addDays(r.startDate, n);
    case "weekly":
      return addDays(r.startDate, 7 * n);
    case "biweekly":
      return addDays(r.startDate, 14 * n);
    case "monthly":
      return addMonths(r.startDate, n, anchorDay);
    case "quarterly":
      return addMonths(r.startDate, 3 * n, anchorDay);
    case "yearly":
      return addMonths(r.startDate, 12 * n, anchorDay);
  }
}

/** Fechas de la serie dentro de [from, to], respetando inicio y fin. */
export function occurrencesBetween(r: FinRecurringRow, from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  const hardEnd = r.endDate ? minKey(to, r.endDate) : to;
  for (let n = 0; n < MAX_OCCURRENCES; n++) {
    const d = nthOccurrence(r, n);
    if (d > hardEnd) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export interface Occurrence {
  recurringId: string;
  date: DateKey;
  status: "done" | "skipped" | "overdue" | "upcoming";
  txId: string;
}

export interface RecurringStatus {
  next: Occurrence | null;
  overdue: Occurrence[];
  upcoming: Occurrence[];
  /** Importe equivalente al mes, para comparar series de distinta frecuencia. */
  monthlyEquivalent: number;
}

const MONTHLY_FACTOR: Record<FinFrequency, number> = {
  daily: 30.44,
  weekly: 30.44 / 7,
  biweekly: 30.44 / 14,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

export function monthlyEquivalent(r: Pick<FinRecurringRow, "amount" | "frequency">): number {
  return Math.round(r.amount * MONTHLY_FACTOR[r.frequency]);
}

/**
 * Estado de una serie: qué ocurrencias ya se registraron, cuáles están
 * vencidas SIN registrar y cuáles vienen. Una ocurrencia prevista nunca se da
 * por cobrada/pagada: solo cuenta como hecha si existe su movimiento real.
 */
export function recurringStatus(
  state: FinState,
  r: FinRecurringRow,
  today: DateKey,
  horizonDays = 45,
  lookbackDays = 120
): RecurringStatus {
  const existing = new Set(state.finTransactions.map((t) => t.id));
  const skipped = new Set(r.skipped);
  const from = maxKey(r.startDate, addDays(today, -lookbackDays));
  const to = addDays(today, horizonDays);

  const all: Occurrence[] = occurrencesBetween(r, from, to).map((date) => {
    const txId = recurringTxId(r.id, date);
    const status = existing.has(txId)
      ? "done"
      : skipped.has(date)
        ? "skipped"
        : date < today
          ? "overdue"
          : "upcoming";
    return { recurringId: r.id, date, status, txId };
  });

  const active = r.status === "active";
  const overdue = active ? all.filter((o) => o.status === "overdue") : [];
  const upcoming = active ? all.filter((o) => o.status === "upcoming") : [];
  return {
    next: overdue[0] ?? upcoming[0] ?? null,
    overdue,
    upcoming,
    monthlyEquivalent: monthlyEquivalent(r),
  };
}

/* ------------------------------------------------------------ análisis */

export interface Insight {
  id: string;
  level: "info" | "warning" | "success" | "danger";
  title: string;
  detail: string;
  /** Datos y supuestos en los que se basa, para que el usuario lo pueda juzgar. */
  basis: string;
}

export interface MonthlyAverages {
  months: number;
  income: number;
  expense: number;
  net: number;
  byCategory: Map<string | null, number>;
}

/** Medias mensuales de los últimos `months` meses COMPLETOS anteriores a `today`. */
export function monthlyAverages(
  state: FinState,
  today: DateKey,
  currency: string,
  months = 3
): MonthlyAverages {
  const currentMonthStart = `${today.slice(0, 7)}-01`;
  const from = addMonths(currentMonthStart, -months);
  const to = addDays(currentMonthStart, -1);
  const range = { from, to };

  // Solo cuentan los meses con datos: promediar sobre meses anteriores a la
  // primera anotación hundiría la media sin motivo real.
  const firstTx = state.finTransactions
    .filter((t) => txInCurrency(state, t, currency))
    .reduce<DateKey | null>((m, t) => (m === null || t.date < m ? t.date : m), null);
  let effectiveMonths = months;
  if (firstTx && firstTx > from) {
    const firstMonth = `${firstTx.slice(0, 7)}-01`;
    effectiveMonths = Math.max(0, Math.round(diffDays(firstMonth, currentMonthStart) / 30.44));
  }
  if (!firstTx) effectiveMonths = 0;

  const s = periodSummary(state, range, currency);
  const byCategory = new Map<string | null, number>();
  if (effectiveMonths > 0) {
    for (const slice of categoryBreakdown(state, range, "expense", currency)) {
      byCategory.set(slice.categoryId, Math.round(slice.total / effectiveMonths));
    }
  }
  const div = (v: number) => (effectiveMonths > 0 ? Math.round(v / effectiveMonths) : 0);
  return {
    months: effectiveMonths,
    income: div(s.income),
    expense: div(s.expense),
    net: div(s.net),
    byCategory,
  };
}

/**
 * Recomendaciones basadas SOLO en datos registrados. Cada una declara su base.
 * Si no hay historia suficiente se dice explícitamente en vez de extrapolar.
 */
export function buildInsights(
  state: FinState,
  today: DateKey,
  currency: string,
  fmt: (cents: number) => string
): Insight[] {
  const out: Insight[] = [];
  const avg = monthlyAverages(state, today, currency, 3);
  const month = rangeFor("month", today);
  const current = periodSummary(state, month, currency);

  if (state.finTransactions.length === 0) {
    return [
      {
        id: "no-data",
        level: "info",
        title: "Aún no hay movimientos",
        detail:
          "Registra tus ingresos y gastos durante unas semanas para obtener análisis y recomendaciones.",
        basis: "0 movimientos registrados.",
      },
    ];
  }

  if (avg.months < 2) {
    out.push({
      id: "insufficient-history",
      level: "info",
      title: "Historial insuficiente para detectar patrones",
      detail:
        "Con menos de dos meses completos de datos no se pueden calcular medias fiables. Los análisis de tendencia aparecerán cuando haya más historial.",
      basis: `${avg.months} mes(es) completo(s) con movimientos en ${currency}.`,
    });
  }

  // Tasa de ahorro
  if (avg.months >= 1 && avg.income > 0) {
    const rate = (avg.net / avg.income) * 100;
    out.push({
      id: "savings-rate",
      level: rate < 0 ? "danger" : rate < 10 ? "warning" : "success",
      title:
        rate < 0
          ? "Gastas más de lo que ingresas"
          : rate < 10
            ? "Tu tasa de ahorro es baja"
            : "Buena tasa de ahorro",
      detail:
        rate < 0
          ? `De media, los gastos superan a los ingresos en ${fmt(-avg.net)} al mes. Revisa las categorías con más peso.`
          : `Ahorras de media el ${rate.toFixed(1)} % de tus ingresos (${fmt(avg.net)} al mes).` +
            (rate < 10 ? " Una referencia habitual es apartar al menos un 10-20 %." : ""),
      basis: `Media de ${avg.months} mes(es) completo(s): ingresos ${fmt(avg.income)}, gastos ${fmt(avg.expense)}. Excluye transferencias y correcciones.`,
    });
  }

  // Variaciones por categoría: mes en curso proyectado vs media.
  if (avg.months >= 2) {
    const monthDays = diffDays(month.from, month.to) + 1;
    const elapsed = diffDays(month.from, today) + 1;
    // Proyectar con menos de 7 días transcurridos exagera cualquier gasto puntual.
    if (elapsed >= 7) {
      for (const slice of categoryBreakdown(state, { from: month.from, to: today }, "expense", currency)) {
        const base = avg.byCategory.get(slice.categoryId) ?? 0;
        if (base <= 0) continue;
        const projected = Math.round((slice.total / elapsed) * monthDays);
        const change = ((projected - base) / base) * 100;
        if (change >= 30 && projected - base > avg.expense * 0.03) {
          out.push({
            id: `cat-up-${slice.categoryId}`,
            level: "warning",
            title: `${slice.name}: gasto por encima de lo habitual`,
            detail: `Al ritmo actual cerrarías el mes en ${fmt(projected)}, un ${change.toFixed(0)} % más que tu media (${fmt(base)}).`,
            basis: `Proyección lineal de ${elapsed} de ${monthDays} días del mes frente a la media de ${avg.months} meses.`,
          });
        }
      }
    }
  }

  // Gastos fijos (recurrentes) vs ingresos
  const fixedMonthly = state.finRecurring
    .filter((r) => r.status === "active" && r.kind === "expense" && currencyOf(state, r.accountId) === currency)
    .reduce((s, r) => s + monthlyEquivalent(r), 0);
  const recurringIncome = state.finRecurring
    .filter((r) => r.status === "active" && r.kind === "income" && currencyOf(state, r.accountId) === currency)
    .reduce((s, r) => s + monthlyEquivalent(r), 0);
  const incomeRef = recurringIncome || avg.income;
  if (fixedMonthly > 0 && incomeRef > 0) {
    const share = (fixedMonthly / incomeRef) * 100;
    out.push({
      id: "fixed-share",
      level: share > 60 ? "warning" : "info",
      title: `Tus gastos fijos suponen el ${share.toFixed(0)} % de tus ingresos`,
      detail:
        share > 60
          ? `Los compromisos recurrentes (${fmt(fixedMonthly)}/mes) dejan poco margen para imprevistos y ahorro.`
          : `Compromisos recurrentes: ${fmt(fixedMonthly)}/mes. El resto es gasto variable y ahorro.`,
      basis: `Suma de gastos recurrentes activos convertidos a su equivalente mensual frente a ${recurringIncome ? "ingresos recurrentes" : "la media de ingresos"} (${fmt(incomeRef)}).`,
    });
  }

  // Suscripciones
  const subs = state.finRecurring.filter(
    (r) =>
      r.status === "active" &&
      r.kind === "expense" &&
      r.categoryId === "fincat-subscriptions" &&
      currencyOf(state, r.accountId) === currency
  );
  if (subs.length >= 2) {
    const total = subs.reduce((s, r) => s + monthlyEquivalent(r), 0);
    out.push({
      id: "subscriptions",
      level: "info",
      title: `${subs.length} suscripciones activas: ${fmt(total)} al mes`,
      detail: `Equivalen a ${fmt(total * 12)} al año. Revisa si todas se siguen usando.`,
      basis: "Movimientos recurrentes activos de la categoría Suscripciones.",
    });
  }

  // Presupuestos en riesgo
  for (const b of state.finBudgets) {
    if (b.status !== "active" || b.kind !== "spending") continue;
    const w = budgetWindow(b, today);
    if (!w) continue;
    const p = budgetProgress(state, b, w, today);
    if (p.state === "exceeded") {
      out.push({
        id: `budget-${b.id}`,
        level: "danger",
        title: `Presupuesto «${b.name}» superado`,
        detail: `Llevas ${fmt(p.used)} de ${fmt(b.amount)} (${p.pct.toFixed(0)} %).`,
        basis: `Gastos vinculados a su etiqueta (y a sus criterios) entre ${w.from} y ${w.to}.`,
      });
    } else if (p.state === "warning" && p.projected > b.amount) {
      out.push({
        id: `budget-${b.id}`,
        level: "warning",
        title: `«${b.name}» va camino de superarse`,
        detail: `Al ritmo actual cerrarías en ${fmt(p.projected)} frente a ${fmt(b.amount)}. Para no pasarte, limita el gasto a ${fmt(Math.max(0, Math.floor(p.remaining / Math.max(p.daysLeft, 1))))} por día.`,
        basis: `Proyección lineal: ${p.elapsedPct.toFixed(0)} % del periodo transcurrido y ${p.pct.toFixed(0)} % del presupuesto usado.`,
      });
    }
  }

  // Metas de ahorro: viabilidad
  for (const g of state.finGoals) {
    if (g.status !== "active" || g.currency !== currency) continue;
    const p = goalProgress(state, g, today);
    if (p.remaining === 0) continue;
    if (p.overdue) {
      out.push({
        id: `goal-${g.id}`,
        level: "warning",
        title: `La meta «${g.name}» superó su fecha límite`,
        detail: `Faltan ${fmt(p.remaining)}. Considera ampliar el plazo o ajustar el importe.`,
        basis: `Asignado a su etiqueta menos lo utilizado: ${fmt(p.saved)} de ${fmt(g.targetAmount)}.`,
      });
    } else if (p.requiredPerMonth !== null && avg.months >= 1) {
      const feasible = avg.net >= p.requiredPerMonth;
      out.push({
        id: `goal-${g.id}`,
        level: feasible ? "info" : "warning",
        title: `«${g.name}»: necesitas ${fmt(p.requiredPerMonth)} al mes`,
        detail: feasible
          ? `Tu ahorro medio (${fmt(avg.net)}/mes) cubre esa aportación si la destinas a esta meta.`
          : `Tu ahorro medio (${fmt(avg.net)}/mes) no alcanza. Faltarían unos ${fmt(p.requiredPerMonth - avg.net)} al mes, o ampliar el plazo.`,
        basis: `Restante ${fmt(p.remaining)} entre ${p.daysLeft} días. Comparado con la media de ahorro de ${avg.months} mes(es); no considera otras metas simultáneas.`,
      });
    }
  }

  // Liquidez frente a compromisos próximos
  const next30 = state.finRecurring
    .filter((r) => r.kind === "expense" && currencyOf(state, r.accountId) === currency)
    .flatMap((r) => {
      const st = recurringStatus(state, r, today, 30);
      return [...st.overdue, ...st.upcoming].map(() => r.amount);
    })
    .reduce((s, v) => s + v, 0);
  if (next30 > 0) {
    const balancesToday = accountBalances(state, today);
    const liquid = state.finAccounts
      .filter(
        (a) =>
          !a.archived &&
          a.currency === currency &&
          (a.type === "cash" || a.type === "bank" || a.type === "wallet")
      )
      .reduce((s, a) => s + (balancesToday.get(a.id) ?? 0), 0);
    if (liquid < next30) {
      out.push({
        id: "liquidity",
        level: "danger",
        title: "Liquidez insuficiente para los pagos previstos",
        detail: `Los pagos recurrentes de los próximos 30 días suman ${fmt(next30)} y tu saldo disponible es ${fmt(liquid)}.`,
        basis: "Saldo actual de efectivo, bancos y billeteras frente a gastos recurrentes pendientes o vencidos en 30 días. No incluye ingresos previstos.",
      });
    }
  }

  if (current.count > 0 && avg.months >= 1 && current.expense < avg.expense * 0.7 && diffDays(month.from, today) > 20) {
    out.push({
      id: "month-good",
      level: "success",
      title: "Este mes vas por debajo de tu gasto habitual",
      detail: `Llevas ${fmt(current.expense)} frente a una media de ${fmt(avg.expense)}.`,
      basis: "Gasto del mes en curso comparado con la media de meses completos anteriores.",
    });
  }

  const order = { danger: 0, warning: 1, info: 2, success: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

export interface SimulationInput {
  monthlyIncome: number;
  monthlyExpense: number;
  /** Recortes por categoría: importe mensual base y porcentaje de recorte. */
  cuts: { base: number; pct: number }[];
  extraSavings: number;
  target?: number;
  alreadySaved?: number;
}

export interface SimulationResult {
  monthlySavings: number;
  yearlySavings: number;
  monthsToTarget: number | null;
  savedByCuts: number;
}

/** Escenario "¿y si…?": impacto aproximado de recortar gastos. No es una predicción. */
export function simulateSavings(input: SimulationInput): SimulationResult {
  const savedByCuts = input.cuts.reduce((s, c) => s + Math.round((c.base * c.pct) / 100), 0);
  const monthlySavings = input.monthlyIncome - input.monthlyExpense + savedByCuts + input.extraSavings;
  let monthsToTarget: number | null = null;
  if (input.target !== undefined) {
    const remaining = Math.max(0, input.target - (input.alreadySaved ?? 0));
    monthsToTarget = remaining === 0 ? 0 : monthlySavings > 0 ? Math.ceil(remaining / monthlySavings) : null;
  }
  return { monthlySavings, yearlySavings: monthlySavings * 12, monthsToTarget, savedByCuts };
}

/** Ahorro periódico necesario para reunir `amount` antes de `deadline`. */
export function requiredSavings(amount: number, today: DateKey, deadline: DateKey) {
  const days = Math.max(diffDays(today, deadline), 1);
  return {
    days,
    perDay: Math.ceil(amount / days),
    perWeek: Math.ceil(amount / Math.max(days / 7, 1)),
    perMonth: Math.ceil(amount / Math.max(days / 30.44, 1)),
  };
}

export { previousRange };
