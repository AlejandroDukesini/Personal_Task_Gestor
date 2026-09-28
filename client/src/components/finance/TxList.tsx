import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Edit3, Repeat, Scale, Trash2 } from "lucide-react";
import type { FinTransactionRow } from "@/services/localDb";
import type { FinanceData } from "@/hooks/useFinance";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { KIND_LABEL, Money } from "./shared";
import { PurposeChip } from "./purpose";
import { allocationsOf, type FinState } from "@/services/finance/calc";

const KIND_ICON = {
  income: ArrowDownLeft,
  expense: ArrowUpRight,
  transfer: ArrowLeftRight,
  adjustment: Scale,
};

function dayLabel(key: string) {
  return new Date(`${key}T12:00:00`).toLocaleDateString("es-CO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Lista de movimientos agrupada por día. En móvil es una lista de tarjetas
 * de una columna (sin tablas con scroll horizontal); en escritorio la misma
 * fila gana columnas.
 */
export function TxList({
  data,
  txs,
  onEdit,
  onDelete,
  compact,
  groupByDay = true,
}: {
  data: FinanceData;
  txs: FinTransactionRow[];
  onEdit?: (tx: FinTransactionRow) => void;
  onDelete?: (tx: FinTransactionRow) => void;
  compact?: boolean;
  groupByDay?: boolean;
}) {
  const acc = new Map(data.accounts.map((a) => [a.id, a]));
  const cat = new Map(data.categories.map((c) => [c.id, c]));
  const tag = new Map(data.tags.map((t) => [t.id, t]));
  const purpose = new Map(data.finTags.map((t) => [t.id, t]));
  const lite: FinState = {
    finAccounts: data.accounts,
    finCategories: data.categories,
    finTransactions: [],
    finBudgets: data.budgets,
    finGoals: data.goals,
    finRecurring: [],
    finTags: data.finTags,
  };

  if (txs.length === 0) {
    return <p className="text-sm text-subtle text-center py-8">No hay movimientos que mostrar.</p>;
  }

  const groups: { day: string; items: FinTransactionRow[] }[] = [];
  for (const t of txs) {
    const last = groups[groups.length - 1];
    // Sin agrupar por día, todo va en una sola lista continua.
    if (last && (!groupByDay || last.day === t.date)) last.items.push(t);
    else groups.push({ day: t.date, items: [t] });
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <section key={`${g.day}-${g.items[0].id}`} aria-label={dayLabel(g.day)}>
          {groupByDay && (
            <h3 className="text-xs uppercase tracking-wide text-subtle px-1 mb-1 capitalize">{dayLabel(g.day)}</h3>
          )}
          <ul className="divide-y divide-border rounded-lg border border-border">
            {g.items.map((t) => {
              const a = acc.get(t.accountId);
              const to = t.toAccountId ? acc.get(t.toAccountId) : undefined;
              const c = t.categoryId ? cat.get(t.categoryId) : undefined;
              const Icon = KIND_ICON[t.kind];
              const signed =
                t.kind === "income" ? t.amount : t.kind === "expense" ? -t.amount : t.kind === "adjustment" ? t.amount : 0;
              return (
                <li key={t.id} className="flex items-center gap-3 p-3 hover:bg-muted/40">
                  <span
                    className={cn(
                      "h-9 w-9 rounded-full flex items-center justify-center shrink-0",
                      t.kind === "income" && "bg-success/15 text-success",
                      t.kind === "expense" && "bg-danger/10 text-danger",
                      t.kind === "transfer" && "bg-primary/10 text-primary",
                      t.kind === "adjustment" && "bg-warning/15 text-warning"
                    )}
                    title={KIND_LABEL[t.kind]}
                  >
                    <Icon size={16} aria-hidden />
                    <span className="sr-only">{KIND_LABEL[t.kind]}</span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate flex items-center gap-1.5">
                      {t.concept}
                      {t.recurringId && <Repeat size={12} className="text-subtle shrink-0" aria-label="Recurrente" />}
                    </div>
                    <div className="text-xs text-subtle flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {!groupByDay && <span>{t.date}</span>}
                      <span className="truncate">
                        {a?.name ?? "Cuenta eliminada"}
                        {to && ` → ${to.name}`}
                      </span>
                      {c && (
                        <span className="inline-flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} aria-hidden />
                          {c.name}
                        </span>
                      )}
                      {t.reason && <span className="italic">«{t.reason}»</span>}
                      {allocationsOf(lite, t).map((a) => (
                        <PurposeChip
                          key={a.id}
                          tag={purpose.get(a.tagId)}
                          data={data}
                          amount={a.amount}
                          currency={(t.kind === "transfer" && t.toAccountId ? acc.get(t.toAccountId) : acc.get(t.accountId))?.currency ?? data.defaultCurrency}
                          flow={a.flow}
                        />
                      ))}
                      {!compact &&
                        t.tagIds.map((id) =>
                          tag.get(id) ? (
                            <Badge key={id} color={tag.get(id)!.color}>
                              {tag.get(id)!.name}
                            </Badge>
                          ) : null
                        )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {t.kind === "transfer" ? (
                      <Money cents={t.amount} currency={a?.currency ?? data.defaultCurrency} tone="none" className="text-sm font-medium text-subtle" />
                    ) : (
                      <Money cents={signed} currency={a?.currency ?? data.defaultCurrency} signed className="text-sm font-semibold" />
                    )}
                  </div>
                  {(onEdit || onDelete) && (
                    <div className="flex shrink-0">
                      {onEdit && (
                        <button
                          onClick={() => onEdit(t)}
                          className="p-2 rounded-md text-subtle hover:text-text hover:bg-muted"
                          aria-label={`Editar ${t.concept}`}
                        >
                          <Edit3 size={14} />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => onDelete(t)}
                          className="p-2 rounded-md text-subtle hover:text-danger hover:bg-muted"
                          aria-label={`Eliminar ${t.concept}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
