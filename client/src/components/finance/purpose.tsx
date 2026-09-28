import { useMemo, useState } from "react";
import { Hash, Plus, Trash2 } from "lucide-react";
import { Field, Input, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { slugTag, tagOwnerActive, type FinAllocation, type FinTagRow, type FinTxKind } from "@/services/localDb";
import type { FinanceData } from "@/hooks/useFinance";
import { MoneyInput } from "./shared";

/* ------------------------------------------------------------ chip */

/** Etiqueta financiera con su dueño: `#Ordenador · Meta`. Nunca ambigua. */
export function PurposeChip({
  tag,
  data,
  amount,
  currency,
  flow,
  showOwner = false,
  onClick,
}: {
  tag: FinTagRow | undefined;
  data: Pick<FinanceData, "budgets" | "goals">;
  amount?: number;
  currency?: string;
  flow?: FinAllocation["flow"];
  showOwner?: boolean;
  onClick?: () => void;
}) {
  const owner = tag ? ownerOf(data, tag) : null;
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={owner ? `${owner.kind === "goal" ? "Meta" : "Presupuesto"}: ${owner.name}` : "Finalidad eliminada"}
      className={cn(
        "gt-pill inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium border",
        onClick && "hover:opacity-80"
      )}
      style={{ color: tag?.color ?? "#64748b", borderColor: `${tag?.color ?? "#64748b"}55`, background: `${tag?.color ?? "#64748b"}14` }}
    >
      <span>#{tag?.name ?? "—"}</span>
      {showOwner && owner && <span className="text-subtle font-normal">· {owner.name}</span>}
      {amount !== undefined && currency && (
        <span className="tabular-nums font-normal">
          {flow === "use" ? "−" : ""}
          {formatMoney(amount, currency, { compact: true })}
        </span>
      )}
    </Comp>
  );
}

export function ownerOf(data: Pick<FinanceData, "budgets" | "goals">, tag: FinTagRow) {
  if (tag.ownerType === "budget") {
    const b = data.budgets.find((x) => x.id === tag.ownerId);
    return b ? { kind: "budget" as const, name: b.name, status: b.status, currency: b.currency } : null;
  }
  const g = data.goals.find((x) => x.id === tag.ownerId);
  return g ? { kind: "goal" as const, name: g.name, status: g.status, currency: g.currency } : null;
}

/* --------------------------------------------------- campo de etiqueta */

/**
 * Campo de etiqueta obligatoria para presupuestos y metas. Mientras el
 * usuario no la toque, se genera a partir del nombre; se avisa si choca con
 * otra finalidad activa (el servidor lo impide igualmente).
 */
