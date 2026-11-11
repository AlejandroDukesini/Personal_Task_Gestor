import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Ban, CheckCircle2, Circle, CircleDot, PauseCircle, Pencil, Plus, Trash2 } from "lucide-react";
import type { WfActivityStatus, WfCheckItem, WfPriority, WfStageStatus } from "@/services/localDb";
import { ACTIVITY_STATUS_LABEL, PRIORITY_LABEL, STAGE_STATUS_LABEL } from "@/services/workflow/logic";
import type { StructureOp } from "@/services/workflow/schemas";
import { cn } from "@/lib/utils";

/** Envía una operación de estructura; devuelve si se aplicó y el id creado (si lo hay). */
export type OpRunner = (op: StructureOp) => Promise<{ ok: boolean; createdId?: string | null }>;

const STAGE_STYLE: Record<WfStageStatus, { cls: string; icon: typeof Circle }> = {
  pending: { cls: "text-subtle bg-muted", icon: Circle },
  in_progress: { cls: "text-primary bg-primary/10", icon: CircleDot },
  on_hold: { cls: "text-warning bg-warning/10", icon: PauseCircle },
  done: { cls: "text-success bg-success/10", icon: CheckCircle2 },
};

export function StageStatusBadge({ status }: { status: WfStageStatus }) {
  const s = STAGE_STYLE[status];
  return (
    <span className={cn("gt-pill inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium whitespace-nowrap", s.cls)}>
      <s.icon size={12} aria-hidden /> {STAGE_STATUS_LABEL[status]}
    </span>
  );
}

const ACT_STYLE: Record<WfActivityStatus, { cls: string; icon: typeof Circle }> = {
  pending: { cls: "text-subtle bg-muted", icon: Circle },
  in_progress: { cls: "text-primary bg-primary/10", icon: CircleDot },
  blocked: { cls: "text-danger bg-danger/10", icon: Ban },
  done: { cls: "text-success bg-success/10", icon: CheckCircle2 },
};

export function ActivityStatusBadge({ status }: { status: WfActivityStatus }) {
  const s = ACT_STYLE[status];
  return (
    <span className={cn("gt-pill inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium whitespace-nowrap", s.cls)}>
      <s.icon size={12} aria-hidden /> {ACTIVITY_STATUS_LABEL[status]}
    </span>
  );
}

const PRIORITY_CLS: Record<WfPriority, string> = { low: "text-subtle", medium: "text-text", high: "text-warning", critical: "text-danger" };

export function PriorityLabel({ priority, className }: { priority: WfPriority; className?: string }) {
  return (
    <span className={cn("text-xs font-medium inline-flex items-center gap-1", PRIORITY_CLS[priority], className)}>
      {priority === "critical" && <AlertTriangle size={11} aria-hidden />}
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

/** Botones subir/bajar (accesibles con teclado; alternativa al arrastre). */
export function MoveButtons({ index, total, onMove, label }: { index: number; total: number; onMove: (to: number) => void; label: string }) {
  return (
    <span className="inline-flex">
      <button type="button" className="h-8 w-7 inline-flex items-center justify-center rounded text-subtle hover:bg-muted disabled:opacity-30" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Subir ${label}`}>
        <ArrowUp size={14} />
      </button>
      <button type="button" className="h-8 w-7 inline-flex items-center justify-center rounded text-subtle hover:bg-muted disabled:opacity-30" disabled={index === total - 1} onClick={() => onMove(index + 1)} aria-label={`Bajar ${label}`}>
        <ArrowDown size={14} />
      </button>
    </span>
  );
}

/** Ids con un elemento movido de posición. */
export function moved(ids: string[], from: number, to: number): string[] {
  const next = [...ids];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/**
 * Lista de verificación editable en el sitio: marcar, renombrar, quitar,
 * reordenar y añadir. Cada cambio se guarda al momento.
 */
export function Checklist({ items, owner, run, readOnly, label = "Lista de verificación" }: { items: WfCheckItem[]; owner: { stageId: string; procedureId?: string; activityId?: string }; run: OpRunner; readOnly?: boolean; label?: string }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const done = items.filter((i) => i.done).length;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    if ((await run({ op: "check.add", owner, text: draft.trim() })).ok) setDraft("");
  }

  async function rename() {
    if (!editing) return;
    const item = items.find((i) => i.id === editing.id);
    if (editing.text.trim() && item && editing.text.trim() !== item.text) await run({ op: "check.update", owner, itemId: editing.id, text: editing.text.trim() });
    setEditing(null);
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-subtle uppercase tracking-wide flex items-center gap-2">
        {label}
        {items.length > 0 && <span className="tabular-nums normal-case">{done}/{items.length}</span>}
      </p>
      {items.length === 0 && readOnly && <p className="text-sm text-subtle">Sin elementos.</p>}
      <ul className="space-y-0.5">
        {items.map((i, idx) => (
          <li key={i.id} className="group flex items-center gap-2 rounded-md hover:bg-muted/50 px-1">
            <input type="checkbox" className="accent-primary h-4 w-4 shrink-0" checked={i.done} disabled={readOnly} aria-label={`Marcar «${i.text}»`} onChange={(e) => run({ op: "check.update", owner, itemId: i.id, done: e.target.checked })} />
            {editing?.id === i.id ? (
              <input
                autoFocus
                aria-label="Texto del elemento"
                className="flex-1 bg-transparent text-sm outline-none border-b border-border py-1"
                value={editing.text}
                maxLength={300}
                onChange={(e) => setEditing({ id: i.id, text: e.target.value })}
                onBlur={rename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") rename();
                  if (e.key === "Escape") setEditing(null);
                }}
              />
            ) : (
              <span className={cn("flex-1 text-sm py-1 break-words", i.done && "line-through text-subtle")}>{i.text}</span>
            )}
            {!readOnly && editing?.id !== i.id && (
              <span className="flex opacity-60 group-hover:opacity-100 focus-within:opacity-100">
                <MoveButtons index={idx} total={items.length} label={i.text} onMove={(to) => run({ op: "check.reorder", owner, ids: moved(items.map((x) => x.id), idx, to) })} />
                <button type="button" className="h-8 w-7 inline-flex items-center justify-center rounded text-subtle hover:bg-muted" aria-label={`Editar «${i.text}»`} onClick={() => setEditing({ id: i.id, text: i.text })}>
                  <Pencil size={13} />
                </button>
                <button type="button" className="h-8 w-7 inline-flex items-center justify-center rounded text-subtle hover:bg-muted hover:text-danger" aria-label={`Quitar «${i.text}»`} onClick={() => run({ op: "check.delete", owner, itemId: i.id })}>
                  <Trash2 size={13} />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form onSubmit={add} className="flex items-center gap-2">
          <Plus size={14} className="text-subtle shrink-0 ml-1" aria-hidden />
          <input aria-label={`Añadir a ${label.toLowerCase()}`} className="flex-1 bg-transparent text-sm outline-none border-b border-transparent focus:border-border py-1" placeholder="Añadir elemento…" value={draft} maxLength={300} onChange={(e) => setDraft(e.target.value)} />
        </form>
      )}
    </div>
  );
}
