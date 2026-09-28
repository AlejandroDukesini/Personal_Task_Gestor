import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/services/api";
import { newId, type FinTransactionRow, type FinTxKind } from "@/services/localDb";
import { todayKey } from "@/services/finance/dates";
import type { FinanceData } from "@/hooks/useFinance";
import { AccountSelect, KIND_LABEL, MoneyInput, Segmented, errorMessage } from "./shared";
import { AllocationEditor, draftsToBody, toDrafts, type AllocationDraft } from "./purpose";
import { allocationsOf } from "@/services/finance/calc";

/**
 * Alta y edición de movimientos. El id se genera AL ABRIR el formulario y
 * viaja con el envío: un doble clic, un reintento tras un error de red o un
 * segundo envío tras un bloqueo del navegador devuelven el mismo movimiento
 * en lugar de crear dos (la API es idempotente por id).
 */
export function TransactionForm({
  data,
  tx,
  initialKind = "expense",
  initialAccountId,
  onSaved,
}: {
  data: FinanceData;
  tx?: FinTransactionRow | null;
  initialKind?: FinTxKind;
  initialAccountId?: string;
  onSaved: () => void;
}) {
  const active = data.accounts.filter((a) => !a.archived);
  const [idempotencyKey] = useState(() => newId());
  const [kind, setKind] = useState<FinTxKind>(tx?.kind ?? initialKind);
  const [amount, setAmount] = useState<number | null>(tx ? Math.abs(tx.amount) : null);
  const [adjustSign, setAdjustSign] = useState<1 | -1>(tx && tx.kind === "adjustment" && tx.amount < 0 ? -1 : 1);
  const [accountId, setAccountId] = useState(tx?.accountId ?? initialAccountId ?? active[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(tx?.toAccountId ?? "");
  const [toAmount, setToAmount] = useState<number | null>(tx?.toAmount ?? null);
  const [categoryId, setCategoryId] = useState(tx?.categoryId ?? "");
  const [date, setDate] = useState(tx?.date ?? todayKey());
  const [concept, setConcept] = useState(tx?.concept ?? "");
  const [description, setDescription] = useState(tx?.description ?? "");
  const [tagIds, setTagIds] = useState<string[]>(tx?.tagIds ?? []);
  // Las filas antiguas con `goalId` se muestran ya como asignación editable.
  const [allocs, setAllocs] = useState<AllocationDraft[]>(() =>
    tx
      ? toDrafts(
          allocationsOf(
            { finAccounts: data.accounts, finCategories: data.categories, finTransactions: [], finBudgets: data.budgets, finGoals: data.goals, finRecurring: [], finTags: data.finTags },
            tx
          )
        )
      : []
  );
  // Las finalidades ya vinculadas siguen elegibles aunque estén archivadas.
  const [originalTagIds] = useState(() => allocs.map((a) => a.tagId));
  const [reason, setReason] = useState(tx?.reason ?? "");
  const [saving, setSaving] = useState(false);

  const account = data.accounts.find((a) => a.id === accountId);
  const toAccount = data.accounts.find((a) => a.id === toAccountId);
  const currency = account?.currency ?? data.defaultCurrency;
  const crossCurrency = kind === "transfer" && !!toAccount && !!account && toAccount.currency !== account.currency;
  // Lo que se puede repartir: en una transferencia entre monedas, lo recibido.
  const allocTotal = kind === "transfer" && crossCurrency ? toAmount : amount;
  const allocCurrency = kind === "transfer" ? toAccount?.currency ?? currency : currency;

  const categories = useMemo(
    () =>
      data.categories.filter(
        (c) =>
          (!c.archived || c.id === tx?.categoryId) &&
          (kind === "income" ? c.kind !== "expense" : kind === "expense" ? c.kind !== "income" : true)
      ),
    [data.categories, kind, tx?.categoryId]
  );

  if (active.length === 0 && !tx) {
    return <p className="text-sm text-subtle">Primero crea una cuenta en la pestaña «Cuentas».</p>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || amount <= 0) {
      toast.error("Indica un importe válido mayor que cero");
      return;
    }
    if (kind === "transfer" && !toAccountId) {
      toast.error("Elige la cuenta de destino");
      return;
    }
    const parsedAllocs = draftsToBody(allocs, allocTotal);
    if (parsedAllocs.error) {
      toast.error(parsedAllocs.error);
      return;
    }
    setSaving(true);
    try {
      const body = {
        id: tx ? undefined : idempotencyKey,
        kind,
        amount: kind === "adjustment" ? amount * adjustSign : amount,
        accountId,
        toAccountId: kind === "transfer" ? toAccountId : null,
        toAmount: crossCurrency ? toAmount : null,
        categoryId: kind === "income" || kind === "expense" ? categoryId || null : null,
        date,
        concept: concept.trim() || KIND_LABEL[kind],
        description: description.trim() || null,
        tagIds,
        allocations: parsedAllocs.allocations ?? [],
        reason: kind === "adjustment" ? reason : null,
      };
      if (tx) await api.put(`/finance/transactions/${tx.id}`, body);
      else await api.post("/finance/transactions", body);
      toast.success(tx ? "Movimiento actualizado" : "Movimiento registrado");
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Segmented
        label="Tipo de movimiento"
        value={kind}
        onChange={(k) => {
          setKind(k);
          setCategoryId("");
        }}
        options={(["expense", "income", "transfer", "adjustment"] as FinTxKind[]).map((k) => ({ id: k, label: KIND_LABEL[k] }))}
      />
      <p className="text-xs text-subtle -mt-2">
        {kind === "income" && "Dinero que entra desde fuera (salario, ventas, regalos…)."}
        {kind === "expense" && "Dinero que sale hacia fuera (compras, facturas…)."}
        {kind === "transfer" && "Mueve dinero entre tus cuentas. No cuenta como ingreso ni gasto."}
        {kind === "adjustment" && "Corrige el saldo cuando no cuadra con la realidad. Queda registrado con su motivo."}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={kind === "transfer" ? "Importe enviado" : "Importe"}>
          <div className="flex gap-2">
            {kind === "adjustment" && (
              <Select
                aria-label="Sentido de la corrección"
                value={String(adjustSign)}
                onChange={(e) => setAdjustSign(Number(e.target.value) as 1 | -1)}
                className="w-20"
              >
                <option value="1">+</option>
                <option value="-1">−</option>
              </Select>
            )}
            <div className="flex-1">
              <MoneyInput value={amount} onChange={setAmount} currency={currency} required autoFocus ariaLabel="Importe" />
            </div>
          </div>
        </Field>
        <Field label="Fecha">
          <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={kind === "transfer" ? "Desde" : "Cuenta"}>
          <AccountSelect accounts={data.accounts} value={accountId} onChange={setAccountId} includeArchivedId={tx?.accountId} />
        </Field>
        {kind === "transfer" ? (
          <Field label="Hacia">
            <AccountSelect
              accounts={data.accounts}
              value={toAccountId}
              onChange={setToAccountId}
              allowEmpty
              emptyLabel="Elige destino"
              exclude={accountId}
              includeArchivedId={tx?.toAccountId}
            />
          </Field>
        ) : kind === "income" || kind === "expense" ? (
          <Field label="Categoría">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Motivo de la corrección">
            <Input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: conciliación con el extracto" />
          </Field>
        )}
      </div>

      {crossCurrency && (
        <Field label={`Importe recibido en ${toAccount!.currency}`} hint="Entre monedas distintas indica lo que llegó realmente; no se inventa un tipo de cambio.">
          <MoneyInput value={toAmount} onChange={setToAmount} currency={toAccount!.currency} required />
        </Field>
      )}

      <Field label="Concepto">
        <Input value={concept} maxLength={120} onChange={(e) => setConcept(e.target.value)} placeholder={KIND_LABEL[kind]} />
      </Field>

      <AllocationEditor
        data={data}
        kind={kind}
        total={allocTotal}
        currency={allocCurrency}
        drafts={allocs}
        onChange={setAllocs}
        keepTagIds={originalTagIds}
      />

      {data.tags.length > 0 && (
        <Field label="Etiquetas generales (opcional)">
          <div className="flex flex-wrap gap-2">
            {data.tags.map((t) => {
              const on = tagIds.includes(t.id);
              return (
                <button
                  type="button"
                  key={t.id}
                  aria-pressed={on}
                  onClick={() => setTagIds(on ? tagIds.filter((x) => x !== t.id) : [...tagIds, t.id])}
                  style={{ opacity: on ? 1 : 0.5 }}
                >
                  <Badge color={t.color}>{t.name}</Badge>
                </button>
              );
            })}
          </div>
        </Field>
      )}

      <Field label="Descripción (opcional)">
        <Textarea value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} className="min-h-[60px]" />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          {tx ? "Guardar cambios" : "Registrar"}
        </Button>
      </div>
    </form>
  );
}
