import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  Database,
  Hash,
  LayoutDashboard,
  List,
  PiggyBank,
  Plus,
  Repeat,
  Target,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { useFinance } from "@/hooks/useFinance";
import { api } from "@/services/api";
import type { FinTransactionRow, FinTxKind } from "@/services/localDb";
import { cn } from "@/lib/utils";
import { PeriodFilter, defaultPeriod, errorMessage, type PeriodValue } from "@/components/finance/shared";
import { TransactionForm } from "@/components/finance/TransactionForm";
import { OverviewView } from "@/components/finance/OverviewView";
import { TransactionsView } from "@/components/finance/TransactionsView";
import { AccountsView } from "@/components/finance/AccountsView";
import { BudgetsView } from "@/components/finance/BudgetsView";
import { SavingsGoalsView } from "@/components/finance/SavingsGoalsView";
import { RecurringView } from "@/components/finance/RecurringView";
import { AnalysisView } from "@/components/finance/AnalysisView";
import { DataView } from "@/components/finance/DataView";
import { PurposesView } from "@/components/finance/PurposesView";

const TABS = [
  { id: "overview", label: "Resumen", icon: LayoutDashboard },
  { id: "transactions", label: "Movimientos", icon: List },
  { id: "accounts", label: "Cuentas", icon: Wallet },
  { id: "budgets", label: "Presupuestos", icon: Target },
  { id: "goals", label: "Ahorro", icon: PiggyBank },
  { id: "purposes", label: "Finalidades", icon: Hash },
  { id: "recurring", label: "Recurrentes", icon: Repeat },
  { id: "analysis", label: "Análisis", icon: BarChart3 },
  { id: "data", label: "Datos", icon: Database },
] as const;

type TabId = (typeof TABS)[number]["id"];
/** Pestañas en las que el periodo no aplica (listan todo). */
const NO_PERIOD: TabId[] = ["accounts", "budgets", "goals", "recurring", "data"];

export function Finance() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "overview") as TabId;
  const { data, state, currency, loading, error, reload } = useFinance();
  const [period, setPeriod] = useState<PeriodValue>(defaultPeriod);
  const [txDialog, setTxDialog] = useState<{ tx?: FinTransactionRow; kind?: FinTxKind } | null>(null);
  const [drill, setDrill] = useState<{ title: string; ids: string[] } | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ recurringId: string; date: string } | null>(null);

  const setTab = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", id);
    setParams(next, { replace: true });
  };

  // `/finanzas?new=expense` lo usa la paleta de comandos y el dashboard.
  useEffect(() => {
    const kind = params.get("new") as FinTxKind | null;
    if (!kind) return;
    setTxDialog({ kind: ["income", "expense", "transfer", "adjustment"].includes(kind) ? kind : "expense" });
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
  }, [params, setParams]);

  async function deleteTx(tx: FinTransactionRow) {
    if (!confirm(`¿Eliminar «${tx.concept}»? El saldo se recalculará y el borrado se sincronizará con tus otros dispositivos.`)) return;
    try {
      await api.delete(`/finance/transactions/${tx.id}`);
      toast.success("Movimiento eliminado");
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function onDrill(title: string, ids: string[]) {
    setDrill({ title, ids });
    setTab("transactions");
  }

  const hasAccounts = (data?.accounts.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title="Finanzas"
        description="Cuentas, movimientos, presupuestos y ahorro — sincronizado entre tus dispositivos."
        actions={
          hasAccounts && (
            <>
              <Button variant="outline" size="sm" onClick={() => setTxDialog({ kind: "income" })} aria-label="Nuevo ingreso">
                <ArrowDownLeft size={14} /> <span className="hidden sm:inline">Ingreso</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setTxDialog({ kind: "transfer" })} aria-label="Nueva transferencia">
                <ArrowLeftRight size={14} /> <span className="hidden sm:inline">Transferir</span>
              </Button>
              <Button size="sm" onClick={() => setTxDialog({ kind: "expense" })}>
                <ArrowUpRight size={14} /> Gasto
              </Button>
            </>
          )
        }
      />

      <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-2 mb-3 border-b border-border" aria-label="Secciones de finanzas">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 px-3 h-9 rounded-md text-sm whitespace-nowrap shrink-0",
              tab === t.id ? "bg-primary/10 text-primary font-medium" : "text-subtle hover:text-text hover:bg-muted"
            )}
          >
            <t.icon size={15} aria-hidden />
            {t.label}
          </button>
        ))}
      </nav>

      {!NO_PERIOD.includes(tab) && (
        <div className="mb-4">
          <PeriodFilter value={period} onChange={(p) => { setPeriod(p); setDrill(null); }} />
        </div>
      )}

      {error ? (
        <Card>
          <Empty title="No se pudieron cargar tus finanzas" description={error.message} action={<Button onClick={reload}>Reintentar</Button>} />
        </Card>
      ) : loading && !data ? (
        <div className="flex justify-center py-16" role="status" aria-label="Cargando">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-40" />
        </div>
      ) : data && state ? (
        !hasAccounts && tab !== "accounts" && tab !== "data" ? (
          <Card>
            <Empty
              icon={Wallet}
              title="Empieza creando una cuenta"
              description="Efectivo, banco, tarjeta o billetera digital: los saldos se calculan a partir de sus movimientos."
              action={
                <Button onClick={() => setTab("accounts")}>
                  <Plus size={16} /> Crear mi primera cuenta
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            {tab === "overview" && (
              <OverviewView
                data={data}
                state={state}
                currency={currency}
                range={period.range}
                onDrill={onDrill}
                onGoTab={setTab}
                onConfirmRecurring={(recurringId, date) => {
                  setConfirmTarget({ recurringId, date });
                  setTab("recurring");
                }}
              />
            )}
            {tab === "transactions" && (
              <TransactionsView
                data={data}
                range={period.range}
                restrictIds={drill}
                onClearRestrict={() => setDrill(null)}
                onEdit={(tx) => setTxDialog({ tx })}
                onDelete={deleteTx}
              />
            )}
            {tab === "accounts" && <AccountsView data={data} reload={reload} />}
            {tab === "budgets" && <BudgetsView data={data} state={state} reload={reload} onDrill={onDrill} />}
            {tab === "goals" && <SavingsGoalsView data={data} state={state} reload={reload} onDrill={onDrill} />}
            {tab === "recurring" && (
              <RecurringView data={data} state={state} reload={reload} confirmTarget={confirmTarget} onConfirmTarget={setConfirmTarget} />
            )}
            {tab === "analysis" && <AnalysisView data={data} state={state} currency={currency} range={period.range} onDrill={onDrill} />}
            {tab === "purposes" && (
              <PurposesView data={data} state={state} currency={currency} range={period.range} reload={reload} onDrill={onDrill} />
            )}
            {tab === "data" && <DataView data={data} reload={reload} />}
          </>
        )
      ) : null}

      <Dialog
        open={!!txDialog}
        onClose={() => setTxDialog(null)}
        title={txDialog?.tx ? "Editar movimiento" : "Nuevo movimiento"}
        size="lg"
      >
        {txDialog && data && (
          <TransactionForm
            data={data}
            tx={txDialog.tx}
            initialKind={txDialog.kind}
            onSaved={() => {
              setTxDialog(null);
              reload();
            }}
          />
        )}
      </Dialog>
    </>
  );
}
