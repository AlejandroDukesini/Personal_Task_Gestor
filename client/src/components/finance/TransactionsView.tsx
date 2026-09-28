import { useMemo, useState } from "react";
import { Download, Search, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { FinanceData } from "@/hooks/useFinance";
import type { FinTransactionRow, FinTxKind } from "@/services/localDb";
import { inRange, type DateRange } from "@/services/finance/dates";
import { transactionsToCsv } from "@/services/finance/io";
import { formatMoney } from "@/lib/money";
import { KIND_LABEL } from "./shared";
import { ownerOf } from "./purpose";
import { allocationsOf, type FinState } from "@/services/finance/calc";
import { TxList } from "./TxList";

type Sort = "date-desc" | "date-asc" | "amount-desc" | "amount-asc";
const PAGE = 100;

export function TransactionsView({
  data,
  range,
  restrictIds,
  onClearRestrict,
  onEdit,
  onDelete,
}: {
  data: FinanceData;
  range: DateRange;
  /** Drill-down desde un gráfico: solo estos movimientos. */
  restrictIds: { title: string; ids: string[] } | null;
  onClearRestrict: () => void;
  onEdit: (tx: FinTransactionRow) => void;
  onDelete: (tx: FinTransactionRow) => void;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"" | FinTxKind>("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tagId, setTagId] = useState("");
  /** "" = todas · "__none" = sin finalidad · id de etiqueta financiera. */
  const [purposeId, setPurposeId] = useState("");
  const [sort, setSort] = useState<Sort>("date-desc");
  const [allDates, setAllDates] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const only = restrictIds ? new Set(restrictIds.ids) : null;
    const lite: FinState = {
      finAccounts: data.accounts,
      finCategories: data.categories,
      finTransactions: [],
      finBudgets: data.budgets,
      finGoals: data.goals,
      finRecurring: [],
      finTags: data.finTags,
    };
    const list = data.transactions.filter((t) => {
      if (only) return only.has(t.id);
      if (!allDates && !inRange(t.date, range)) return false;
      if (kind && t.kind !== kind) return false;
      if (accountId && t.accountId !== accountId && t.toAccountId !== accountId) return false;
      if (categoryId && t.categoryId !== categoryId) return false;
      if (tagId && !t.tagIds.includes(tagId)) return false;
      if (purposeId) {
        const allocs = allocationsOf(lite, t);
        if (purposeId === "__none" ? allocs.length > 0 : !allocs.some((a) => a.tagId === purposeId)) return false;
      }
      if (needle && !`${t.concept} ${t.description ?? ""} ${t.reason ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const cmp: Record<Sort, (a: FinTransactionRow, b: FinTransactionRow) => number> = {
      "date-desc": (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
      "date-asc": (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
      "amount-desc": (a, b) => Math.abs(b.amount) - Math.abs(a.amount),
      "amount-asc": (a, b) => Math.abs(a.amount) - Math.abs(b.amount),
    };
    return list.sort(cmp[sort]);
  }, [data, q, kind, accountId, categoryId, tagId, purposeId, sort, allDates, range, restrictIds]);

  // Totales del resultado filtrado (solo moneda principal de cada cuenta).
  const totals = useMemo(() => {
    const byCur = new Map<string, { inc: number; exp: number }>();
    const acc = new Map(data.accounts.map((a) => [a.id, a.currency]));
    for (const t of filtered) {
      const c = acc.get(t.accountId) ?? data.defaultCurrency;
      const e = byCur.get(c) ?? { inc: 0, exp: 0 };
      if (t.kind === "income") e.inc += t.amount;
      if (t.kind === "expense") e.exp += t.amount;
      byCur.set(c, e);
    }
    return [...byCur.entries()];
  }, [filtered, data.accounts, data.defaultCurrency]);

  function exportCsv() {
    const blob = new Blob([transactionsToCsv({ finAccounts: data.accounts, finCategories: data.categories, tags: data.tags, finTags: data.finTags }, filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `movimientos-${range.from}_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const sorted = sort.startsWith("date");

  return (
    <div className="space-y-3">
      {restrictIds ? (
        <div className="flex items-center gap-2 text-sm gt-surface p-3">
          <span className="flex-1">
            Mostrando <strong>{restrictIds.title}</strong> ({restrictIds.ids.length})
          </span>
          <Button size="sm" variant="outline" onClick={onClearRestrict}>
            <X size={14} /> Quitar filtro
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div className="col-span-2 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
            <Input aria-label="Buscar movimientos" placeholder="Buscar concepto…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as any)}>
            <option value="">Todos los tipos</option>
            {(Object.keys(KIND_LABEL) as FinTxKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
          <Select aria-label="Cuenta" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Todas las cuentas</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Categoría" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Todas las categorías</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Ordenar" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="date-desc">Más recientes</option>
            <option value="date-asc">Más antiguos</option>
            <option value="amount-desc">Mayor importe</option>
            <option value="amount-asc">Menor importe</option>
          </Select>
          <Select aria-label="Finalidad" value={purposeId} onChange={(e) => setPurposeId(e.target.value)}>
            <option value="">Todas las finalidades</option>
            <option value="__none">Sin finalidad asignada</option>
            {data.finTags.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.name} — {ownerOf(data, t)?.name ?? "eliminada"}
              </option>
            ))}
          </Select>
          {data.tags.length > 0 && (
            <Select aria-label="Etiqueta" value={tagId} onChange={(e) => setTagId(e.target.value)}>
              <option value="">Etiquetas generales</option>
              {data.tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
          <label className="flex items-center gap-2 text-sm text-subtle col-span-2 md:col-span-2">
            <input type="checkbox" checked={allDates} onChange={(e) => setAllDates(e.target.checked)} className="accent-primary" />
            Buscar en todo el historial (ignora el periodo)
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-subtle">{filtered.length} movimiento(s)</span>
        {totals.map(([c, t]) => (
          <span key={c} className="tabular-nums">
            <span className="text-subtle">Ingresos</span> {formatMoney(t.inc, c)} ·{" "}
            <span className="text-subtle">Gastos</span> {formatMoney(t.exp, c)}
          </span>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download size={14} /> CSV
        </Button>
      </div>

      <Card>
        <CardContent className="p-2 sm:p-4">
          <TxList data={data} txs={filtered.slice(0, limit)} onEdit={onEdit} onDelete={onDelete} groupByDay={sorted} />
          {filtered.length > limit && (
            <div className="flex justify-center pt-3">
              <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                Mostrar más ({filtered.length - limit} restantes)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
