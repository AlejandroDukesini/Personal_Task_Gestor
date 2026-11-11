import { useMemo, useState } from "react";
import { BookOpenText, CheckCircle2, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Circle, ClipboardList, Copy, Layers, Link2, ListTodo, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Markdown } from "@/components/Markdown";
import { ActionMenu, formatDay, MenuItem, ProgressBar } from "@/components/projects/shared";
import type { WfStage } from "@/services/localDb";
import { allActivities, blockersOf, stageStatusOf } from "@/services/workflow/logic";
import { cn } from "@/lib/utils";
import { ActivityEditor, ProcedureEditor, StageEditor } from "./Editors";
import { ActivityStatusBadge, Checklist, moved, MoveButtons, PriorityLabel, StageStatusBadge, type OpRunner } from "./shared";

interface Props {
  stages: WfStage[];
  run: OpRunner;
  /** Color del contenedor (SOP o proyecto). */
  accent: string;
  readOnly?: boolean;
  /** Fecha de hoy (`YYYY-MM-DD`) para marcar actividades vencidas. */
  today?: string;
  emptyHint?: string;
}

type Editing = { kind: "stage"; stageId: string } | { kind: "procedure"; stageId: string; id: string } | { kind: "activity"; stageId: string; id: string } | null;

/**
 * Estructura de trabajo: etapas que se expanden y contraen, cada una con su
 * objetivo, procedimientos, actividades, lista de verificación y
 * documentación. Todo se crea, edita, reordena y elimina aquí; cada cambio se
 * guarda al momento como una operación validada.
 */
