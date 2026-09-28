import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Hash, Pencil } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Empty } from "@/components/ui/Empty";
import { Progress } from "@/components/ui/Progress";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/services/api";
import type { FinTagRow } from "@/services/localDb";
import type { FinanceData } from "@/hooks/useFinance";
import { formatMoney } from "@/lib/money";
import {
  budgetProgress,
  budgetWindow,
  goalProgress,
  purposeDistribution,
  tagOwner,
  tagSeries,
  tagStats,
  type FinState,
} from "@/services/finance/calc";
import { bucketFor, todayKey, type DateRange } from "@/services/finance/dates";
import { ChartCard, DataTable, SERIES, axisTick, bucketLabel, gridStroke, tooltipStyle, useChartAnimation } from "./charts";
import { errorMessage } from "./shared";
import { TxList } from "./TxList";

const STATUS: Record<string, string> = {
  active: "Activa",
  paused: "En pausa",
  completed: "Completada",
  archived: "Archivada",
};

/** Resumen de una finalidad: global (toda su historia) + dentro del periodo. */
function summarize(state: FinState, tag: FinTagRow, range: DateRange, today: string) {
  const owner = tagOwner(state, tag);
  const total = tagStats(state, tag.id);
  const period = tagStats(state, tag.id, range);
  let target = 0;
  let achieved = 0;
  let label = "";
  if (owner?.kind === "goal") {
    const p = goalProgress(state, owner.row, today);
    target = owner.row.targetAmount;
    achieved = p.saved;
    label = "Ahorrado";
  } else if (owner?.kind === "budget") {
    const w = budgetWindow(owner.row, today);
    const p = w ? budgetProgress(state, owner.row, w, today) : null;
    target = owner.row.amount;
    achieved = p?.used ?? 0;
    label = owner.row.kind === "spending" ? "Usado este periodo" : "Ahorrado este periodo";
  }
  return {
    owner,
    total,
    period,
    target,
    achieved,
    label,
    pending: owner?.kind === "budget" && owner.row.kind === "spending" ? target - achieved : Math.max(0, target - achieved),
    pct: target > 0 ? (achieved / target) * 100 : 0,
  };
}

