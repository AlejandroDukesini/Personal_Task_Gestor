import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { SidePanel } from "@/components/ui/SidePanel";
import { ColorPicker } from "@/components/notes/pickers";
import type { WfActivity, WfActivityStatus, WfPriority, WfProcedure, WfStage, WfStageStatus } from "@/services/localDb";
import { ACTIVITY_STATUS_LABEL, allActivities, blockersOf, createsCycle, PRIORITY_LABEL, STAGE_STATUS_LABEL } from "@/services/workflow/logic";
import { WF_ACTIVITY_STATUSES, WF_PRIORITIES, WF_STAGE_STATUSES } from "@/services/workflow/schemas";
import { Checklist, type OpRunner } from "./shared";

const PANEL_FOOTER = (busy: boolean, valid: boolean, onCancel: () => void, onSave: () => void, onDelete?: () => void, saveLabel = "Guardar") => (
  <>
    {onDelete && (
      <Button variant="ghost" className="mr-auto text-danger" onClick={onDelete}>
        <Trash2 size={14} /> Eliminar
      </Button>
    )}
    <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
    <Button loading={busy} disabled={!valid} onClick={onSave}>{saveLabel}</Button>
  </>
);

/* ------------------------------------------------------------------ etapa */

export function StageEditor({ stage, open, onClose, run, onDelete }: { stage: WfStage | null; open: boolean; onClose: () => void; run: OpRunner; onDelete: () => void }) {
  const [f, setF] = useState({ title: "", subtitle: "", description: "", objective: "", color: null as string | null, startDate: "", endDate: "", priority: "" as WfPriority | "", status: "" as WfStageStatus | "", progress: 0, documentation: "", observations: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !stage) return;
    setF({
      title: stage.title,
      subtitle: stage.subtitle ?? "",
      description: stage.description ?? "",
      objective: stage.objective ?? "",
      color: stage.color,
      startDate: stage.startDate ?? "",
      endDate: stage.endDate ?? "",
      priority: stage.priority ?? "",
      status: stage.status ?? "",
      progress: stage.progress,
      documentation: stage.documentation ?? "",
      observations: stage.observations ?? "",
    });
    // Solo al abrir: lo que se escribe no se pisa si la etapa cambia por debajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stage?.id]);

  if (!stage) return null;
  const auto = stage.activities.length > 0;
  const dateError = f.startDate && f.endDate && f.endDate < f.startDate ? "La fecha final no puede ser anterior a la de inicio" : null;
  const valid = !!f.title.trim() && !dateError;

  async function save() {
    if (!valid || !stage) return;
    setBusy(true);
    const data = {
      title: f.title.trim(),
      subtitle: f.subtitle.trim() || null,
      description: f.description.trim() || null,
      objective: f.objective.trim() || null,
      color: f.color,
      startDate: f.startDate || null,
      endDate: f.endDate || null,
      priority: f.priority || null,
      status: f.status || null,
      documentation: f.documentation.trim() || null,
      observations: f.observations.trim() || null,
      ...(auto || f.progress === stage.progress ? {} : { progress: f.progress }),
    };
    const r = await run({ op: "stage.update", stageId: stage.id, data });
    setBusy(false);
    if (r.ok) onClose();
  }

  return (
    <SidePanel open={open} onClose={onClose} width="lg" title="Editar etapa" footer={PANEL_FOOTER(busy, valid, onClose, save, onDelete)}>
      <div className="space-y-3">
        <Field label="Título">
          <Input autoFocus maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Subtítulo" hint="Opcional.">
          <Input maxLength={200} value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} />
        </Field>
        <Field label="Objetivo de la etapa">
          <Textarea maxLength={5000} value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} />
        </Field>
        <Field label="Descripción" hint="Admite Markdown básico: **negrita**, listas y enlaces.">
          <Textarea maxLength={20000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Inicio">
            <Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </Field>
          <Field label="Fin" error={dateError}>
            <Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prioridad">
            <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as WfPriority | "" })}>
              <option value="">Sin prioridad</option>
              {WF_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </Select>
          </Field>
          <Field label="Estado">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as WfStageStatus | "" })}>
              <option value="">Automático (según avance)</option>
              {WF_STAGE_STATUSES.map((s) => <option key={s} value={s}>{STAGE_STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
        </div>
        <Field label={`Avance: ${auto ? stage.progress : f.progress} %`} hint={auto ? "Se calcula a partir de sus actividades." : undefined}>
          <input type="range" min={0} max={100} step={5} disabled={auto} value={auto ? stage.progress : f.progress} onChange={(e) => setF({ ...f, progress: Number(e.target.value) })} className="w-full accent-primary" />
        </Field>
        <Field label="Documentación" hint="Entregables, enlaces y referencias (Markdown).">
          <Textarea maxLength={50000} className="min-h-[110px]" value={f.documentation} onChange={(e) => setF({ ...f, documentation: e.target.value })} />
        </Field>
        <Field label="Observaciones">
          <Textarea maxLength={5000} value={f.observations} onChange={(e) => setF({ ...f, observations: e.target.value })} />
        </Field>
        <ColorPicker value={f.color} allowDefault label="Color de la etapa" onChange={(c) => setF({ ...f, color: c })} />
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------- procedimiento */

export function ProcedureEditor({ stageId, procedure, open, onClose, run, readOnly }: { stageId: string; procedure: WfProcedure | null; open: boolean; onClose: () => void; run: OpRunner; readOnly?: boolean }) {
  const [f, setF] = useState({ title: "", instructions: "", observations: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !procedure) return;
    setF({ title: procedure.title, instructions: procedure.instructions ?? "", observations: procedure.observations ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, procedure?.id]);
  if (!procedure) return null;

  async function save() {
    if (!procedure || !f.title.trim()) return;
    setBusy(true);
    const r = await run({ op: "procedure.update", stageId, procedureId: procedure.id, data: { title: f.title.trim(), instructions: f.instructions.trim() || null, observations: f.observations.trim() || null } });
    setBusy(false);
    if (r.ok) onClose();
  }

  async function remove() {
    if (!procedure || !confirm(`¿Eliminar el procedimiento «${procedure.title}» con su lista de verificación?`)) return;
    if ((await run({ op: "procedure.delete", stageId, procedureId: procedure.id })).ok) onClose();
  }

  return (
    <SidePanel open={open} onClose={onClose} width="lg" title={readOnly ? procedure.title : "Editar procedimiento"} footer={readOnly ? undefined : PANEL_FOOTER(busy, !!f.title.trim(), onClose, save, remove)}>
      <div className="space-y-4">
        {!readOnly && (
          <>
            <Field label="Título">
              <Input autoFocus maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </Field>
            <Field label="Instrucciones" hint="Paso a paso. Admite Markdown básico.">
              <Textarea maxLength={20000} className="min-h-[140px]" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />
            </Field>
            <Field label="Observaciones">
              <Textarea maxLength={5000} value={f.observations} onChange={(e) => setF({ ...f, observations: e.target.value })} />
            </Field>
          </>
        )}
        <Checklist items={procedure.checklist} owner={{ stageId, procedureId: procedure.id }} run={run} readOnly={readOnly} />
      </div>
    </SidePanel>
  );
}

/* --------------------------------------------------------------- actividad */

export function ActivityEditor({ stages, stageId, activity, open, onClose, run }: { stages: WfStage[]; stageId: string; activity: WfActivity | null; open: boolean; onClose: () => void; run: OpRunner }) {
  const [f, setF] = useState({ title: "", description: "", dueDate: "", priority: "medium" as WfPriority, status: "pending" as WfActivityStatus, measured: false, progress: 0, observations: "", dependsOn: [] as string[], stageId });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !activity) return;
    setF({
      title: activity.title,
      description: activity.description ?? "",
      dueDate: activity.dueDate ?? "",
      priority: activity.priority,
      status: activity.status,
      measured: activity.progress !== null,
      progress: activity.progress ?? 0,
      observations: activity.observations ?? "",
      dependsOn: activity.dependsOn,
      stageId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activity?.id]);
  if (!activity) return null;

  const all = allActivities(stages);
  const candidates = all.filter((a) => a.id !== activity.id && !createsCycle(activity.id, [...f.dependsOn, a.id].filter((x, i, arr) => arr.indexOf(x) === i), all.map((x) => (x.id === activity.id ? { ...x, dependsOn: f.dependsOn } : x))));
  const stageOf = new Map(stages.flatMap((s) => s.activities.map((a) => [a.id, s.title] as const)));
  const blockers = blockersOf({ dependsOn: f.dependsOn }, all);

  async function save() {
    if (!activity || !f.title.trim()) return;
    setBusy(true);
    const r = await run({
      op: "activity.update",
      stageId,
      activityId: activity.id,
      data: {
        title: f.title.trim(),
        description: f.description.trim() || null,
        dueDate: f.dueDate || null,
        priority: f.priority,
        status: f.status,
        progress: f.measured ? (f.status === "done" ? 100 : f.progress) : null,
        observations: f.observations.trim() || null,
        dependsOn: f.dependsOn,
      },
    });
    if (r.ok && f.stageId !== stageId) await run({ op: "activity.move", stageId, activityId: activity.id, toStageId: f.stageId });
    setBusy(false);
    if (r.ok) onClose();
  }

  async function remove() {
    if (!activity || !confirm(`¿Eliminar la actividad «${activity.title}»?`)) return;
    if ((await run({ op: "activity.delete", stageId, activityId: activity.id })).ok) onClose();
  }

  return (
    <SidePanel open={open} onClose={onClose} width="lg" title="Editar actividad" footer={PANEL_FOOTER(busy, !!f.title.trim(), onClose, save, remove)}>
      <div className="space-y-3">
        <Field label="Título">
          <Input autoFocus maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Descripción">
          <Textarea maxLength={20000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Fecha límite">
            <Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
          </Field>
          <Field label="Prioridad">
            <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as WfPriority })}>
              {WF_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </Select>
          </Field>
          <Field label="Estado">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as WfActivityStatus })}>
              {WF_ACTIVITY_STATUSES.map((s) => <option key={s} value={s}>{ACTIVITY_STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-primary h-4 w-4" checked={f.measured} onChange={(e) => setF({ ...f, measured: e.target.checked })} />
          Medir avance en porcentaje
        </label>
        {f.measured && (
          <Field label={`Avance: ${f.status === "done" ? 100 : f.progress} %`}>
            <input type="range" min={0} max={100} step={5} disabled={f.status === "done"} value={f.status === "done" ? 100 : f.progress} onChange={(e) => setF({ ...f, progress: Number(e.target.value) })} className="w-full accent-primary" />
          </Field>
        )}
        <Field label="Etapa">
          <Select value={f.stageId} onChange={(e) => setF({ ...f, stageId: e.target.value })}>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </Select>
        </Field>
        <fieldset>
          <legend className="text-xs font-medium text-subtle uppercase tracking-wide mb-1.5">Depende de (opcional)</legend>
          {candidates.length === 0 && f.dependsOn.length === 0 ? (
            <p className="text-sm text-subtle">No hay otras actividades disponibles.</p>
          ) : (
            <ul className="max-h-44 overflow-y-auto space-y-0.5 gt-field p-2">
              {all
                .filter((a) => a.id !== activity.id && (f.dependsOn.includes(a.id) || candidates.includes(a)))
                .map((a) => (
                  <li key={a.id}>
                    <label className="flex items-center gap-2 text-sm py-0.5">
                      <input type="checkbox" className="accent-primary h-4 w-4" checked={f.dependsOn.includes(a.id)} onChange={(e) => setF({ ...f, dependsOn: e.target.checked ? [...f.dependsOn, a.id] : f.dependsOn.filter((d) => d !== a.id) })} />
                      <span className="truncate">{a.title}</span>
                      <span className="text-xs text-subtle truncate">· {stageOf.get(a.id)}</span>
                    </label>
                  </li>
                ))}
            </ul>
          )}
          {blockers.length > 0 && f.status !== "done" && <p className="text-xs text-warning mt-1">Espera a: {blockers.map((b) => b.title).join(", ")}.</p>}
        </fieldset>
        <Field label="Observaciones">
          <Textarea maxLength={5000} value={f.observations} onChange={(e) => setF({ ...f, observations: e.target.value })} />
        </Field>
        <Checklist items={activity.checklist} owner={{ stageId, activityId: activity.id }} run={run} />
      </div>
    </SidePanel>
  );
}
