import { useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, Edit3, History, Pause, Play, Plus, Target, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Empty } from "@/components/ui/Empty";
import { Progress } from "@/components/ui/Progress";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/services/api";
import type { FinBudgetRow, FinPeriod } from "@/services/localDb";
import type { FinanceData } from "@/hooks/useFinance";
import { CURRENCIES, formatMoney } from "@/lib/money";
import { budgetHistory, budgetProgress, budgetWindow, type BudgetProgress, type FinState } from "@/services/finance/calc";
import { startOfMonth, todayKey } from "@/services/finance/dates";
import { FREQUENCY_LABEL, MoneyInput, Segmented, errorMessage } from "./shared";
import { PurposeChip, TagField } from "./purpose";
import { tagOf } from "@/services/finance/calc";

const STATE_LABEL: Record<BudgetProgress["state"], string> = {
  ok: "En curso",
  warning: "Atención",
  exceeded: "Superado",
  achieved: "Conseguido",
  behind: "Retrasado",
  upcoming: "Aún no empieza",
};

function stateColor(s: BudgetProgress["state"]) {
  if (s === "exceeded" || s === "behind") return "rgb(var(--danger))";
  if (s === "warning") return "rgb(var(--warning))";
  if (s === "achieved") return "rgb(var(--success))";
  return undefined;
}

