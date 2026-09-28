import { useMemo } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  PiggyBank,
  Scale,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import { Button } from "@/components/ui/Button";
import type { FinanceData } from "@/hooks/useFinance";
import type { FinTransactionRow } from "@/services/localDb";
import { formatMoney } from "@/lib/money";
import {
  accountBalances,
  balanceSeries,
  budgetProgress,
  budgetWindow,
  cashflowSeries,
  categoryBreakdown,
  goalProgress,
  periodSummary,
  purposeDistribution,
  recurringStatus,
  totalsByCurrency,
  type FinState,
} from "@/services/finance/calc";
import { bucketFor, todayKey, type DateRange } from "@/services/finance/dates";
import { ChartCard, DataTable, LegendItem, SERIES, axisTick, bucketLabel, gridStroke, tooltipStyle, useChartAnimation } from "./charts";
import { Money, StatTile } from "./shared";
import { TxList } from "./TxList";

export function OverviewView({
  data,
  state,
  currency,
  range,
  onDrill,
  onGoTab,
  onConfirmRecurring,
}: {
  data: FinanceData;
  state: FinState;
  currency: string;
  range: DateRange;
  onDrill: (title: string, ids: string[]) => void;
  onGoTab: (tab: string) => void;
  onConfirmRecurring: (recurringId: string, date: string) => void;
}) {
  const animate = useChartAnimation();
  const today = todayKey();
  const fmt = (c: number) => formatMoney(c, currency, { compact: true });
  const bucket = bucketFor(range);

  const summary = useMemo(() => periodSummary(state, range, currency), [state, range, currency]);
  // Parte de los ingresos del periodo que no tiene finalidad asignada.
  const unassigned = useMemo(
    () => purposeDistribution(state, range, currency).find((d) => d.tagId === null)?.amount ?? 0,
    [state, range, currency]
  );
  const balancesToday = useMemo(() => accountBalances(state, today), [state, today]);
  const totals = useMemo(() => totalsByCurrency(state, balancesToday), [state, balancesToday]);
  const flow = useMemo(() => cashflowSeries(state, range, currency), [state, range, currency]);
  const balance = useMemo(() => balanceSeries(state, range, currency), [state, range, currency]);
  const expenses = useMemo(() => categoryBreakdown(state, range, "expense", currency), [state, range, currency]);
  const topExpenses = useMemo(() => {
    const top = expenses.slice(0, 6);
    const rest = expenses.slice(6);
    if (rest.length) {
      top.push({
        categoryId: "__other",
        name: "Otras",
        color: "#94a3b8",
        total: rest.reduce((s, x) => s + x.total, 0),
        count: rest.reduce((s, x) => s + x.count, 0),
        txIds: rest.flatMap((x) => x.txIds),
      });
    }
    return top;
  }, [expenses]);

  const savingsBalance = data.accounts
    .filter((a) => !a.archived && a.currency === currency && (a.type === "savings" || a.type === "investment"))
    .reduce((s, a) => s + (balancesToday.get(a.id) ?? 0), 0);

  const upcoming = useMemo(
    () =>
      state.finRecurring
        .flatMap((r) => {
          const st = recurringStatus(state, r, today, 30);
          return [...st.overdue, ...st.upcoming].map((o) => ({ ...o, r }));
        })
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 6),
    [state, today]
  );

  const activeBudgets = state.finBudgets.filter((b) => b.status === "active");
  const activeGoals = state.finGoals.filter((g) => g.status === "active");
  const latest: FinTransactionRow[] = data.transactions.slice(0, 6);
  const otherCurrencies = [...totals.entries()].filter(([c]) => c !== currency);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile
          label="Saldo total"
          icon={Wallet}
          hint={otherCurrencies.length ? otherCurrencies.map(([c, v]) => formatMoney(v, c)).join(" · ") : "Cuentas incluidas en el total"}
        >
          <Money cents={totals.get(currency) ?? 0} currency={currency} />
        </StatTile>
        <StatTile
          label="Ingresos"
          icon={ArrowDownLeft}
          hint={summary.income > 0 ? `${formatMoney(unassigned, currency, { compact: true })} sin finalidad` : `${summary.count} movimientos`}
        >
          <Money cents={summary.income} currency={currency} tone="none" />
        </StatTile>
        <StatTile label="Gastos" icon={ArrowUpRight}>
          <Money cents={summary.expense} currency={currency} tone="none" />
        </StatTile>
        <StatTile
          label="Balance neto"
          icon={Scale}
          hint={summary.savingsRate !== null ? `Tasa de ahorro ${summary.savingsRate.toFixed(0)} %` : "Sin ingresos en el periodo"}
        >
          <Money cents={summary.net} currency={currency} signed />
        </StatTile>
        <StatTile label="Ahorro acumulado" icon={PiggyBank} hint="Cuentas de ahorro e inversión" >
          <Money cents={savingsBalance} currency={currency} />
        </StatTile>
      </div>
      {summary.adjustments !== 0 && (
        <p className="text-xs text-subtle">
          Correcciones de saldo en el periodo: {formatMoney(summary.adjustments, currency, { signed: true })} (no cuentan como ingreso ni gasto).
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard
          className="lg:col-span-2"
          title="Ingresos y gastos"
          empty={summary.income === 0 && summary.expense === 0}
          legend={
            <>
              <LegendItem color={SERIES.income} label="Ingresos" />
              <LegendItem color={SERIES.expense} label="Gastos" />
            </>
          }
          chart={
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={flow}
                barGap={2}
                onClick={(e: any) => {
                  const p = e?.activePayload?.[0]?.payload;
                  if (p?.txIds?.length) onDrill(`Movimientos · ${bucketLabel(p.key, bucket)}`, p.txIds);
                }}
              >
                <CartesianGrid vertical={false} stroke={gridStroke} strokeDasharray="3 3" />
                <XAxis dataKey="key" tick={axisTick} tickFormatter={(k) => bucketLabel(k, bucket)} minTickGap={16} />
                <YAxis tick={axisTick} tickFormatter={fmt} width={64} />
                <Tooltip {...tooltipStyle} labelFormatter={(k) => bucketLabel(String(k), bucket)} formatter={(v: number) => formatMoney(v, currency)} />
                <Bar isAnimationActive={animate} dataKey="income" name="Ingresos" fill={SERIES.income} radius={[4, 4, 0, 0]} maxBarSize={28} cursor="pointer" />
                <Bar isAnimationActive={animate} dataKey="expense" name="Gastos" fill={SERIES.expense} radius={[4, 4, 0, 0]} maxBarSize={28} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          }
          table={
            <DataTable
              head={["Periodo", "Ingresos", "Gastos", "Neto"]}
              rows={flow.filter((p) => p.income || p.expense).map((p) => [
                bucketLabel(p.key, bucket),
                formatMoney(p.income, currency),
                formatMoney(p.expense, currency),
                formatMoney(p.net, currency),
              ])}
            />
          }
        />

        <ChartCard
          title="Gastos por categoría"
          empty={expenses.length === 0}
          height="h-auto"
          chart={
            <ul className="space-y-2.5">
              {topExpenses.map((s) => {
                const pct = summary.expense ? (s.total / summary.expense) * 100 : 0;
                return (
                  <li key={s.categoryId ?? "none"}>
                    <button
                      type="button"
                      className="w-full text-left group"
                      onClick={() => onDrill(`Gastos · ${s.name}`, s.txIds)}
                      aria-label={`${s.name}: ${formatMoney(s.total, currency)}, ${pct.toFixed(0)} %. Ver movimientos`}
                    >
                      <div className="flex items-center justify-between text-sm mb-1 gap-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: s.color }} aria-hidden />
                          <span className="truncate group-hover:underline">{s.name}</span>
                        </span>
                        <span className="tabular-nums text-xs text-subtle shrink-0">
                          {formatMoney(s.total, currency)} · {pct.toFixed(0)} %
                        </span>
                      </div>
                      <Progress value={pct} color={SERIES.expense} className="h-1.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          }
          table={
            <DataTable
              head={["Categoría", "Importe", "%"]}
              rows={expenses.map((s) => [
                s.name,
                formatMoney(s.total, currency),
                `${(summary.expense ? (s.total / summary.expense) * 100 : 0).toFixed(1)} %`,
              ])}
            />
          }
        />

        <ChartCard
          className="lg:col-span-2"
          title="Evolución del saldo"
          empty={data.accounts.length === 0}
          chart={
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={balance}>
                <defs>
                  <linearGradient id="finBal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES.income} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={SERIES.income} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={gridStroke} strokeDasharray="3 3" />
                <XAxis dataKey="key" tick={axisTick} tickFormatter={(k) => bucketLabel(k, bucket)} minTickGap={16} />
                <YAxis tick={axisTick} tickFormatter={fmt} width={64} domain={["auto", "auto"]} />
                <Tooltip {...tooltipStyle} cursor={{ stroke: gridStroke }} labelFormatter={(k) => bucketLabel(String(k), bucket)} formatter={(v: number) => formatMoney(v, currency)} />
                <Area isAnimationActive={animate} type="monotone" dataKey="balance" name="Saldo" stroke={SERIES.income} strokeWidth={2} fill="url(#finBal)" />
              </AreaChart>
            </ResponsiveContainer>
          }
          table={
            <DataTable
              head={["Fecha", "Saldo"]}
              rows={balance.map((p) => [bucketLabel(p.key, bucket), formatMoney(p.balance, currency)])}
            />
          }
        />

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <CalendarClock size={16} aria-hidden /> Próximos cobros y pagos
            </CardTitle>
            <button className="text-xs text-primary" onClick={() => onGoTab("recurring")}>
              Ver todos
            </button>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcoming.length === 0 && (
              <p className="text-sm text-subtle text-center py-6">Sin movimientos recurrentes en los próximos 30 días.</p>
            )}
            {upcoming.map((o) => (
              <div key={o.txId} className="flex items-center gap-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{o.r.name}</div>
                  <div className={o.status === "overdue" ? "text-xs text-danger" : "text-xs text-subtle"}>
                    {o.status === "overdue" ? "Vencido · " : ""}
                    {new Date(`${o.date}T12:00:00`).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}
                  </div>
                </div>
                <Money
                  cents={o.r.kind === "expense" ? -o.r.amount : o.r.amount}
                  currency={data.accounts.find((a) => a.id === o.r.accountId)?.currency ?? currency}
                  signed={o.r.kind === "income"}
                  className="text-sm"
                />
                <Button size="sm" variant="outline" onClick={() => onConfirmRecurring(o.recurringId, o.date)}>
                  Registrar
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="text-sm sm:text-base">Presupuestos activos</CardTitle>
            <button className="text-xs text-primary" onClick={() => onGoTab("budgets")}>
              Gestionar
            </button>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeBudgets.length === 0 && <p className="text-sm text-subtle text-center py-6">Sin presupuestos activos.</p>}
            {activeBudgets.slice(0, 4).map((b) => {
              const w = budgetWindow(b, today);
              if (!w) return null;
              const p = budgetProgress(state, b, w, today);
              const bad = p.state === "exceeded" || p.state === "behind";
              return (
                <div key={b.id}>
                  <div className="flex justify-between text-sm mb-1 gap-2">
                    <span className="truncate">{b.name}</span>
                    <span className={bad ? "text-danger text-xs" : "text-xs text-subtle"}>
                      {formatMoney(p.used, b.currency, { compact: true })} / {formatMoney(b.amount, b.currency, { compact: true })}
                    </span>
                  </div>
                  <Progress
                    value={p.pct}
                    color={p.state === "exceeded" ? "rgb(var(--danger))" : p.state === "warning" ? "rgb(var(--warning))" : undefined}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="text-sm sm:text-base">Metas de ahorro</CardTitle>
            <button className="text-xs text-primary" onClick={() => onGoTab("goals")}>
              Ver metas
            </button>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeGoals.length === 0 && <p className="text-sm text-subtle text-center py-6">Sin metas activas.</p>}
            {activeGoals.slice(0, 4).map((g) => {
              const p = goalProgress(state, g, today);
              return (
                <div key={g.id}>
                  <div className="flex justify-between text-sm mb-1 gap-2">
                    <span className="truncate">{g.name}</span>
                    <span className="text-xs text-subtle">{p.pct.toFixed(0)} %</span>
                  </div>
                  <Progress value={p.pct} color={g.color} />
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="text-sm sm:text-base">Últimos movimientos</CardTitle>
            <button className="text-xs text-primary" onClick={() => onGoTab("transactions")}>
              Historial
            </button>
          </CardHeader>
          <CardContent>
            <TxList data={data} txs={latest} compact groupByDay={false} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
