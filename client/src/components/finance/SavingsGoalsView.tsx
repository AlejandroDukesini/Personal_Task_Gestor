import { useState } from "react";
import toast from "react-hot-toast";
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Edit3, Pause, PiggyBank, Play, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Empty } from "@/components/ui/Empty";
import { Progress } from "@/components/ui/Progress";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/services/api";
import { newId, type FinGoalRow } from "@/services/localDb";
import type { FinanceData } from "@/hooks/useFinance";
import { CURRENCIES, formatMoney } from "@/lib/money";
import { goalProgress, type FinState } from "@/services/finance/calc";
import { todayKey } from "@/services/finance/dates";
import { AccountSelect, DynIcon, FIN_ICONS, MoneyInput, errorMessage } from "./shared";
import { PurposeChip, TagField } from "./purpose";
import { tagOf } from "@/services/finance/calc";
import { TxList } from "./TxList";

const STATUS_LABEL: Record<FinGoalRow["status"], string> = {
  active: "Activa",
  paused: "En pausa",
  completed: "Completada",
  archived: "Archivada",
};

export function SavingsGoalsView({
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
  const [editing, setEditing] = useState<Partial<FinGoalRow> | null>(null);
  const [contrib, setContrib] = useState<{ goal: FinGoalRow; withdraw: boolean } | null>(null);
  const [detail, setDetail] = useState<FinGoalRow | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const today = todayKey();
  const list = data.goals.filter((g) => showArchived || g.status !== "archived");

  async function setStatus(g: FinGoalRow, status: FinGoalRow["status"]) {
    try {
      await api.patch(`/finance/goals/${g.id}/status`, { status });
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function remove(g: FinGoalRow) {
    if (!confirm(`¿Eliminar la meta «${g.name}»?`)) return;
    try {
      await api.delete(`/finance/goals/${g.id}`);
      toast.success("Meta eliminada");
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-subtle">
          <input type="checkbox" className="accent-primary" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Mostrar archivadas
        </label>
        <Button onClick={() => setEditing({ currency: data.defaultCurrency, startDate: today, accountIds: [], color: "#0d9488", icon: "PiggyBank" })}>
          <Plus size={16} /> Nueva meta
        </Button>
      </div>

      {list.length === 0 ? (
        <Card>
          <Empty icon={PiggyBank} title="Sin metas de ahorro" description="Define para qué ahorras y registra tus aportaciones reales." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.map((g) => {
            const p = goalProgress(state, g, today);
            return (
              <Card key={g.id} className={g.status === "archived" || g.status === "paused" ? "opacity-75" : ""}>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${g.color}22`, color: g.color }}>
                      <DynIcon name={g.icon} size={18} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{g.name}</div>
                      <div className="text-xs text-subtle">
                        {g.deadline ? `Límite ${g.deadline}` : "Sin fecha límite"}
                      </div>
                      <div className="mt-1">
                        <PurposeChip
                          tag={tagOf(state, g.id)}
                          data={data}
                          onClick={() => onDrill(`#${tagOf(state, g.id)?.name ?? ""} · ${g.name}`, p.contributions.map((t) => t.id))}
                        />
                      </div>
                    </div>
                    <Badge>
                      {g.status === "completed" && <CheckCircle2 size={12} aria-hidden />}
                      {STATUS_LABEL[g.status]}
                    </Badge>
                  </div>
                  <div className="flex items-baseline justify-between text-sm gap-2">
                    <span className="tabular-nums">
                      <strong>{formatMoney(p.saved, g.currency)}</strong>
                      <span className="text-subtle"> de {formatMoney(g.targetAmount, g.currency)}</span>
                    </span>
                    <span className="text-subtle tabular-nums">{p.pct.toFixed(0)} %</span>
                  </div>
                  <Progress value={p.pct} color={g.color} />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-subtle">
                    <div>
                      Asignado
                      <div className="text-text font-medium tabular-nums">{formatMoney(p.assigned, g.currency, { compact: true })}</div>
                    </div>
                    <div>
                      Usado
                      <div className="text-text font-medium tabular-nums">{formatMoney(p.used, g.currency, { compact: true })}</div>
                    </div>
                    <div>
                      Falta
                      <div className="text-text font-medium tabular-nums">{formatMoney(p.remaining, g.currency)}</div>
                    </div>
                    <div>
                      {p.daysLeft !== null ? (p.overdue ? "Plazo vencido" : `${p.daysLeft} días restantes`) : "Ritmo medio"}
                      <div className="text-text font-medium tabular-nums">
                        {p.requiredPerMonth !== null && !p.overdue
                          ? `${formatMoney(p.requiredPerMonth, g.currency, { compact: true })}/mes`
                          : `${formatMoney(p.averagePerMonth, g.currency, { compact: true })}/mes`}
                      </div>
                    </div>
                  </div>
                  {p.eta && p.remaining > 0 && (
                    <p className="text-xs text-subtle">
                      Al ritmo medio actual la alcanzarías hacia {p.eta}. Es una estimación, no una garantía.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1 -mx-1">
                    {g.status === "active" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setContrib({ goal: g, withdraw: false })}>
                          <ArrowDownToLine size={14} /> Aportar
                        </Button>
                        {p.saved > 0 && (
                          <Button size="sm" variant="ghost" onClick={() => setContrib({ goal: g, withdraw: true })}>
                            <ArrowUpFromLine size={14} /> Retirar
                          </Button>
                        )}
                      </>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setDetail(g)}>
                      Historial ({p.contributions.length})
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(g)} aria-label={`Editar ${g.name}`}>
                      <Edit3 size={14} />
                    </Button>
                    {g.status === "active" ? (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(g, "paused")} aria-label="Pausar">
                        <Pause size={14} />
                      </Button>
                    ) : g.status !== "completed" ? (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(g, "active")} aria-label="Reactivar">
                        <Play size={14} />
                      </Button>
                    ) : null}
                    {g.status !== "completed" && (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(g, "completed")}>
                        Completar
                      </Button>
                    )}
                    {g.status !== "archived" && (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(g, "archived")}>
                        Archivar
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => remove(g)} aria-label={`Eliminar ${g.name}`}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Editar meta" : "Nueva meta de ahorro"}>
        {editing && <GoalForm goal={editing} data={data} onSaved={() => { setEditing(null); reload(); }} />}
      </Dialog>
      <Dialog
        open={!!contrib}
        onClose={() => setContrib(null)}
        title={contrib?.withdraw ? "Retirar de la meta" : "Aportar a la meta"}
        description="Se registra como una transferencia real entre tus cuentas: no crea ingresos ni gastos ficticios."
      >
        {contrib && <ContributionForm goal={contrib.goal} withdraw={contrib.withdraw} data={data} onSaved={() => { setContrib(null); reload(); }} />}
      </Dialog>
      <Dialog open={!!detail} onClose={() => setDetail(null)} title={`Aportaciones · ${detail?.name ?? ""}`} size="lg">
        {detail && <TxList data={data} txs={goalProgress(state, detail, today).contributions} compact />}
      </Dialog>
    </div>
  );
}

function GoalForm({ goal, data, onSaved }: { goal: Partial<FinGoalRow>; data: FinanceData; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: goal.name ?? "",
    description: goal.description ?? "",
    targetAmount: goal.targetAmount ?? null,
    currency: goal.currency ?? data.defaultCurrency,
    startDate: goal.startDate ?? todayKey(),
    deadline: goal.deadline ?? "",
    accountIds: goal.accountIds ?? [],
    icon: goal.icon ?? "PiggyBank",
    color: goal.color ?? "#0d9488",
  });
  const existingTag = goal.id ? data.finTags.find((t) => t.ownerId === goal.id) : undefined;
  const [tag, setTag] = useState<string | null>(existingTag?.name ?? null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.targetAmount) return toast.error("Indica el importe objetivo");
    setSaving(true);
    try {
      const body = { ...form, description: form.description || null, deadline: form.deadline || null, status: goal.status, tag: tag ?? undefined };
      if (goal.id) await api.put(`/finance/goals/${goal.id}`, body);
      else await api.post("/finance/goals", body);
      toast.success("Meta guardada");
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Nombre">
        <Input required autoFocus maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <TagField name={form.name} value={tag} onChange={setTag} data={data} ownerId={goal.id} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Importe objetivo">
          <MoneyInput value={form.targetAmount} onChange={(v) => setForm({ ...form, targetAmount: v })} currency={form.currency} required />
        </Field>
        <Field label="Moneda">
          <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c.code}>{c.code}</option>
            ))}
          </Select>
        </Field>
        <Field label="Inicio">
          <Input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </Field>
        <Field label="Fecha límite (opcional)">
          <Input type="date" min={form.startDate} value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
        </Field>
        <Field label="Icono">
          <Select value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
            {Object.keys(FIN_ICONS).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </Select>
        </Field>
        <Field label="Color">
          <Input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-9 p-1" />
        </Field>
      </div>
      {data.accounts.some((a) => !a.archived) && (
        <Field label="Cuentas donde guardas este ahorro" hint="Las retiradas desde estas cuentas restan del progreso.">
          <div className="flex flex-wrap gap-1.5">
            {data.accounts
              .filter((a) => !a.archived)
              .map((a) => {
                const on = form.accountIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setForm({ ...form, accountIds: on ? form.accountIds.filter((x) => x !== a.id) : [...form.accountIds, a.id] })
                    }
                    className={on ? "gt-pill px-2 py-1 text-xs bg-primary text-primary-fg" : "gt-pill px-2 py-1 text-xs bg-muted"}
                  >
                    {a.name}
                  </button>
                );
              })}
          </div>
        </Field>
      )}
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

function ContributionForm({ goal, withdraw, data, onSaved }: { goal: FinGoalRow; withdraw: boolean; data: FinanceData; onSaved: () => void }) {
  const active = data.accounts.filter((a) => !a.archived);
  const goalAccount = goal.accountIds.find((id) => active.some((a) => a.id === id)) ?? "";
  const [toAccountId, setTo] = useState(goalAccount || active.find((a) => a.type === "savings")?.id || "");
  const [fromAccountId, setFrom] = useState(active.find((a) => a.id !== (goalAccount || toAccountId))?.id ?? "");
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayKey());
  const [key] = useState(() => newId());
  const [saving, setSaving] = useState(false);

  if (active.length < 2) {
    return <p className="text-sm text-subtle">Necesitas al menos dos cuentas (p. ej. tu cuenta corriente y una de ahorro) para registrar aportaciones como transferencias. También puedes vincular un ingreso a esta meta desde el formulario de movimientos.</p>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount) return toast.error("Indica el importe");
    setSaving(true);
    try {
      await api.post(`/finance/goals/${goal.id}/contribute`, { id: key, amount, date, fromAccountId, toAccountId, withdraw });
      toast.success(withdraw ? "Retirada registrada" : "Aportación registrada");
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Cuenta del ahorro">
          <AccountSelect accounts={data.accounts} value={toAccountId} onChange={setTo} allowEmpty emptyLabel="Elige cuenta" />
        </Field>
        <Field label={withdraw ? "Hacia la cuenta" : "Desde la cuenta"}>
          <AccountSelect accounts={data.accounts} value={fromAccountId} onChange={setFrom} exclude={toAccountId} />
        </Field>
        <Field label="Importe">
          <MoneyInput value={amount} onChange={setAmount} currency={goal.currency} required autoFocus />
        </Field>
        <Field label="Fecha">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          {withdraw ? "Retirar" : "Aportar"}
        </Button>
      </div>
    </form>
  );
}
