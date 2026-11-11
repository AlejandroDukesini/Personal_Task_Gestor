import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { SidePanel } from "@/components/ui/SidePanel";
import { ColorPicker } from "@/components/notes/pickers";
import { api } from "@/services/api";
import { newId, type PersonalGoalRow, type PersonalGoalStatus, type WfPriority } from "@/services/localDb";
import { DEFAULT_GOAL_COLOR } from "@/services/personalGoals/routes";
import { STATUS_LABEL } from "@/services/personalGoals/logic";
import { GOAL_STATUSES } from "@/services/personalGoals/schemas";
import { PRIORITY_LABEL } from "@/services/workflow/logic";
import { WF_PRIORITIES } from "@/services/workflow/schemas";
import { runAction } from "@/lib/runAction";

interface Props {
  open: boolean;
  onClose: () => void;
  goal?: PersonalGoalRow | null;
  categories: string[];
  onSaved: (g: PersonalGoalRow) => void;
  /** Fecha objetivo sugerida al crear (por ejemplo, desde un año de la línea). */
  defaultTarget?: string;
}

const formOf = (g?: PersonalGoalRow | null, target = "") => ({
  title: g?.title ?? "",
  description: g?.description ?? "",
  category: g?.category ?? "",
  color: g?.color ?? (DEFAULT_GOAL_COLOR as string),
  priority: (g?.priority ?? "medium") as WfPriority,
  status: (g?.status ?? "planned") as PersonalGoalStatus,
  progress: g?.progress ?? 0,
  startDate: g?.startDate ?? "",
  targetDate: g?.targetDate ?? target,
  observations: g?.observations ?? "",
});

/** Crear o editar una meta personal. Nada se guarda hasta pulsar «Guardar». */
export function GoalForm({ open, onClose, goal, categories, onSaved, defaultTarget }: Props) {
  const [f, setF] = useState(() => formOf(goal, defaultTarget));
  const [busy, setBusy] = useState(false);
  const idRef = useRef(newId());
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    idRef.current = newId();
    setF(formOf(goal, defaultTarget));
  }, [open, goal, defaultTarget]);

  const dateError = f.startDate && f.targetDate && f.targetDate < f.startDate ? "La fecha objetivo no puede ser anterior a la de inicio" : null;
  const valid = !!f.title.trim() && !!f.targetDate && !dateError;

  async function save() {
    if (!valid) return;
    setBusy(true);
    const body = {
      title: f.title.trim(),
      description: f.description.trim() || null,
      category: f.category.trim() || null,
      color: f.color,
      priority: f.priority,
      status: f.status,
      progress: f.status === "completed" ? 100 : f.progress,
      startDate: f.startDate || null,
      targetDate: f.targetDate,
      observations: f.observations.trim() || null,
    };
    let saved: PersonalGoalRow | null = null;
    const ok = await runAction(
      async () => {
        saved = goal ? await api.put<PersonalGoalRow>(`/personal-goals/${goal.id}`, body) : await api.post<PersonalGoalRow>("/personal-goals", { ...body, id: idRef.current });
      },
      goal ? "Meta actualizada" : "Meta creada",
      () => undefined
    );
    setBusy(false);
    if (ok && saved) {
      onSaved(saved);
      onClose();
    }
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      width="lg"
      title={goal ? "Editar meta" : "Nueva meta personal"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} disabled={!valid} onClick={save}>{goal ? "Guardar" : "Crear meta"}</Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Nombre de la meta">
          <Input autoFocus required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ej.: Comprar una motocicleta" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha de inicio" hint="Opcional.">
            <Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </Field>
          <Field label="Fecha objetivo" error={dateError}>
            <Input type="date" required value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Descripción">
          <Textarea maxLength={20000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Categoría">
            <Input list={listId} maxLength={60} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Salud, Viajes…" />
          </Field>
          <datalist id={listId}>{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <Field label="Prioridad">
            <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as WfPriority })}>
              {WF_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </Select>
          </Field>
          <Field label="Estado">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as PersonalGoalStatus })}>
              {GOAL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
        </div>
        <Field label={`Avance: ${f.status === "completed" ? 100 : f.progress} %`}>
          <input type="range" min={0} max={100} step={5} disabled={f.status === "completed"} value={f.status === "completed" ? 100 : f.progress} onChange={(e) => setF({ ...f, progress: Number(e.target.value) })} className="w-full accent-primary" />
        </Field>
        <Field label="Observaciones">
          <Textarea maxLength={5000} value={f.observations} onChange={(e) => setF({ ...f, observations: e.target.value })} />
        </Field>
        <ColorPicker value={f.color} label="Color identificador" onChange={(c) => setF({ ...f, color: c ?? DEFAULT_GOAL_COLOR })} />
        <button type="submit" hidden />
      </form>
    </SidePanel>
  );
}