export function StructureEditor({ stages, run, accent, readOnly = false, today, emptyHint }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(stages.length <= 3 ? stages.map((s) => s.id) : []));
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const all = useMemo(() => allActivities(stages), [stages]);

  const toggle = (id: string) => setOpen((o) => {
    const n = new Set(o);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  async function addStage(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    const r = await run({ op: "stage.add", data: { title: draft.trim() } });
    if (r.ok) {
      setDraft("");
      if (r.createdId) setOpen((o) => new Set(o).add(r.createdId!));
    }
  }

  async function removeStage(s: WfStage) {
    const n = s.activities.length + s.procedures.length;
    if (!confirm(`¿Eliminar la etapa «${s.title}»${n ? ` con sus ${s.procedures.length} procedimientos y ${s.activities.length} actividades` : ""}?`)) return false;
    return (await run({ op: "stage.delete", stageId: s.id })).ok;
  }

  const stage = editing ? stages.find((s) => s.id === editing.stageId) ?? null : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-subtle tabular-nums">
          {stages.length} etapas · {all.filter((a) => a.status === "done").length}/{all.length} actividades completadas
        </p>
        {stages.length > 1 && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setOpen(new Set(stages.map((s) => s.id)))}>
              <ChevronsUpDown size={14} /> Expandir todo
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(new Set())}>
              <ChevronsDownUp size={14} /> Contraer todo
            </Button>
          </div>
        )}
      </div>

      {stages.length === 0 && (
        <div className="gt-surface p-6 text-center text-sm text-subtle flex flex-col items-center gap-2">
          <Layers size={22} aria-hidden />
          <p>{emptyHint ?? "Aún no hay etapas. Crea la primera para empezar a estructurar el trabajo."}</p>
        </div>
      )}

      <ol className="space-y-2">
        {stages.map((s, idx) => {
          const expanded = open.has(s.id);
          const status = stageStatusOf(s);
          const color = s.color ?? accent;
          const done = s.activities.filter((a) => a.status === "done").length;
          return (
            <li key={s.id} className="gt-surface overflow-hidden border-l-4" style={{ borderLeftColor: color }}>
              <div className="flex items-center gap-2 p-3">
                <button className="flex items-center gap-2 flex-1 min-w-0 text-left" onClick={() => toggle(s.id)} aria-expanded={expanded} aria-controls={`stage-${s.id}`}>
                  {expanded ? <ChevronDown size={16} className="shrink-0 text-subtle" /> : <ChevronRight size={16} className="shrink-0 text-subtle" />}
                  <span className="h-6 w-6 rounded-full text-xs font-semibold flex items-center justify-center shrink-0" style={{ background: `${color}22`, color }}>
                    {idx + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium block truncate">{s.title}</span>
                    {s.subtitle && <span className="text-xs text-subtle block truncate">{s.subtitle}</span>}
                  </span>
                </button>
                <span className="hidden sm:flex items-center gap-3 shrink-0">
                  {s.priority && <PriorityLabel priority={s.priority} />}
                  {s.activities.length > 0 && <span className="text-xs text-subtle tabular-nums">{done}/{s.activities.length}</span>}
                  <span className="w-20"><ProgressBar value={s.progress} color={color} label={`Avance de ${s.title}`} className="h-1.5" /></span>
                  <StageStatusBadge status={status} />
                </span>
                {!readOnly && (
                  <>
                    <MoveButtons index={idx} total={stages.length} label={s.title} onMove={(to) => run({ op: "stage.reorder", ids: moved(stages.map((x) => x.id), idx, to) })} />
                    <ActionMenu label={`Acciones de la etapa ${s.title}`}>
                      <MenuItem icon={<Pencil size={14} />} onClick={() => setEditing({ kind: "stage", stageId: s.id })}>Editar etapa</MenuItem>
                      <MenuItem icon={<Copy size={14} />} onClick={() => run({ op: "stage.duplicate", stageId: s.id })}>Duplicar</MenuItem>
                      <MenuItem icon={<Trash2 size={14} />} danger onClick={() => removeStage(s)}>Eliminar</MenuItem>
                    </ActionMenu>
                  </>
                )}
              </div>
              <div className="sm:hidden flex items-center gap-2 px-3 pb-2 -mt-1">
                <StageStatusBadge status={status} />
                <ProgressBar value={s.progress} color={color} label={`Avance de ${s.title}`} className="h-1.5 flex-1" />
                <span className="text-xs tabular-nums text-subtle">{s.progress} %</span>
              </div>

              {expanded && (
                <div id={`stage-${s.id}`} className="border-t border-border p-3 sm:p-4 space-y-5">
                  {(s.objective || s.description || s.startDate || s.endDate) && (
                    <div className="space-y-2 text-sm">
                      {s.objective && (
                        <p>
                          <span className="text-xs font-medium text-subtle uppercase tracking-wide block">Objetivo</span>
                          {s.objective}
                        </p>
                      )}
                      {s.description && <Markdown>{s.description}</Markdown>}
                      {(s.startDate || s.endDate) && (
                        <p className="text-xs text-subtle">
                          {formatDay(s.startDate)} → {formatDay(s.endDate)}
                        </p>
                      )}
                    </div>
                  )}

                  <Section icon={ClipboardList} title="Procedimientos" count={s.procedures.length}>
                    <ul className="space-y-1">
                      {s.procedures.map((p, i) => (
                        <li key={p.id} className="flex items-center gap-2 rounded-md hover:bg-muted/50 px-1">
                          <button className="flex-1 min-w-0 text-left py-1.5" onClick={() => setEditing({ kind: "procedure", stageId: s.id, id: p.id })}>
                            <span className="text-sm block truncate">{p.title}</span>
                            {p.checklist.length > 0 && <span className="text-xs text-subtle tabular-nums">{p.checklist.filter((c) => c.done).length}/{p.checklist.length} verificados</span>}
                          </button>
                          {!readOnly && <MoveButtons index={i} total={s.procedures.length} label={p.title} onMove={(to) => run({ op: "procedure.reorder", stageId: s.id, ids: moved(s.procedures.map((x) => x.id), i, to) })} />}
                        </li>
                      ))}
                    </ul>
                    {!readOnly && <QuickAdd placeholder="Nuevo procedimiento…" onAdd={async (title) => { const r = await run({ op: "procedure.add", stageId: s.id, data: { title } }); if (r.ok && r.createdId) setEditing({ kind: "procedure", stageId: s.id, id: r.createdId }); return r.ok; }} />}
                  </Section>

                  <Section icon={ListTodo} title="Actividades" count={s.activities.length}>
                    <ul className="space-y-0.5">
                      {s.activities.map((a, i) => {
                        const blockers = blockersOf(a, all);
                        const overdue = today && a.dueDate && a.dueDate < today && a.status !== "done";
                        return (
                          <li key={a.id} className="flex items-center gap-2 rounded-md hover:bg-muted/50 px-1">
                            <button
                              className={cn("h-8 w-8 shrink-0 flex items-center justify-center rounded-md hover:bg-muted", a.status === "done" ? "text-success" : "text-subtle")}
                              disabled={readOnly}
                              onClick={() => run({ op: "activity.update", stageId: s.id, activityId: a.id, data: { status: a.status === "done" ? "pending" : "done" } })}
                              aria-label={a.status === "done" ? `Reabrir ${a.title}` : `Completar ${a.title}`}
                            >
                              {a.status === "done" ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                            </button>
                            <button className="flex-1 min-w-0 text-left py-1.5" onClick={() => !readOnly && setEditing({ kind: "activity", stageId: s.id, id: a.id })}>
                              <span className={cn("text-sm block truncate", a.status === "done" && "line-through text-subtle")}>{a.title}</span>
                              <span className="text-xs text-subtle flex flex-wrap items-center gap-x-2">
                                {a.dueDate && <span className={cn(overdue && "text-danger font-medium")}>{formatDay(a.dueDate)}</span>}
                                {a.progress !== null && a.status !== "done" && <span className="tabular-nums">{a.progress} %</span>}
                                {a.checklist.length > 0 && <span className="tabular-nums">{a.checklist.filter((c) => c.done).length}/{a.checklist.length} ✓</span>}
                                {blockers.length > 0 && a.status !== "done" && (
                                  <span className="text-warning inline-flex items-center gap-0.5">
                                    <Link2 size={11} aria-hidden /> Espera a {blockers.map((b) => b.title).join(", ")}
                                  </span>
                                )}
                              </span>
                            </button>
                            <span className="hidden sm:inline-flex items-center gap-2">
                              <PriorityLabel priority={a.priority} />
                              {a.status !== "pending" && a.status !== "done" && <ActivityStatusBadge status={a.status} />}
                            </span>
                            {!readOnly && <MoveButtons index={i} total={s.activities.length} label={a.title} onMove={(to) => run({ op: "activity.reorder", stageId: s.id, ids: moved(s.activities.map((x) => x.id), i, to) })} />}
                          </li>
                        );
                      })}
                    </ul>
                    {!readOnly && <QuickAdd placeholder="Nueva actividad…" onAdd={async (title) => (await run({ op: "activity.add", stageId: s.id, data: { title } })).ok} />}
                  </Section>

                  <Checklist items={s.checklist} owner={{ stageId: s.id }} run={run} readOnly={readOnly} />

                  <Section icon={BookOpenText} title="Documentación">
                    {s.documentation ? <Markdown>{s.documentation}</Markdown> : <p className="text-sm text-subtle">Sin documentación.{!readOnly && " Añádela desde «Editar etapa»."}</p>}
                  </Section>

                  {s.observations && (
                    <div className="text-sm">
                      <span className="text-xs font-medium text-subtle uppercase tracking-wide block">Observaciones</span>
                      <p className="whitespace-pre-line">{s.observations}</p>
                    </div>
                  )}

                  {!readOnly && (
                    <Button size="sm" variant="outline" onClick={() => setEditing({ kind: "stage", stageId: s.id })}>
                      <Pencil size={14} /> Editar etapa
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {!readOnly && (
        <form onSubmit={addStage} className="flex gap-2">
          <Input aria-label="Título de la nueva etapa" placeholder="Nueva etapa…" maxLength={200} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button type="submit" disabled={!draft.trim()}>
            <Plus size={16} /> Añadir etapa
          </Button>
        </form>
      )}

      <StageEditor
        stage={editing?.kind === "stage" ? stage : null}
        open={editing?.kind === "stage"}
        onClose={() => setEditing(null)}
        run={run}
        onDelete={async () => {
          if (stage && (await removeStage(stage))) setEditing(null);
        }}
      />
      <ProcedureEditor stageId={editing?.stageId ?? ""} procedure={editing?.kind === "procedure" ? stage?.procedures.find((p) => p.id === editing.id) ?? null : null} open={editing?.kind === "procedure"} onClose={() => setEditing(null)} run={run} readOnly={readOnly} />
      <ActivityEditor stages={stages} stageId={editing?.stageId ?? ""} activity={editing?.kind === "activity" ? stage?.activities.find((a) => a.id === editing.id) ?? null : null} open={editing?.kind === "activity"} onClose={() => setEditing(null)} run={run} />
    </div>
  );
}

function Section({ icon: Icon, title, count, children }: { icon: typeof ListTodo; title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-medium text-subtle uppercase tracking-wide flex items-center gap-1.5">
        <Icon size={13} aria-hidden /> {title}
        {count !== undefined && count > 0 && <span className="tabular-nums normal-case">({count})</span>}
      </h3>
      {children}
    </section>
  );
}

function QuickAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => Promise<boolean> }) {
  const [v, setV] = useState("");
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (v.trim() && (await onAdd(v.trim()))) setV("");
      }}
    >
      <Plus size={14} className="text-subtle shrink-0 ml-1" aria-hidden />
      <input aria-label={placeholder.replace("…", "")} className="flex-1 bg-transparent text-sm outline-none border-b border-transparent focus:border-border py-1" placeholder={placeholder} value={v} maxLength={200} onChange={(e) => setV(e.target.value)} />
    </form>
  );
}