export function PurposesView({
  data,
  state,
  currency,
  range,
  reload,
  onDrill,
}: {
  data: FinanceData;
  state: FinState;
  currency: string;
  range: DateRange;
  reload: () => void;
  onDrill: (title: string, ids: string[]) => void;
}) {
  const today = todayKey();
  const [showInactive, setShowInactive] = useState(false);
  const [detail, setDetail] = useState<FinTagRow | null>(null);
  const distribution = useMemo(() => purposeDistribution(state, range, currency), [state, range, currency]);
  const incomeTotal = distribution.reduce((s, x) => s + x.amount, 0);
  const unassigned = distribution.find((x) => x.tagId === null)?.amount ?? 0;

  const cards = useMemo(
    () =>
      data.finTags
        .map((tag) => ({ tag, s: summarize(state, tag, range, today) }))
        .filter(({ s }) => showInactive || (s.owner && (s.owner.status === "active" || s.owner.status === "paused")))
        .sort((a, b) => (a.tag.ownerType === b.tag.ownerType ? a.tag.name.localeCompare(b.tag.name) : a.tag.ownerType === "goal" ? -1 : 1)),
    [data.finTags, state, range, today, showInactive]
  );

  async function rename(tag: FinTagRow) {
    const next = prompt("Nuevo nombre de la etiqueta (sin #)", tag.name)?.trim();
    if (!next || next === tag.name) return;
    try {
      await api.put(`/finance/tags/${tag.id}`, { name: next });
      toast.success("Etiqueta renombrada; el historial se conserva");
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (data.finTags.length === 0) {
    return (
      <Card>
        <Empty
          icon={Hash}
          title="Aún no hay finalidades"
          description="Cada presupuesto y meta de ahorro tiene una etiqueta (#Ordenador, #ViajeJapon…). Crea uno para empezar a destinar dinero."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <ChartCard
        title="Destino de los ingresos del periodo"
        empty={incomeTotal === 0}
        height="h-auto"
        chart={
          <div className="space-y-3">
            <p className="text-sm">
              De <strong>{formatMoney(incomeTotal, currency)}</strong> ingresados,{" "}
              <strong>{formatMoney(incomeTotal - unassigned, currency)}</strong> tienen finalidad y{" "}
              <strong>{formatMoney(unassigned, currency)}</strong> siguen disponibles sin asignar.
            </p>
            {/* Barra 100 %: cada finalidad con su color; el gris es dinero sin destino. */}
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Reparto de los ingresos por finalidad">
              {distribution.map((d) => (
                <span
                  key={d.tagId ?? "free"}
                  title={`${d.label}: ${formatMoney(d.amount, currency)}`}
                  className="border-r-2 border-surface last:border-r-0"
                  style={{ width: `${(d.amount / incomeTotal) * 100}%`, background: d.color }}
                />
              ))}
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              {distribution.map((d) => (
                <li key={d.tagId ?? "free"}>
                  <button type="button" className="w-full flex items-center gap-2 text-sm text-left hover:underline" onClick={() => onDrill(`Ingresos · ${d.label}`, d.txIds)}>
                    <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: d.color }} aria-hidden />
                    <span className="truncate flex-1">
                      {d.label} <span className="text-subtle">· {d.owner}</span>
                    </span>
                    <span className="tabular-nums text-xs text-subtle">
                      {formatMoney(d.amount, currency)} · {((d.amount / incomeTotal) * 100).toFixed(0)} %
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        }
        table={
          <DataTable
            head={["Finalidad", "Importe", "%"]}
            rows={distribution.map((d) => [`${d.label} (${d.owner})`, formatMoney(d.amount, currency), `${((d.amount / incomeTotal) * 100).toFixed(1)} %`])}
          />
        }
      />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="gt-heading text-base">Etiquetas financieras</h2>
        <label className="flex items-center gap-2 text-sm text-subtle">
          <input type="checkbox" className="accent-primary" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Incluir archivadas y completadas
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {cards.map(({ tag, s }) => {
          const cur = s.owner?.currency ?? currency;
          const fmt = (v: number) => formatMoney(v, cur, { compact: true });
          return (
            <Card key={tag.id} className={s.owner && s.owner.status !== "active" && s.owner.status !== "paused" ? "opacity-75" : ""}>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-2">
                  <span className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${tag.color}22`, color: tag.color }}>
                    <Hash size={16} aria-hidden />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate" style={{ color: tag.color }}>
                      #{tag.name}
                    </div>
                    <div className="text-xs text-subtle truncate">
                      {s.owner ? `${s.owner.kind === "goal" ? "Meta" : "Presupuesto"} · ${s.owner.name}` : "Finalidad eliminada"}
                    </div>
                  </div>
                  {s.owner && <Badge>{STATUS[s.owner.status] ?? s.owner.status}</Badge>}
                  <button className="p-1.5 rounded-md text-subtle hover:text-text hover:bg-muted" onClick={() => rename(tag)} aria-label={`Renombrar #${tag.name}`}>
                    <Pencil size={13} />
                  </button>
                </div>

                <div>
                  <div className="flex justify-between items-baseline text-sm mb-1 gap-2">
                    <span className="text-subtle truncate">{s.label}</span>
                    <span className="tabular-nums whitespace-nowrap">
                      <strong>{fmt(s.achieved)}</strong> / {fmt(s.target)} · {s.pct.toFixed(0)} %
                    </span>
                  </div>
                  <Progress
                    value={s.pct}
                    color={s.owner?.kind === "budget" && s.owner.row.kind === "spending" && s.pct >= 100 ? "rgb(var(--danger))" : tag.color}
                  />
                </div>

                <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                  {[
                    ["De ingresos", s.total.incomeLinked],
                    ["En gastos", s.total.expenseLinked],
                    ["Asignado", s.total.assigned],
                    ["Utilizado", s.total.used],
                    [s.owner?.kind === "budget" && s.owner.row.kind === "spending" ? "Restante" : "Pendiente", s.pending],
                    ["Neto apartado", s.total.net],
                  ].map(([k, v]) => (
                    <div key={k as string} className="min-w-0">
                      <dt className="text-subtle truncate">{k}</dt>
                      <dd className={`tabular-nums font-medium text-sm ${(v as number) < 0 ? "text-danger" : ""}`}>{fmt(v as number)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-subtle">
                  En el periodo: asignado {fmt(s.period.assigned)} · utilizado {fmt(s.period.used)}
                </p>

                <div className="flex flex-wrap gap-1 -mx-1">
                  <Button size="sm" variant="ghost" onClick={() => onDrill(`#${tag.name} · ${s.owner?.name ?? ""}`, s.total.txIds)} disabled={s.total.txIds.length === 0}>
                    Movimientos ({s.total.txIds.length})
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDetail(tag)}>
                    Evolución
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!detail} onClose={() => setDetail(null)} title={detail ? `#${detail.name}` : ""} description={detail ? tagOwner(state, detail)?.name : undefined} size="lg">
        {detail && <TagDetail tag={detail} data={data} state={state} range={range} />}
      </Dialog>
    </div>
  );
}

function TagDetail({ tag, data, state, range }: { tag: FinTagRow; data: FinanceData; state: FinState; range: DateRange }) {
  const animate = useChartAnimation();
  const bucket = bucketFor(range);
  const series = useMemo(() => tagSeries(state, tag.id, range, bucket), [state, tag.id, range, bucket]);
  const owner = tagOwner(state, tag);
  const cur = owner?.currency ?? data.defaultCurrency;
  const st = tagStats(state, tag.id, range);
  const ids = new Set(st.txIds);
  const txs = data.transactions.filter((t) => ids.has(t.id));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Dinero apartado en el periodo</CardTitle>
          <CardDescription>Acumulado (asignado − utilizado), incluyendo el saldo previo al periodo.</CardDescription>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <CartesianGrid vertical={false} stroke={gridStroke} strokeDasharray="3 3" />
              <XAxis dataKey="key" tick={axisTick} tickFormatter={(k) => bucketLabel(k, bucket)} minTickGap={16} />
              <YAxis tick={axisTick} tickFormatter={(v) => formatMoney(v, cur, { compact: true })} width={64} />
              <Tooltip {...tooltipStyle} cursor={{ stroke: gridStroke }} labelFormatter={(k) => bucketLabel(String(k), bucket)} formatter={(v: number) => formatMoney(v, cur)} />
              <Area isAnimationActive={animate} type="stepAfter" dataKey="balance" name="Apartado" stroke={tag.color || SERIES.net} strokeWidth={2} fill={tag.color || SERIES.net} fillOpacity={0.12} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <p className="text-sm tabular-nums">
        Periodo: asignado <strong>{formatMoney(st.assigned, cur)}</strong> · utilizado <strong>{formatMoney(st.used, cur)}</strong> · neto{" "}
        <strong>{formatMoney(st.net, cur)}</strong>
      </p>
      <TxList data={data} txs={txs} compact />
    </div>
  );
}
