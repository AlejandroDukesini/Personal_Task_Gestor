import { useState } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckCircle2, ChevronDown, Merge, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { COLLECTION_LABEL } from "@/services/manualsync/keyspace";
import type { ChangeItem, Conflict, Plan, Resolution } from "@/services/manualsync/engine";

const FIELD_LABEL: Record<string, string> = {
  title: "Título",
  name: "Nombre",
  concept: "Concepto",
  description: "Descripción",
  notes: "Notas",
  amount: "Importe",
  toAmount: "Importe recibido",
  initialBalance: "Saldo inicial",
  targetAmount: "Objetivo",
  accountId: "Cuenta",
  toAccountId: "Cuenta destino",
  categoryId: "Categoría",
  date: "Fecha",
  dueDate: "Vencimiento",
  dueTime: "Hora",
  status: "Estado",
  priority: "Prioridad",
  progress: "Progreso",
  kind: "Tipo",
  allocations: "Finalidades",
  tagIds: "Etiquetas",
  color: "Color",
  archived: "Archivado",
  count: "Veces",
  reason: "Motivo",
  deadline: "Fecha límite",
};

const KIND_TEXT: Record<ChangeItem["kind"], string> = { new: "nuevo", update: "modificado", delete: "eliminado" };

/** Valor legible: importes en moneda, fechas cortas, booleanos en español. */
function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "number" && /amount|balance/i.test(field)) return formatMoney(v, "COP");
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === "object") {
      return v.map((a: any) => (a?.amount ? `${a.flow === "use" ? "−" : ""}${formatMoney(a.amount, "COP", { compact: true })}` : "…")).join(", ");
    }
    return v.length ? v.join(", ") : "—";
  }
  if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
  return String(v).slice(0, 120);
}

