import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { AlertCircle, CalendarClock, Check, Edit3, Pause, Play, Plus, Repeat, SkipForward, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Empty } from "@/components/ui/Empty";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/services/api";
import type { FinFrequency, FinRecurringRow } from "@/services/localDb";
import type { FinanceData } from "@/hooks/useFinance";
import { formatMoney } from "@/lib/money";
import { recurringStatus, type FinState, type Occurrence } from "@/services/finance/calc";
import { todayKey } from "@/services/finance/dates";
import { AccountSelect, FREQUENCY_LABEL, KIND_LABEL, Money, MoneyInput, Segmented, errorMessage } from "./shared";
import { AllocationEditor, PurposeChip, draftsToBody, toDrafts, type AllocationDraft } from "./purpose";

type Row = Occurrence & { r: FinRecurringRow };

export function RecurringView({
  data,
  state,
  reload,
  confirmTarget,
  onConfirmTarget,
}: {
  data: FinanceData;
  state: FinState;
  reload: () => void;
  confirmTarget: { recurringId: string; date: string } | null;
  onConfirmTarget: (t: { recurringId: string; date: string } | null) => void;
}) {
  const [editing, setEditing] = useState<Partial<FinRecurringRow> | null>(null);
  const [horizon, setHorizon] = useState(30);
  const today = todayKey();
  const currencyOf = (id: string) => data.accounts.find((a) => a.id === id)?.currency ?? data.defaultCurrency;

  const { overdue, upcoming } = useMemo(() => {
    const o: Row[] = [];
    const u: Row[] = [];
    for (const r of state.finRecurring) {
      const st = recurringStatus(state, r, today, horizon);
      o.push(...st.overdue.map((x) => ({ ...x, r })));
      u.push(...st.upcoming.map((x) => ({ ...x, r })));
    }
    const by = (a: Row, b: Row) => a.date.localeCompare(b.date);
    return { overdue: o.sort(by), upcoming: u.sort(by) };
  }, [state, today, horizon]);

  // Obligaciones del horizonte, por moneda: lo que falta por pagar y cobrar.
  const obligations = useMemo(() => {
    const m = new Map<string, { out: number; in: number }>();
    for (const o of [...overdue, ...upcoming]) {
      const c = currencyOf(o.r.accountId);
      const e = m.get(c) ?? { out: 0, in: 0 };
      if (o.r.kind === "expense") e.out += o.r.amount;
      if (o.r.kind === "income") e.in += o.r.amount;
      m.set(c, e);
    }
    return [...m.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overdue, upcoming]);

  async function skip(o: Row) {
    try {
      await api.post(`/finance/recurring/${o.r.id}/skip`, { date: o.date });
      toast.success("Ocurrencia omitida");
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function setStatus(r: FinRecurringRow, status: FinRecurringRow["status"]) {
    try {
      await api.put(`/finance/recurring/${r.id}`, { ...r, status });
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function remove(r: FinRecurringRow) {
    if (!confirm(`¿Eliminar «${r.name}»? Los movimientos ya registrados se conservan.`)) return;
    await api.delete(`/finance/recurring/${r.id}`);
    toast.success("Eliminado");
    reload();
  }

  const OccRow = ({ o }: { o: Row }) => (
    <li className="flex flex-wrap items-center gap-2 p-3">
      <div className="w-14 text-center shrink-0">
        <div className="text-xs text-subtle uppercase">
          {new Date(`${o.date}T12:00:00`).toLocaleDateString("es-CO", { month: "short" })}
        </div>
        <div className="text-lg font-semibold leading-none">{o.date.slice(8)}</div>
      </div>
      <div className="flex-1 min-w-[8rem]">
        <div className="font-medium text-sm truncate">{o.r.name}</div>
        <div className="text-xs text-subtle">
          {KIND_LABEL[o.r.kind]} · {FREQUENCY_LABEL[o.r.frequency]}
          {o.status === "overdue" && <span className="text-danger"> · pendiente de registrar</span>}
        </div>
      </div>
      <Money cents={o.r.kind === "expense" ? -o.r.amount : o.r.amount} currency={currencyOf(o.r.accountId)} signed={o.r.kind === "income"} className="text-sm font-semibold" />
      <div className="flex gap-1">
        <Button size="sm" onClick={() => onConfirmTarget({ recurringId: o.r.id, date: o.date })}>
          <Check size={14} /> Registrar
        </Button>
        <Button size="sm" variant="ghost" onClick={() => skip(o)} aria-label="Omitir esta ocurrencia" title="Omitir esta ocurrencia">
          <SkipForward size={14} />
        </Button>
      </div>
    </li>
  );

  const target = confirmTarget ? state.finRecurring.find((r) => r.id === confirmTarget.recurringId) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-sm">
          {obligations.map(([c, v]) => (
            <span key={c} className="tabular-nums">
              <span className="text-subtle">Próximos {horizon} días:</span> por pagar{" "}
              <strong>{formatMoney(v.out, c)}</strong> · por cobrar <strong>{formatMoney(v.in, c)}</strong>
            </span>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          <Select aria-label="Horizonte" value={String(horizon)} onChange={(e) => setHorizon(Number(e.target.value))} className="w-auto">
            <option value="7">7 días</option>
            <option value="30">30 días</option>
            <option value="90">90 días</option>
          </Select>
          <Button onClick={() => setEditing({ kind: "expense", frequency: "monthly", startDate: today, accountId: data.accounts.find((a) => !a.archived)?.id })}>
            <Plus size={16} /> Nuevo
          </Button>
        </div>
      </div>

      <p className="text-xs text-subtle">
        Lo previsto no se marca solo como cobrado o pagado: pulsa «Registrar» cuando ocurra de verdad (puedes ajustar el importe y la fecha reales).
      </p>

      {overdue.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2 text-danger">
              <AlertCircle size={16} aria-hidden /> Pendientes de registrar ({overdue.length})
            </CardTitle>
          </CardHeader>
          <ul className="divide-y divide-border">
            {overdue.map((o) => (
              <OccRow key={o.txId} o={o} />
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarClock size={16} aria-hidden /> Calendario de próximos movimientos
          </CardTitle>
        </CardHeader>
        {upcoming.length === 0 ? (
          <CardContent>
            <p className="text-sm text-subtle text-center py-6">Nada previsto en este horizonte.</p>
          </CardContent>
        ) : (
          <ul className="divide-y divide-border">
            {upcoming.map((o) => (
              <OccRow key={o.txId} o={o} />
            ))}
          </ul>
        )}
      </Card>

      <h3 className="gt-heading text-base pt-2">Series</h3>
      {data.recurring.length === 0 ? (
        <Card>
          <Empty icon={Repeat} title="Sin movimientos recurrentes" description="Añade tu salario, arriendo, facturas y suscripciones." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.recurring.map((r) => {
            const st = recurringStatus(state, r, today, 400);
            return (
              <Card key={r.id} className={r.status !== "active" ? "opacity-70" : ""}>
                <CardContent className="space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{r.name}</div>
                      <div className="text-xs text-subtle">
                        {KIND_LABEL[r.kind]} · {FREQUENCY_LABEL[r.frequency]} · desde {r.startDate}
                        {r.endDate ? ` hasta ${r.endDate}` : ""}
                      </div>
                    </div>
                    <Badge>{r.status === "active" ? "Activo" : r.status === "paused" ? "En pausa" : "Finalizado"}</Badge>
                  </div>
                  <div className="flex items-baseline justify-between text-sm">
                    <Money cents={r.amount} currency={currencyOf(r.accountId)} tone="none" className="font-semibold" />
                    <span className="text-xs text-subtle">≈ {formatMoney(st.monthlyEquivalent, currencyOf(r.accountId))}/mes</span>
                  </div>
                  <div className="text-xs text-subtle">
                    Próxima: {st.next ? `${st.next.date}${st.next.status === "overdue" ? " (vencida)" : ""}` : "—"}
                  </div>
                  {(r.allocations ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.allocations!.map((a) => (
                        <PurposeChip key={a.tagId + a.flow} tag={data.finTags.find((t) => t.id === a.tagId)} data={data} amount={a.amount} currency={currencyOf(r.accountId)} flow={a.flow} />
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1 -mx-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Editar ${r.name}`}>
                      <Edit3 size={14} /> Editar
                    </Button>
                    {r.status === "active" ? (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(r, "paused")}>
                        <Pause size={14} /> Pausar
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(r, "active")}>
                        <Play size={14} /> Reactivar
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => remove(r)} aria-label={`Eliminar ${r.name}`}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Editar recurrente" : "Nuevo movimiento recurrente"}>
        {editing && <RecurringForm rec={editing} data={data} onSaved={() => { setEditing(null); reload(); }} />}
      </Dialog>

      <Dialog open={!!target} onClose={() => onConfirmTarget(null)} title="Registrar movimiento real" description={target ? `${target.name} · previsto el ${confirmTarget?.date}` : undefined}>
        {target && confirmTarget && (
          <ConfirmForm
            rec={target}
            date={confirmTarget.date}
            data={data}
            onDone={() => {
              onConfirmTarget(null);
              reload();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function ConfirmForm({ rec, date, data, onDone }: { rec: FinRecurringRow; date: string; data: FinanceData; onDone: () => void }) {
  const [amount, setAmount] = useState<number | null>(rec.amount);
  const [paidDate, setPaidDate] = useState(date <= todayKey() ? date : todayKey());
  const [accountId, setAccountId] = useState(rec.accountId);
  const [saving, setSaving] = useState(false);
  const currency = data.accounts.find((a) => a.id === accountId)?.currency ?? data.defaultCurrency;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount) return;
    setSaving(true);
    try {
      const res = await api.post<{ created: boolean }>(`/finance/recurring/${rec.id}/confirm`, { date, paidDate, amount, accountId });
      toast.success(res.created ? "Movimiento registrado" : "Ya estaba registrado (no se duplicó)");
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Importe real">
          <MoneyInput value={amount} onChange={setAmount} currency={currency} required autoFocus />
        </Field>
        <Field label="Fecha real">
          <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} required />
        </Field>
      </div>
      <Field label="Cuenta">
        <AccountSelect accounts={data.accounts} value={accountId} onChange={setAccountId} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          Confirmar
        </Button>
      </div>
    </form>
  );
}

function RecurringForm({ rec, data, onSaved }: { rec: Partial<FinRecurringRow>; data: FinanceData; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: rec.name ?? "",
    kind: rec.kind ?? "expense",
    amount: rec.amount ?? null,
    accountId: rec.accountId ?? data.accounts.find((a) => !a.archived)?.id ?? "",
    toAccountId: rec.toAccountId ?? "",
    categoryId: rec.categoryId ?? "",
    frequency: (rec.frequency ?? "monthly") as FinFrequency,
    startDate: rec.startDate ?? todayKey(),
    endDate: rec.endDate ?? "",
    note: rec.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [allocs, setAllocs] = useState<AllocationDraft[]>(() => toDrafts(rec.allocations));
  const currency = data.accounts.find((a) => a.id === form.accountId)?.currency ?? data.defaultCurrency;
  const allocCurrency =
    form.kind === "transfer" ? data.accounts.find((a) => a.id === form.toAccountId)?.currency ?? currency : currency;

  if (!data.accounts.some((a) => !a.archived)) {
    return <p className="text-sm text-subtle">Primero crea una cuenta.</p>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount) return toast.error("Indica el importe");
    const parsed = draftsToBody(allocs, form.amount);
    if (parsed.error) return toast.error(parsed.error);
    setSaving(true);
    try {
      const body = {
        ...form,
        toAccountId: form.kind === "transfer" ? form.toAccountId || null : null,
        categoryId: form.kind === "transfer" ? null : form.categoryId || null,
        goalId: null,
        allocations: (parsed.allocations ?? []).map(({ id: _id, ...a }) => a),
        endDate: form.endDate || null,
        note: form.note || null,
        status: rec.status ?? "active",
      };
      if (rec.id) await api.put(`/finance/recurring/${rec.id}`, body);
      else await api.post("/finance/recurring", body);
      toast.success("Guardado");
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Segmented
        label="Tipo"
        value={form.kind}
        onChange={(kind) => setForm({ ...form, kind, categoryId: "" })}
        options={[
          { id: "expense", label: "Gasto fijo" },
          { id: "income", label: "Ingreso" },
          { id: "transfer", label: "Transferencia" },
        ]}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Nombre">
          <Input required autoFocus maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Salario, arriendo, Netflix…" />
        </Field>
        <Field label="Importe previsto">
          <MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} currency={currency} required />
        </Field>
        <Field label={form.kind === "transfer" ? "Desde" : "Cuenta"}>
          <AccountSelect accounts={data.accounts} value={form.accountId} onChange={(v) => setForm({ ...form, accountId: v })} />
        </Field>
        {form.kind === "transfer" ? (
          <Field label="Hacia">
            <AccountSelect accounts={data.accounts} value={form.toAccountId} onChange={(v) => setForm({ ...form, toAccountId: v })} allowEmpty emptyLabel="Elige" exclude={form.accountId} />
          </Field>
        ) : (
          <Field label="Categoría">
            <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Sin categoría</option>
              {data.categories
                .filter((c) => !c.archived && (form.kind === "income" ? c.kind !== "expense" : c.kind !== "income"))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Field label="Frecuencia">
          <Select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as FinFrequency })}>
            {(["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly"] as FinFrequency[]).map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABEL[f]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Primera fecha">
          <Input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </Field>
        <Field label="Fecha final (opcional)">
          <Input type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
        </Field>
      </div>
      <div>
        <p className="text-xs text-subtle mb-2">
          Reparto por defecto de cada ocurrencia (p. ej. del salario: una parte a cada meta). Se aplica al registrarla y se puede ajustar.
        </p>
        <AllocationEditor
          data={data}
          kind={form.kind}
          total={form.amount}
          currency={allocCurrency}
          drafts={allocs}
          onChange={setAllocs}
          keepTagIds={(rec.allocations ?? []).map((a) => a.tagId)}
        />
      </div>
      <Field label="Nota (opcional)">
        <Textarea maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="min-h-[60px]" />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          Guardar
        </Button>
      </div>
    </form>
  );
}
