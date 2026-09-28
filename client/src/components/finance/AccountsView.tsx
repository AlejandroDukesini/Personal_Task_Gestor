import { useState } from "react";
import toast from "react-hot-toast";
import { Archive, ArchiveRestore, Edit3, Plus, Scale, Trash2, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Empty } from "@/components/ui/Empty";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/services/api";
import { newId, type FinAccountType } from "@/services/localDb";
import type { FinAccount, FinanceData } from "@/hooks/useFinance";
import { CURRENCIES } from "@/lib/money";
import { todayKey } from "@/services/finance/dates";
import { ACCOUNT_TYPE_LABEL, DynIcon, FIN_ICONS, Money, MoneyInput, errorMessage } from "./shared";

export function AccountsView({ data, reload }: { data: FinanceData; reload: () => void }) {
  const [editing, setEditing] = useState<Partial<FinAccount> | null>(null);
  const [reconciling, setReconciling] = useState<FinAccount | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const visible = data.accounts.filter((a) => showArchived || !a.archived);
  const archivedCount = data.accounts.filter((a) => a.archived).length;

  async function toggleArchive(a: FinAccount) {
    try {
      await api.put(`/finance/accounts/${a.id}`, { archived: !a.archived });
      toast.success(a.archived ? "Cuenta restaurada" : "Cuenta archivada: su historial se conserva");
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function remove(a: FinAccount) {
    if (!confirm(`¿Eliminar la cuenta «${a.name}»? Solo es posible si no tiene movimientos.`)) return;
    try {
      await api.delete(`/finance/accounts/${a.id}`);
      toast.success("Cuenta eliminada");
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        {archivedCount > 0 ? (
          <label className="flex items-center gap-2 text-sm text-subtle">
            <input type="checkbox" className="accent-primary" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Mostrar archivadas ({archivedCount})
          </label>
        ) : (
          <span />
        )}
        <Button onClick={() => setEditing({ type: "bank", currency: data.defaultCurrency, initialBalance: 0, includeInTotal: true })}>
          <Plus size={16} /> Nueva cuenta
        </Button>
      </div>

      {visible.length === 0 ? (
        <Card>
          <Empty
            icon={Wallet}
            title="Aún no tienes cuentas"
            description="Crea tu efectivo, tus cuentas bancarias o tarjetas para empezar a registrar movimientos."
            action={
              <Button onClick={() => setEditing({ type: "cash", currency: data.defaultCurrency, initialBalance: 0, includeInTotal: true })}>
                <Plus size={16} /> Crear cuenta
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {visible.map((a) => (
            <Card key={a.id} className={a.archived ? "opacity-70" : ""}>
              <CardContent>
                <div className="flex items-start gap-3">
                  <span className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${a.color}22`, color: a.color }}>
                    <DynIcon name={a.icon} size={18} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{a.name}</div>
                    <div className="text-xs text-subtle flex flex-wrap gap-1.5 items-center">
                      {ACCOUNT_TYPE_LABEL[a.type]} · {a.currency}
                      {a.archived && <Badge>Archivada</Badge>}
                      {!a.includeInTotal && <Badge>Fuera del total</Badge>}
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-2xl font-semibold">
                  <Money cents={a.balance} currency={a.currency} />
                </div>
                {a.description && <p className="text-xs text-subtle mt-1 line-clamp-2">{a.description}</p>}
                <div className="flex flex-wrap gap-1 mt-3 -mx-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(a)} aria-label={`Editar ${a.name}`}>
                    <Edit3 size={14} /> Editar
                  </Button>
                  {!a.archived && (
                    <Button size="sm" variant="ghost" onClick={() => setReconciling(a)}>
                      <Scale size={14} /> Ajustar saldo
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => toggleArchive(a)}>
                    {a.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                    {a.archived ? "Restaurar" : "Archivar"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(a)} aria-label={`Eliminar ${a.name}`}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Editar cuenta" : "Nueva cuenta"}>
        {editing && <AccountForm account={editing} data={data} onSaved={() => { setEditing(null); reload(); }} />}
      </Dialog>

      <Dialog open={!!reconciling} onClose={() => setReconciling(null)} title="Ajustar saldo" description="Indica el saldo real; se registrará una corrección por la diferencia, con su motivo.">
        {reconciling && <ReconcileForm account={reconciling} onSaved={() => { setReconciling(null); reload(); }} />}
      </Dialog>
    </div>
  );
}

function AccountForm({ account, data, onSaved }: { account: Partial<FinAccount>; data: FinanceData; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: account.name ?? "",
    type: (account.type ?? "bank") as FinAccountType,
    currency: account.currency ?? data.defaultCurrency,
    initialBalance: account.initialBalance ?? 0,
    description: account.description ?? "",
    color: account.color ?? "",
    icon: account.icon ?? "",
    includeInTotal: account.includeInTotal ?? true,
  });
  const [saving, setSaving] = useState(false);
  const hasTx = !!account.id && data.transactions.some((t) => t.accountId === account.id || t.toAccountId === account.id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        ...form,
        description: form.description.trim() || null,
        color: form.color || undefined,
        icon: form.icon || undefined,
      };
      if (account.id) await api.put(`/finance/accounts/${account.id}`, body);
      else await api.post("/finance/accounts", body);
      toast.success("Cuenta guardada");
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Tipo">
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as FinAccountType })}>
            {(Object.keys(ACCOUNT_TYPE_LABEL) as FinAccountType[]).map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Moneda" hint={hasTx ? "No se puede cambiar: la cuenta ya tiene movimientos." : undefined}>
          <Select disabled={hasTx} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field
        label="Saldo inicial"
        hint={form.type === "credit_card" ? "En tarjetas de crédito, una deuda es un saldo negativo." : "Saldo con el que empiezas a registrar."}
      >
        <MoneyInput value={form.initialBalance} onChange={(v) => setForm({ ...form, initialBalance: v ?? 0 })} currency={form.currency} allowNegative />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Color">
          <Input type="color" value={form.color || "#2563eb"} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-9 p-1" />
        </Field>
        <Field label="Icono">
          <Select value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
            <option value="">Según el tipo</option>
            {Object.keys(FIN_ICONS).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Descripción (opcional)">
        <Textarea maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-[60px]" />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-primary" checked={form.includeInTotal} onChange={(e) => setForm({ ...form, includeInTotal: e.target.checked })} />
        Incluir en el saldo total
      </label>
      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          Guardar
        </Button>
      </div>
    </form>
  );
}

function ReconcileForm({ account, onSaved }: { account: FinAccount; onSaved: () => void }) {
  const [balance, setBalance] = useState<number | null>(account.balance);
  const [reason, setReason] = useState("Conciliación con el saldo real");
  const [date, setDate] = useState(todayKey());
  const [key] = useState(() => newId());
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (balance === null) return;
    setSaving(true);
    try {
      const res = await api.post<{ adjusted: boolean; delta: number }>(`/finance/accounts/${account.id}/reconcile`, {
        balance,
        reason,
        date,
        id: key,
      });
      toast.success(res.adjusted ? "Corrección registrada" : "El saldo ya coincidía");
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm">
        Saldo calculado: <Money cents={account.balance} currency={account.currency} />
      </p>
      <Field label="Saldo real">
        <MoneyInput value={balance} onChange={setBalance} currency={account.currency} allowNegative autoFocus required />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Fecha">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Motivo">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={300} />
        </Field>
      </div>
      {balance !== null && balance !== account.balance && (
        <p className="text-sm text-subtle">
          Se registrará una corrección de <Money cents={balance - account.balance} currency={account.currency} signed />.
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          Registrar corrección
        </Button>
      </div>
    </form>
  );
}