export function BudgetsView({
  data,
  state,
  reload,
  onDrill,
}: {
  data: FinanceData;
  state: FinState;
  reload: () => void;
  onDrill: (title: string, ids: string[]) => void;
}) {
  const [editing, setEditing] = useState<Partial<FinBudgetRow> | null>(null);
  const [historyOf, setHistoryOf] = useState<FinBudgetRow | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const today = todayKey();
  const list = data.budgets.filter((b) => showArchived || b.status !== "archived");

  async function setStatus(b: FinBudgetRow, status: FinBudgetRow["status"]) {
    try {
      await api.patch(`/finance/budgets/${b.id}/status`, { status });
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function remove(b: FinBudgetRow) {
    if (!confirm(`¿Eliminar el presupuesto «${b.name}»? Los movimientos no se ven afectados.`)) return;
    await api.delete(`/finance/budgets/${b.id}`);
    toast.success("Presupuesto eliminado");
    reload();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-subtle">
          <input type="checkbox" className="accent-primary" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Mostrar archivados
        </label>
        <Button
          onClick={() =>
            setEditing({
              kind: "spending",
              period: "monthly",
              currency: data.defaultCurrency,
              startDate: startOfMonth(today),
              alertPercent: 80,
              categoryIds: [],
              accountIds: [],
            })
          }
        >
          <Plus size={16} /> Nuevo presupuesto
        </Button>
      </div>

      {list.length === 0 ? (
        <Card>
          <Empty icon={Target} title="Sin presupuestos" description="Fija un tope de gasto por categoría o una meta de ahorro periódica." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {list.map((b) => {
            const w = budgetWindow(b, today);
            const p = w ? budgetProgress(state, b, w, today) : null;
            const cats = b.categoryIds.map((id) => data.categories.find((c) => c.id === id)?.name).filter(Boolean);
            const bad = p && (p.state === "exceeded" || p.state === "behind" || p.state === "warning");
            return (
              <Card key={b.id} className={b.status !== "active" ? "opacity-70" : ""}>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{b.name}</div>
                      <div className="text-xs text-subtle">
                        {b.kind === "spending" ? "Gasto" : "Ahorro"} · {FREQUENCY_LABEL[b.period]}
                        {cats.length ? ` · solo ${cats.join(", ")}` : ""}
                      </div>
                      <div className="mt-1">
                        <PurposeChip
                          tag={tagOf(state, b.id)}
                          data={data}
                          onClick={p ? () => onDrill(`#${tagOf(state, b.id)?.name ?? ""} · ${b.name}`, p.txIds) : undefined}
                        />
                      </div>
                    </div>
                    {p && (
                      <Badge className="shrink-0" style={{ color: stateColor(p.state) }}>
                        {bad ? <AlertTriangle size={12} aria-hidden /> : <CheckCircle2 size={12} aria-hidden />}
                        {b.status === "paused" ? "Pausado" : b.status === "archived" ? "Archivado" : STATE_LABEL[p.state]}
                      </Badge>
                    )}
                  </div>
                  {p && w ? (
                    <>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="tabular-nums">
                          <strong>{formatMoney(p.used, b.currency)}</strong>{" "}
                          <span className="text-subtle">de {formatMoney(b.amount, b.currency)}</span>
                        </span>
                        <span className="tabular-nums text-subtle">{p.pct.toFixed(0)} %</span>
                      </div>
                      <Progress value={p.pct} color={stateColor(p.state)} />
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-subtle">
                        <div>
                          <div>Asignado</div>
                          <div className="text-text font-medium tabular-nums">{formatMoney(p.assigned, b.currency)}</div>
                        </div>
                        <div>
                          <div>{b.kind === "spending" ? "Restante" : "Falta"}</div>
                          <div className={p.remaining < 0 ? "text-danger font-medium tabular-nums" : "text-text font-medium tabular-nums"}>
                            {formatMoney(p.remaining, b.currency)}
                          </div>
                        </div>
                        <div>
                          <div>Tiempo</div>
                          <div className="text-text font-medium">
                            {p.elapsedPct.toFixed(0)} % · {p.daysLeft} d
                          </div>
                        </div>
                        <div>
                          <div>Proyección</div>
                          <div className="text-text font-medium tabular-nums">{formatMoney(p.projected, b.currency, { compact: true })}</div>
                        </div>
                      </div>
                      {/* Marca de tiempo transcurrido sobre la barra: permite ver si el ritmo va por delante. */}
                      <div className="text-xs text-subtle">
                        Periodo {w.from} → {w.to}. Avisa al {b.alertPercent} %. Solo cuentan los movimientos vinculados a su etiqueta.
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-subtle">Fuera de su periodo de vigencia.</p>
                  )}
                  <div className="flex flex-wrap gap-1 -mx-1">
                    {p && p.txIds.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => onDrill(`Presupuesto · ${b.name}`, p.txIds)}>
                        Movimientos #{tagOf(state, b.id)?.name} ({p.txIds.length})
                      </Button>
                    )}
                    {b.period !== "custom" && (
                      <Button size="sm" variant="ghost" onClick={() => setHistoryOf(b)}>
                        <History size={14} /> Anteriores
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(b)} aria-label={`Editar ${b.name}`}>
                      <Edit3 size={14} />
                    </Button>
                    {b.status === "active" ? (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(b, "paused")} aria-label="Pausar">
                        <Pause size={14} />
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(b, "active")} aria-label="Reactivar">
                        <Play size={14} />
                      </Button>
                    )}
                    {b.status !== "archived" && (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(b, "archived")}>
                        Archivar
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => remove(b)} aria-label={`Eliminar ${b.name}`}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Editar presupuesto" : "Nuevo presupuesto"} size="lg">
        {editing && <BudgetForm budget={editing} data={data} onSaved={() => { setEditing(null); reload(); }} />}
      </Dialog>

      <Dialog open={!!historyOf} onClose={() => setHistoryOf(null)} title={`Periodos anteriores · ${historyOf?.name ?? ""}`}>
        {historyOf && (
          <ul className="divide-y divide-border">
            {budgetHistory(historyOf, today, 12).map((w) => {
              const p = budgetProgress(state, historyOf, w, today);
              return (
                <li key={w.from} className="py-2 text-sm flex items-center gap-3">
                  <span className="w-44 shrink-0 text-subtle">
                    {w.from} → {w.to}
                  </span>
                  <div className="flex-1">
                    <Progress value={p.pct} color={stateColor(p.state)} className="h-1.5" />
                  </div>
                  <span className="tabular-nums w-28 text-right">{formatMoney(p.used, historyOf.currency, { compact: true })}</span>
                </li>
              );
            })}
            {budgetHistory(historyOf, today, 12).length === 0 && <p className="text-sm text-subtle py-4">Aún no hay periodos anteriores.</p>}
          </ul>
        )}
      </Dialog>
    </div>
  );
}

function BudgetForm({ budget, data, onSaved }: { budget: Partial<FinBudgetRow>; data: FinanceData; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: budget.name ?? "",
    description: budget.description ?? "",
    kind: budget.kind ?? "spending",
    amount: budget.amount ?? null,
    currency: budget.currency ?? data.defaultCurrency,
    categoryIds: budget.categoryIds ?? [],
    accountIds: budget.accountIds ?? [],
    period: (budget.period ?? "monthly") as FinPeriod,
    startDate: budget.startDate ?? todayKey(),
    endDate: budget.endDate ?? "",
    alertPercent: budget.alertPercent ?? 80,
  });
  const existingTag = budget.id ? data.finTags.find((t) => t.ownerId === budget.id) : undefined;
  // null = se genera a partir del nombre hasta que el usuario la edite.
  const [tag, setTag] = useState<string | null>(existingTag?.name ?? null);
  const [saving, setSaving] = useState(false);
  const toggle = (key: "categoryIds" | "accountIds", id: string) =>
    setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount || form.amount <= 0) return toast.error("Indica un importe mayor que cero");
    setSaving(true);
    try {
      const body = {
        ...form,
        description: form.description || null,
        endDate: form.endDate || null,
        status: budget.status ?? "active",
        tag: tag ?? undefined,
      };
      if (budget.id) await api.put(`/finance/budgets/${budget.id}`, body);
      else await api.post("/finance/budgets", body);
      toast.success("Presupuesto guardado");
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const expenseCats = data.categories.filter((c) => c.kind !== "income" && !c.archived);
  const accounts = data.accounts.filter((a) => !a.archived && a.currency === form.currency);

  return (
    <form onSubmit={submit} className="space-y-3">
      <Segmented
        label="Tipo de presupuesto"
        value={form.kind}
        onChange={(kind) => setForm({ ...form, kind })}
        options={[
          { id: "spending", label: "Tope de gasto" },
          { id: "saving", label: "Meta de ahorro periódica" },
        ]}
      />
      <p className="text-xs text-subtle">
        {form.kind === "spending"
          ? "Suma solo los gastos que vincules a su etiqueta (y que cumplan los criterios opcionales). Nada se asigna automáticamente."
          : "Suma lo que destines explícitamente a su etiqueta (asignaciones), menos lo retirado. Un ingreso cuenta solo por la parte asignada."}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Nombre">
          <Input required autoFocus maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <TagField name={form.name} value={tag} onChange={setTag} data={data} ownerId={budget.id} />
        <Field label="Importe">
          <div className="flex gap-2">
            <div className="flex-1">
              <MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} currency={form.currency} required />
            </div>
            <Select aria-label="Moneda" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value, accountIds: [] })} className="w-24">
              {CURRENCIES.map((c) => (
                <option key={c.code}>{c.code}</option>
              ))}
            </Select>
          </div>
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Frecuencia">
          <Select value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value as FinPeriod })}>
            {(["weekly", "monthly", "quarterly", "yearly", "custom"] as FinPeriod[]).map((p) => (
              <option key={p} value={p}>
                {FREQUENCY_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Inicio">
          <Input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </Field>
        <Field label={form.period === "custom" ? "Fin" : "Fin (opcional)"}>
          <Input type="date" required={form.period === "custom"} value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
        </Field>
      </div>
      {form.kind === "spending" && (
        <Field label="Limitar a categorías (opcional)">
          <div className="flex flex-wrap gap-1.5">
            {expenseCats.map((c) => {
              const on = form.categoryIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle("categoryIds", c.id)}
                  className={on ? "gt-pill px-2 py-1 text-xs bg-primary text-primary-fg" : "gt-pill px-2 py-1 text-xs bg-muted"}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </Field>
      )}
      {accounts.length > 0 && (
        <Field label="Limitar a cuentas (opcional)">
          <div className="flex flex-wrap gap-1.5">
            {accounts.map((a) => {
              const on = form.accountIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle("accountIds", a.id)}
                  className={on ? "gt-pill px-2 py-1 text-xs bg-primary text-primary-fg" : "gt-pill px-2 py-1 text-xs bg-muted"}
                >
                  {a.name}
                </button>
              );
            })}
          </div>
        </Field>
      )}
      <Field label={`Avisar al ${form.alertPercent} %`}>
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={form.alertPercent}
          onChange={(e) => setForm({ ...form, alertPercent: Number(e.target.value) })}
          className="w-full accent-primary"
        />
      </Field>
      <Field label="Descripción (opcional)">
        <Textarea maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-[60px]" />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          Guardar
        </Button>
      </div>
    </form>
  );
}
