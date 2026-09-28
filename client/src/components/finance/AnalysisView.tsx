import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Lightbulb, XCircle } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Input";
import { Progress } from "@/components/ui/Progress";
import type { FinanceData } from "@/hooks/useFinance";
import { formatMoney } from "@/lib/money";
import {
  accountFlows,
  balanceSeries,
  budgetProgress,
  budgetWindow,
  buildInsights,
  categoryBreakdown,
  goalProgress,
  monthlyAverages,
  periodSummary,
  previousRange,
  requiredSavings,
  simulateSavings,
  type FinState,
  type Insight,
} from "@/services/finance/calc";
import { bucketFor, todayKey, type DateRange } from "@/services/finance/dates";
import { ChartCard, DataTable, LegendItem, SERIES, axisTick, bucketLabel, gridStroke, tooltipStyle, useChartAnimation } from "./charts";
import { MoneyInput } from "./shared";
import { cn } from "@/lib/utils";

const LEVEL_ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle };
const LEVEL_CLS = {
  info: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export function AnalysisView({
  data,
  state,
  currency,
  range,
  onDrill,
}: {
  data: FinanceData;
  state: FinState;
  currency: string;
  range: DateRange;
  onDrill: (title: string, ids: string[]) => void;
}) {
  const animate = useChartAnimation();
  const today = todayKey();
  const bucket = bucketFor(range);
  const fmt = (c: number) => formatMoney(c, currency);
  const fmtC = (c: number) => formatMoney(c, currency, { compact: true });
  const prev = previousRange(range);

  const insights = useMemo(() => buildInsights(state, today, currency, fmt), [state, today, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  const comparison = useMemo(() => {
    const cur = categoryBreakdown(state, range, "expense", currency);
    const old = categoryBreakdown(state, prev, "expense", currency);
    const keys = new Map<string, { name: string; now: number; before: number; ids: string[] }>();
    for (const s of cur) keys.set(s.categoryId ?? "_", { name: s.name, now: s.total, before: 0, ids: s.txIds });
    for (const s of old) {
      const k = s.categoryId ?? "_";
      const e = keys.get(k) ?? { name: s.name, now: 0, before: 0, ids: [] };
      e.before = s.total;
      keys.set(k, e);
    }
    return [...keys.values()].sort((a, b) => b.now + b.before - (a.now + a.before)).slice(0, 8);
  }, [state, range, prev.from, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  const sumNow = periodSummary(state, range, currency);
  const sumPrev = periodSummary(state, prev, currency);
  const incomeDist = useMemo(() => categoryBreakdown(state, range, "income", currency), [state, range, currency]);
  const savings = useMemo(() => balanceSeries(state, range, currency), [state, range, currency]);
  const flows = useMemo(() => accountFlows(state, range), [state, range]);
  const budgets = state.finBudgets.filter((b) => b.status === "active");
  const goals = state.finGoals.filter((g) => g.status === "active" || g.status === "completed");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm sm:text-base flex items-center gap-2">
            <Lightbulb size={16} aria-hidden /> Análisis y recomendaciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {insights.map((i: Insight) => {
              const Icon = LEVEL_ICON[i.level];
              return (
                <li key={i.id} className="flex gap-3">
                  <Icon size={18} className={cn("shrink-0 mt-0.5", LEVEL_CLS[i.level])} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{i.title}</p>
                    <p className="text-sm text-subtle">{i.detail}</p>
                    <p className="text-xs text-subtle mt-0.5">
                      <span className="font-medium">Base:</span> {i.basis}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-subtle mt-4">
            Calculado solo con tus datos registrados, en tu dispositivo. Las proyecciones son lineales y orientativas, no predicciones garantizadas.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Comparación con el periodo anterior (gastos)"
          empty={comparison.length === 0}
          legend={
            <>
              <LegendItem color={SERIES.expense} label="Este periodo" />
              <LegendItem color="rgb(var(--subtle))" label={`Anterior (${prev.from} → ${prev.to})`} />
            </>
          }
          height="h-72"
          chart={
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparison} layout="vertical" margin={{ left: 8 }} barGap={2}>
                <CartesianGrid horizontal={false} stroke={gridStroke} strokeDasharray="3 3" />
                <XAxis type="number" tick={axisTick} tickFormatter={fmtC} />
                <YAxis type="category" dataKey="name" tick={axisTick} width={96} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
                <Bar
                  isAnimationActive={animate}
                  dataKey="now"
                  name="Este periodo"
                  fill={SERIES.expense}
                  radius={[0, 4, 4, 0]}
                  maxBarSize={14}
                  cursor="pointer"
                  onClick={(d: any) => d?.ids?.length && onDrill(`Gastos · ${d.name}`, d.ids)}
                />
                <Bar isAnimationActive={animate} dataKey="before" name="Periodo anterior" fill="rgb(var(--subtle))" fillOpacity={0.5} radius={[0, 4, 4, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          }
          table={
            <DataTable
              head={["Categoría", "Actual", "Anterior", "Cambio"]}
              rows={comparison.map((c) => [
                c.name,
                fmt(c.now),
                fmt(c.before),
                c.before ? `${(((c.now - c.before) / c.before) * 100).toFixed(0)} %` : "—",
              ])}
            />
          }
          actions={
            <span className="text-xs text-subtle hidden sm:inline">
              Gasto {sumPrev.expense ? `${(((sumNow.expense - sumPrev.expense) / sumPrev.expense) * 100).toFixed(0)} %` : "—"}
            </span>
          }
        />

        <ChartCard
          title="Evolución del ahorro (ingresos − gastos acumulados)"
          empty={sumNow.count === 0}
          chart={
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={savings}>
                <CartesianGrid vertical={false} stroke={gridStroke} strokeDasharray="3 3" />
                <XAxis dataKey="key" tick={axisTick} tickFormatter={(k) => bucketLabel(k, bucket)} minTickGap={16} />
                <YAxis tick={axisTick} tickFormatter={fmtC} width={64} />
                <Tooltip {...tooltipStyle} cursor={{ stroke: gridStroke }} labelFormatter={(k) => bucketLabel(String(k), bucket)} formatter={(v: number) => fmt(v)} />
                <Line isAnimationActive={animate} type="monotone" dataKey="savings" name="Ahorro acumulado" stroke={SERIES.net} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          }
          table={<DataTable head={["Fecha", "Ahorro acumulado"]} rows={savings.map((p) => [bucketLabel(p.key, bucket), fmt(p.savings)])} />}
        />

        <ChartCard
          title="Distribución de ingresos"
          empty={incomeDist.length === 0}
          height="h-auto"
          chart={
            <ul className="space-y-2.5">
              {incomeDist.map((s) => {
                const pct = sumNow.income ? (s.total / sumNow.income) * 100 : 0;
                return (
                  <li key={s.categoryId ?? "none"}>
                    <button type="button" className="w-full text-left" onClick={() => onDrill(`Ingresos · ${s.name}`, s.txIds)}>
                      <div className="flex justify-between text-sm mb-1 gap-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: s.color }} aria-hidden />
                          <span className="truncate">{s.name}</span>
                        </span>
                        <span className="text-xs text-subtle tabular-nums">
                          {fmt(s.total)} · {pct.toFixed(0)} %
                        </span>
                      </div>
                      <Progress value={pct} color={SERIES.income} className="h-1.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          }
          table={<DataTable head={["Fuente", "Importe"]} rows={incomeDist.map((s) => [s.name, fmt(s.total)])} />}
        />

        <ChartCard
          title="Flujo entre cuentas"
          empty={flows.length === 0}
          height="h-auto"
          chart={
            <ul className="divide-y divide-border">
              {flows.map((f) => (
                <li key={f.accountId} className="py-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="flex items-center gap-2 font-medium min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: f.color }} aria-hidden />
                      <span className="truncate">{f.name}</span>
                    </span>
                    <span className={cn("tabular-nums", f.net < 0 ? "text-danger" : "")}>{formatMoney(f.net, f.currency, { signed: true })}</span>
                  </div>
                  <div className="text-xs text-subtle flex flex-wrap gap-x-3">
                    <span>Ingresos {formatMoney(f.income, f.currency, { compact: true })}</span>
                    <span>Gastos {formatMoney(f.expense, f.currency, { compact: true })}</span>
                    <span>Entra por transf. {formatMoney(f.transferIn, f.currency, { compact: true })}</span>
                    <span>Sale por transf. {formatMoney(f.transferOut, f.currency, { compact: true })}</span>
                    {f.adjustments !== 0 && <span>Correcciones {formatMoney(f.adjustments, f.currency, { compact: true, signed: true })}</span>}
                  </div>
                </li>
              ))}
            </ul>
          }
          table={
            <DataTable
              head={["Cuenta", "Entradas", "Salidas", "Neto"]}
              rows={flows.map((f) => [
                f.name,
                formatMoney(f.income + f.transferIn, f.currency),
                formatMoney(f.expense + f.transferOut, f.currency),
                formatMoney(f.net, f.currency),
              ])}
            />
          }
        />

        <ChartCard
          title="Cumplimiento de presupuestos"
          empty={budgets.length === 0}
          height="h-auto"
          chart={
            <ul className="space-y-3">
              {budgets.map((b) => {
                const w = budgetWindow(b, today);
                if (!w) return null;
                const p = budgetProgress(state, b, w, today);
                return (
                  <li key={b.id}>
                    <div className="flex justify-between text-sm mb-1 gap-2">
                      <span className="truncate">{b.name}</span>
                      <span className="text-xs text-subtle tabular-nums">
                        {p.pct.toFixed(0)} % usado · {p.elapsedPct.toFixed(0)} % del tiempo
                      </span>
                    </div>
                    <div className="relative">
                      <Progress
                        value={p.pct}
                        color={p.state === "exceeded" || p.state === "behind" ? "rgb(var(--danger))" : p.state === "warning" ? "rgb(var(--warning))" : undefined}
                      />
                      {/* Marcador del tiempo transcurrido: si la barra lo supera, el gasto va por delante del calendario. */}
                      <span className="absolute top-[-3px] h-[14px] w-0.5 bg-text/60" style={{ left: `${Math.min(100, p.elapsedPct)}%` }} aria-hidden />
                    </div>
                  </li>
                );
              })}
            </ul>
          }
          table={
            <DataTable
              head={["Presupuesto", "Usado", "Límite", "%"]}
              rows={budgets.map((b) => {
                const w = budgetWindow(b, today);
                const p = w ? budgetProgress(state, b, w, today) : null;
                return [b.name, p ? formatMoney(p.used, b.currency) : "—", formatMoney(b.amount, b.currency), p ? `${p.pct.toFixed(0)} %` : "—"];
              })}
            />
          }
        />

        <ChartCard
          title="Progreso de metas de ahorro"
          empty={goals.length === 0}
          height="h-auto"
          chart={
            <ul className="space-y-3">
              {goals.map((g) => {
                const p = goalProgress(state, g, today);
                return (
                  <li key={g.id}>
                    <div className="flex justify-between text-sm mb-1 gap-2">
                      <span className="truncate">{g.name}</span>
                      <span className="text-xs text-subtle tabular-nums">
                        {formatMoney(p.saved, g.currency, { compact: true })} / {formatMoney(g.targetAmount, g.currency, { compact: true })}
                      </span>
                    </div>
                    <Progress value={p.pct} color={g.color} />
                  </li>
                );
              })}
            </ul>
          }
          table={
            <DataTable
              head={["Meta", "Ahorrado", "Objetivo", "%"]}
              rows={goals.map((g) => {
                const p = goalProgress(state, g, today);
                return [g.name, formatMoney(p.saved, g.currency), formatMoney(g.targetAmount, g.currency), `${p.pct.toFixed(0)} %`];
              })}
            />
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Simulator data={data} state={state} currency={currency} />
        <RequiredSavings currency={currency} />
      </div>
    </div>
  );
}

function Simulator({ data, state, currency }: { data: FinanceData; state: FinState; currency: string }) {
  const today = todayKey();
  const avg = useMemo(() => monthlyAverages(state, today, currency, 3), [state, today, currency]);
  const [categoryId, setCategoryId] = useState("");
  const [pct, setPct] = useState(20);
  const [extra, setExtra] = useState<number | null>(0);
  const [target, setTarget] = useState<number | null>(null);
  const base = avg.byCategory.get(categoryId || null) ?? 0;
  const cats = [...avg.byCategory.entries()].filter(([id, v]) => id && v > 0);

  const res = simulateSavings({
    monthlyIncome: avg.income,
    monthlyExpense: avg.expense,
    cuts: categoryId ? [{ base, pct }] : [],
    extraSavings: extra ?? 0,
    target: target ?? undefined,
  });
  const fmt = (c: number) => formatMoney(c, currency);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm sm:text-base">Simulador: ¿y si recorto un gasto?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {avg.months === 0 ? (
          <p className="text-sm text-subtle">Hace falta al menos un mes completo de datos para simular sobre tus medias reales.</p>
        ) : (
          <>
            <p className="text-xs text-subtle">
              Punto de partida: medias de {avg.months} mes(es) completo(s) — ingresos {fmt(avg.income)}, gastos {fmt(avg.expense)}.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Categoría a recortar">
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Ninguna</option>
                  {cats.map(([id, v]) => (
                    <option key={id ?? "none"} value={id ?? ""}>
                      {data.categories.find((c) => c.id === id)?.name ?? "Sin categoría"} ({formatMoney(v, currency, { compact: true })}/mes)
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`Recorte: ${pct} %`}>
                <input type="range" min={5} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="w-full accent-primary" />
              </Field>
              <Field label="Ahorro extra al mes">
                <MoneyInput value={extra} onChange={setExtra} currency={currency} />
              </Field>
              <Field label="Meta a alcanzar (opcional)">
                <MoneyInput value={target} onChange={setTarget} currency={currency} />
              </Field>
            </div>
            <div className="gt-surface p-3 text-sm space-y-1">
              <div>
                Ahorro mensual estimado: <strong className={res.monthlySavings < 0 ? "text-danger" : ""}>{fmt(res.monthlySavings)}</strong>{" "}
                <span className="text-subtle">({fmt(res.yearlySavings)} al año)</span>
              </div>
              {res.savedByCuts > 0 && <div className="text-subtle">El recorte libera {fmt(res.savedByCuts)} al mes.</div>}
              {target ? (
                <div>
                  {res.monthsToTarget === null
                    ? "Con este escenario no se ahorra lo suficiente para llegar a la meta."
                    : `Llegarías a la meta en unos ${res.monthsToTarget} mes(es).`}
                </div>
              ) : null}
              <p className="text-xs text-subtle">Escenario aproximado: supone que ingresos y resto de gastos se mantienen en su media.</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RequiredSavings({ currency }: { currency: string }) {
  const [amount, setAmount] = useState<number | null>(null);
  const [deadline, setDeadline] = useState("");
  const today = todayKey();
  const r = amount && deadline && deadline > today ? requiredSavings(amount, today, deadline) : null;
  const fmt = (c: number) => formatMoney(c, currency);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm sm:text-base">¿Cuánto debo ahorrar para…?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Importe que necesitas">
            <MoneyInput value={amount} onChange={setAmount} currency={currency} />
          </Field>
          <Field label="Para esta fecha">
            <Input type="date" min={today} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
        </div>
        {r ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Al día", r.perDay],
              ["A la semana", r.perWeek],
              ["Al mes", r.perMonth],
            ].map(([label, v]) => (
              <div key={label as string} className="gt-surface p-2">
                <div className="text-xs text-subtle">{label}</div>
                <div className="font-semibold text-sm tabular-nums">{fmt(v as number)}</div>
              </div>
            ))}
            <p className="col-span-3 text-xs text-subtle">Reparto uniforme en {r.days} días, sin intereses.</p>
          </div>
        ) : (
          <p className="text-sm text-subtle">Introduce un importe y una fecha futura.</p>
        )}
      </CardContent>
    </Card>
  );
}