export function TagField({
  name,
  value,
  onChange,
  data,
  ownerId,
}: {
  name: string;
  value: string | null;
  onChange: (v: string | null) => void;
  data: FinanceData;
  ownerId?: string;
}) {
  const effective = value ?? slugTag(name || "");
  const clash = useMemo(() => {
    const key = slugTag(effective).toLowerCase();
    return data.finTags.find(
      (t) => t.ownerId !== ownerId && t.name.toLowerCase() === key && tagOwnerActive({ finBudgets: data.budgets, finGoals: data.goals }, t)
    );
  }, [effective, data, ownerId]);
  const owner = clash ? ownerOf(data, clash) : null;

  return (
    <Field
      label="Etiqueta financiera"
      hint={
        value === null
          ? "Se genera del nombre; puedes cambiarla. Sirve para vincular movimientos a esta finalidad."
          : "Identifica los movimientos destinados a esta finalidad."
      }
    >
      <div className="relative">
        <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
        <Input
          aria-label="Etiqueta financiera"
          value={value ?? (name ? slugTag(name) : "")}
          maxLength={40}
          onChange={(e) => onChange(e.target.value.replace(/^#/, ""))}
          onBlur={() => value !== null && onChange(value.trim() ? slugTag(value) : null)}
          className={cn("pl-8", clash && "border-warning")}
          placeholder="MiFinalidad"
        />
      </div>
      {clash && owner && value !== null && (
        <p className="text-xs text-warning mt-1">
          #{clash.name} ya pertenece a «{owner.name}». Elige otro nombre.
        </p>
      )}
    </Field>
  );
}

/* ------------------------------------------------ editor de asignaciones */

export interface AllocationDraft {
  key: string;
  id?: string;
  tagId: string;
  amount: number | null;
  flow: FinAllocation["flow"];
}

let draftSeq = 0;
export const toDrafts = (list: (Omit<FinAllocation, "id"> & { id?: string })[] | undefined): AllocationDraft[] =>
  (list ?? []).map((a) => ({ key: `d${++draftSeq}`, id: a.id, tagId: a.tagId, amount: a.amount, flow: a.flow }));

/** Tag ids que se pueden elegir: activos, más los que ya estaban (historial). */
export function selectableTags(data: FinanceData, currency: string, keep: string[] = []) {
  const state = { finBudgets: data.budgets, finGoals: data.goals };
  return data.finTags
    .filter((t) => keep.includes(t.id) || (tagOwnerActive(state, t) && ownerOf(data, t)?.currency === currency))
    .sort((a, b) => a.ownerType.localeCompare(b.ownerType) || a.name.localeCompare(b.name));
}

/**
 * Reparto de un movimiento entre finalidades. Muestra el importe original, lo
 * asignado y lo que queda sin asignar; no deja superar el importe.
 * Asignar es opcional y nunca se rellena solo.
 */
export function AllocationEditor({
  data,
  kind,
  total,
  currency,
  drafts,
  onChange,
  keepTagIds = [],
}: {
  data: FinanceData;
  kind: FinTxKind;
  /** Importe disponible para repartir (céntimos). */
  total: number | null;
  currency: string;
  drafts: AllocationDraft[];
  onChange: (d: AllocationDraft[]) => void;
  keepTagIds?: string[];
}) {
  const options = selectableTags(data, currency, keepTagIds);
  const assigned = drafts.reduce((s, d) => s + (d.amount ?? 0), 0);
  const cap = total ?? 0;
  const remaining = cap - assigned;
  const over = remaining < 0;
  const defaultFlow: FinAllocation["flow"] = kind === "expense" ? "use" : "assign";
  const [open, setOpen] = useState(drafts.length > 0);

  const update = (key: string, patch: Partial<AllocationDraft>) =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} disabled={options.length === 0}>
          <Hash size={14} /> Destinar a una finalidad
        </Button>
        <span className="text-xs text-subtle">
          {options.length === 0
            ? "Crea un presupuesto o una meta para poder destinar dinero a una finalidad."
            : "Opcional: sin finalidad, el dinero queda disponible."}
        </span>
      </div>
    );
  }

  const verb = kind === "expense" ? "con cargo a" : kind === "income" ? "destinado a" : "hacia";

  return (
    <fieldset className="gt-surface p-3 space-y-3">
      <legend className="sr-only">Destino del dinero por finalidades</legend>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-medium text-subtle uppercase tracking-wide">Finalidades ({verb})</span>
        <div className="text-xs tabular-nums flex flex-wrap gap-x-3" aria-live="polite">
          <span>
            Importe <strong>{formatMoney(cap, currency)}</strong>
          </span>
          <span>
            Asignado <strong>{formatMoney(assigned, currency)}</strong>
          </span>
          <span className={over ? "text-danger font-semibold" : remaining === 0 ? "text-success" : ""}>
            {over ? "Excede en" : "Sin asignar"} <strong>{formatMoney(Math.abs(remaining), currency)}</strong>
          </span>
        </div>
      </div>

      {/* Barra de reparto: cada finalidad con su color, el resto en gris. */}
      {cap > 0 && (
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          {drafts.map((d) => {
            const tag = data.finTags.find((t) => t.id === d.tagId);
            const w = Math.max(0, Math.min(100, ((d.amount ?? 0) / cap) * 100));
            return <span key={d.key} style={{ width: `${w}%`, background: tag?.color ?? "rgb(var(--primary))" }} className="border-r-2 border-surface last:border-r-0" />;
          })}
        </div>
      )}

      {drafts.map((d) => {
        const tag = data.finTags.find((t) => t.id === d.tagId);
        const owner = tag ? ownerOf(data, tag) : null;
        return (
          <div key={d.key} className="grid grid-cols-[1fr,auto] sm:grid-cols-[1fr,10rem,auto] gap-2 items-start">
            <Select
              aria-label="Finalidad"
              value={d.tagId}
              onChange={(e) => update(d.key, { tagId: e.target.value })}
              className="col-span-2 sm:col-span-1"
            >
              <option value="">Elige finalidad…</option>
              <optgroup label="Metas de ahorro">
                {options.filter((t) => t.ownerType === "goal").map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.name} — {ownerOf(data, t)?.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Presupuestos">
                {options.filter((t) => t.ownerType === "budget").map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.name} — {ownerOf(data, t)?.name}
                  </option>
                ))}
              </optgroup>
            </Select>
            <MoneyInput value={d.amount} onChange={(v) => update(d.key, { amount: v })} currency={currency} ariaLabel={`Importe para #${tag?.name ?? "finalidad"}`} />
            <div className="flex items-center gap-1">
              {kind === "transfer" && (
                <Select aria-label="Sentido" value={d.flow} onChange={(e) => update(d.key, { flow: e.target.value as FinAllocation["flow"] })} className="w-28">
                  <option value="assign">Aportar</option>
                  <option value="use">Retirar</option>
                </Select>
              )}
              <button
                type="button"
                className="p-2 rounded-md text-subtle hover:text-danger hover:bg-muted"
                onClick={() => onChange(drafts.filter((x) => x.key !== d.key))}
                aria-label={`Quitar #${tag?.name ?? "finalidad"}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
            {owner && owner.status !== "active" && owner.status !== "paused" && (
              <p className="col-span-full text-xs text-subtle -mt-1">Finalidad {owner.status === "completed" ? "completada" : "archivada"}: se conserva en el historial.</p>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange([...drafts, { key: `d${++draftSeq}`, tagId: "", amount: null, flow: defaultFlow }])}
          disabled={options.length === 0 || drafts.length >= 20}
        >
          <Plus size={14} /> Añadir finalidad
        </Button>
        {remaining > 0 && drafts.some((d) => d.tagId && !d.amount) && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              const target = drafts.find((d) => d.tagId && !d.amount)!;
              update(target.key, { amount: remaining });
            }}
          >
            Asignar el resto ({formatMoney(remaining, currency, { compact: true })})
          </Button>
        )}
      </div>
      {over && <p className="text-xs text-danger" role="alert">Lo asignado supera el importe del movimiento.</p>}
    </fieldset>
  );
}

/** Convierte borradores en el cuerpo de la API; devuelve un error legible si faltan datos. */
export function draftsToBody(drafts: AllocationDraft[], total: number | null): { allocations?: { id?: string; tagId: string; amount: number; flow: FinAllocation["flow"] }[]; error?: string } {
  const out = [];
  for (const d of drafts) {
    if (!d.tagId && !d.amount) continue; // fila vacía: se ignora
    if (!d.tagId) return { error: "Elige la finalidad de cada importe asignado" };
    if (!d.amount || d.amount <= 0) return { error: "Indica el importe de cada finalidad" };
    out.push({ id: d.id, tagId: d.tagId, amount: d.amount, flow: d.flow });
  }
  const sum = out.reduce((s, a) => s + a.amount, 0);
  if (total !== null && sum > total) return { error: "Las finalidades suman más que el importe" };
  return { allocations: out };
}
