import { useMemo } from "react";
import { useResource } from "./useResource";
import { api } from "@/services/api";
import type {
  FinAccountRow,
  FinBudgetRow,
  FinCategoryRow,
  FinGoalRow,
  FinRecurringRow,
  FinTagRow,
  FinTransactionRow,
  TagRow,
} from "@/services/localDb";
import { baseCurrency, type FinState } from "@/services/finance/calc";

export type FinAccount = FinAccountRow & { balance: number };

export interface FinanceData {
  accounts: FinAccount[];
  categories: FinCategoryRow[];
  transactions: FinTransactionRow[];
  budgets: FinBudgetRow[];
  goals: FinGoalRow[];
  recurring: FinRecurringRow[];
  /** Etiquetas financieras (finalidades) de presupuestos y metas. */
  finTags: FinTagRow[];
  /** Etiquetas generales (compartidas con Tareas). */
  tags: TagRow[];
  defaultCurrency: string;
}

/**
 * Estado completo de finanzas + adaptador para el motor de cálculo. Se relee
 * solo tras escrituras propias (`reload`) o cuando la sincronización aplica
 * datos de otro dispositivo (evento `gt:sync-applied`, vía useResource).
 */
export function useFinance() {
  const res = useResource(() => api.get<FinanceData>("/finance/state"));
  const state = useMemo<FinState | null>(
    () =>
      res.data
        ? {
            finAccounts: res.data.accounts,
            finCategories: res.data.categories,
            finTransactions: res.data.transactions,
            finBudgets: res.data.budgets,
            finGoals: res.data.goals,
            finRecurring: res.data.recurring,
            finTags: res.data.finTags,
            tags: res.data.tags,
          }
        : null,
    [res.data]
  );
  const currency = useMemo(
    () => (state && res.data ? baseCurrency(state, res.data.defaultCurrency) : "COP"),
    [state, res.data]
  );
  return { ...res, state, currency };
}