export function PlanReview({
  plan,
  peerName,
  selfName,
  busy,
  onConfirm,
  onCancel,
}: {
  plan: Plan;
  peerName: string;
  selfName: string;
  busy?: boolean;
  onConfirm: (r: Record<string, Resolution>) => void;
  onCancel: () => void;
}) {
  const [res, setRes] = useState<Record<string, Resolution>>({});
  const unresolved = plan.conflicts.filter((c) => !res[c.key]).length;
  const nothing = !plan.incoming.length && !plan.outgoing.length && !plan.conflicts.length;

  const bulk = (fn: (c: Conflict) => Resolution | null) =>
    setRes((prev) => {
      const next = { ...prev };
      for (const c of plan.conflicts) {
        const r = fn(c);
        if (r) next[c.key] = r;
      }
      return next;
    });

  if (plan.errors.length) {
    return (
      <div className="space-y-3" role="alert">
        <p className="text-sm text-danger flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          No se puede sincronizar:
        </p>
        <ul className="text-sm list-disc pl-6 space-y-1">
          {plan.errors.slice(0, 8).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <Button variant="outline" onClick={onCancel} className="w-full sm:w-auto">
          Cerrar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat icon={ArrowDownLeft} value={plan.incoming.length} label={`Llegan de ${peerName}`} />
        <Stat icon={ArrowUpRight} value={plan.outgoing.length} label={`Salen de ${selfName}`} />
        <Stat icon={AlertTriangle} value={plan.conflicts.length} label="Conflictos" tone={plan.conflicts.length ? "warn" : undefined} />
      </div>

      {nothing && (
        <p className="text-sm flex items-center gap-2 text-success">
          <CheckCircle2 size={16} /> Ambos dispositivos ya tienen los mismos datos.
        </p>
      )}
      {!plan.hasBase && !nothing && (
        <p className="text-xs text-subtle">Primera sincronización entre estos dispositivos: se comparan todos los datos.</p>
      )}

      <ChangeList title={`Cambios que llegan de «${peerName}»`} items={plan.incoming} />
      <ChangeList title={`Cambios que se envían a «${peerName}»`} items={plan.outgoing} />
      {plan.auto.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-subtle">Resueltos automáticamente ({plan.auto.length}) — sin riesgo</summary>
          <ul className="mt-2 space-y-1 text-xs text-subtle">
            {plan.auto.map((a) => (
              <li key={a.key}>
                {a.label}: {a.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {plan.conflicts.length > 0 && (
        <section className="space-y-3" aria-label="Conflictos">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="font-semibold text-sm">Conflictos: el mismo dato cambió en los dos dispositivos</h3>
            <span className={cn("text-xs", unresolved ? "text-warning" : "text-success")}>
              {unresolved ? `${unresolved} por decidir` : "Todos decididos"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => bulk(() => ({ choice: "local" }))}>
              Todo como en {selfName}
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulk(() => ({ choice: "remote" }))}>
              Todo como en {peerName}
            </Button>
            {plan.conflicts.some((c) => !c.finance && c.suggestion) && (
              <Button size="sm" variant="ghost" onClick={() => bulk((c) => (!c.finance && c.suggestion ? { choice: c.suggestion } : null))}>
                <Wand2 size={14} /> No financieros: el más reciente
              </Button>
            )}
          </div>
          {plan.conflicts.map((c) => (
            <ConflictCard key={c.key} c={c} value={res[c.key]} onChange={(r) => setRes({ ...res, [c.key]: r })} selfName={selfName} peerName={peerName} />
          ))}
        </section>
      )}

      {/* Barra de acciones fija abajo en el móvil: siempre alcanzable con el pulgar. */}
      <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] bg-surface border-t border-border flex gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy} className="flex-1 sm:flex-none">
          Cancelar
        </Button>
        <Button onClick={() => onConfirm(res)} disabled={busy || unresolved > 0} loading={busy} className="flex-1">
          {nothing ? "Marcar como sincronizado" : unresolved ? `Decide ${unresolved} conflicto(s)` : "Sincronizar"}
        </Button>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, value, label, tone }: { icon: typeof ArrowDownLeft; value: number; label: string; tone?: "warn" }) {
  return (
    <div className={cn("gt-surface p-3", tone === "warn" && "border-warning")}>
      <Icon size={16} className={cn("mx-auto", tone === "warn" ? "text-warning" : "text-subtle")} aria-hidden />
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-subtle leading-tight">{label}</div>
    </div>
  );
}

function ChangeList({ title, items }: { title: string; items: ChangeItem[] }) {
  if (!items.length) return null;
  const m = new Map<string, ChangeItem[]>();
  for (const i of items) m.set(i.collection, [...(m.get(i.collection) ?? []), i]);
  const byType = [...m.entries()];
  return (
    <details className="gt-surface p-3 group" open={items.length <= 6}>
      <summary className="cursor-pointer text-sm font-medium flex items-center justify-between list-none">
        {title} ({items.length})
        <ChevronDown size={16} className="text-subtle group-open:rotate-180 transition-transform" />
      </summary>
      <ul className="mt-2 space-y-1 text-sm">
        {byType.map(([col, list]) => (
          <li key={col}>
            <span className="text-xs text-subtle">{COLLECTION_LABEL[col] ?? col}</span>
            <ul className="pl-2">
              {list.slice(0, 30).map((i) => (
                <li key={i.key} className="truncate">
                  {i.label} <span className="text-xs text-subtle">· {KIND_TEXT[i.kind]}</span>
                </li>
              ))}
              {list.length > 30 && <li className="text-xs text-subtle">…y {list.length - 30} más</li>}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ConflictCard({
  c,
  value,
  onChange,
  selfName,
  peerName,
}: {
  c: Conflict;
  value: Resolution | undefined;
  onChange: (r: Resolution) => void;
  selfName: string;
  peerName: string;
}) {
  const combining = value?.choice === "combine";
  const fields = combining ? (value as Extract<Resolution, { choice: "combine" }>).fields : {};
  const option = (choice: "local" | "remote", title: string, row: Record<string, unknown> | null) => (
    <button
      type="button"
      role="radio"
      aria-checked={value?.choice === choice}
      onClick={() => onChange({ choice })}
      className={cn(
        "text-left p-3 rounded-lg border-2 min-h-[44px] w-full",
        value?.choice === choice ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
      )}
    >
      <div className="text-xs font-semibold mb-1 flex items-center justify-between gap-1">
        {title}
        {c.suggestion === choice && <span className="text-[10px] font-normal text-subtle">más reciente</span>}
      </div>
      {row === null ? (
        <div className="text-sm text-danger">Eliminado</div>
      ) : c.fields.length ? (
        <dl className="text-xs space-y-0.5">
          {c.fields.slice(0, 6).map((f) => (
            <div key={f.field} className="flex gap-1">
              <dt className="text-subtle shrink-0">{FIELD_LABEL[f.field] ?? f.field}:</dt>
              <dd className="truncate">{show(f.field, choice === "local" ? f.local : f.remote)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="text-xs text-subtle">Mismo contenido visible</div>
      )}
    </button>
  );

  return (
    <div className={cn("gt-surface p-3 space-y-2", c.finance && "border-warning")} role="radiogroup" aria-label={`Conflicto: ${c.label}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-subtle">{COLLECTION_LABEL[c.collection] ?? c.collection}</div>
          <div className="font-medium truncate">{c.label}</div>
        </div>
        {c.finance && <span className="text-[10px] uppercase tracking-wide text-warning shrink-0">Dato financiero · decide tú</span>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {option("local", `Como en ${selfName}`, c.local)}
        {option("remote", `Como en ${peerName}`, c.remote)}
      </div>
      <div className="flex flex-wrap gap-2">
        {c.canCombine && (
          <Button
            size="sm"
            variant={combining ? "secondary" : "ghost"}
            onClick={() => onChange({ choice: "combine", fields: Object.fromEntries(c.fields.map((f) => [f.field, "local"])) })}
          >
            <Merge size={14} /> Combinar campo a campo
          </Button>
        )}
        {c.collection === "taskTags" && (
          <Button size="sm" variant={value?.choice === "union" ? "secondary" : "ghost"} onClick={() => onChange({ choice: "union" })}>
            <Merge size={14} /> Unir etiquetas de ambos
          </Button>
        )}
      </div>
      {combining && (
        <ul className="space-y-1.5">
          {c.fields.map((f) => (
            <li key={f.field} className="text-xs">
              <div className="text-subtle mb-0.5">{FIELD_LABEL[f.field] ?? f.field}</div>
              <div className="grid grid-cols-2 gap-1">
                {(["local", "remote"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    aria-pressed={fields[f.field] === side}
                    onClick={() => onChange({ choice: "combine", fields: { ...fields, [f.field]: side } })}
                    className={cn("p-2 rounded-md border text-left truncate min-h-[40px]", fields[f.field] === side ? "border-primary bg-primary/10" : "border-border")}
                  >
                    {show(f.field, side === "local" ? f.local : f.remote)}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
