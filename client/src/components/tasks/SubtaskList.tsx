import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { api } from "@/services/api";
import type { Subtask } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Checklist de sub-pasos con barra de progreso.
 *
 * Escribe de forma optimista: marcar un paso repinta al instante y solo
 * después confirma contra el almacenamiento; si falla, se revierte. En local
 * la latencia es mínima, pero por sincronización la escritura puede tardar y
 * la casilla no debe "temblar".
 */
export function SubtaskList({
  taskId,
  initial,
  onChange,
}: {
  taskId: string;
  initial?: Subtask[];
  onChange?: (steps: Subtask[]) => void;
}) {
  const [steps, setSteps] = useState<Subtask[]>(initial ?? []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial) return;
    api.get<Subtask[]>(`/tasks/${taskId}/subtasks`).then(setSteps).catch(() => {});
  }, [taskId, initial]);

  function publish(next: Subtask[]) {
    setSteps(next);
    onChange?.(next);
  }

  const done = steps.filter((s) => s.done).length;
  const percent = steps.length ? Math.round((done / steps.length) * 100) : 0;

  async function toggle(step: Subtask) {
    const next = steps.map((s) => (s.id === step.id ? { ...s, done: !s.done } : s));
    publish(next);
    try {
      await api.patch(`/subtasks/${step.id}`, { done: !step.done });
    } catch {
      publish(steps); // revierte al estado previo
      toast.error("No se pudo actualizar el sub-paso");
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setBusy(true);
    try {
      const created = await api.post<Subtask>(`/tasks/${taskId}/subtasks`, { title });
      publish([...steps, created]);
      setDraft("");
    } catch {
      toast.error("No se pudo añadir el sub-paso");
    } finally {
      setBusy(false);
    }
  }

  async function remove(step: Subtask) {
    const next = steps.filter((s) => s.id !== step.id);
    publish(next);
    try {
      await api.delete(`/subtasks/${step.id}`);
    } catch {
      publish(steps);
      toast.error("No se pudo eliminar el sub-paso");
    }
  }

  async function rename(step: Subtask, title: string) {
    const clean = title.trim();
    if (!clean || clean === step.title) return;
    publish(steps.map((s) => (s.id === step.id ? { ...s, title: clean } : s)));
    try {
      await api.patch(`/subtasks/${step.id}`, { title: clean });
    } catch {
      publish(steps);
    }
  }

  return (
    <div className="space-y-3">
      {steps.length > 0 && (
        <div className="flex items-center gap-3">
          <Progress value={percent} className="flex-1 h-1.5" />
          <span className="gt-mono text-xs text-subtle tabular-nums shrink-0">
            {done}/{steps.length} · {percent}%
          </span>
        </div>
      )}

      <ul className="space-y-1">
        {steps.map((step) => (
          <li
            key={step.id}
            className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/60"
          >
            <GripVertical size={13} className="text-subtle opacity-0 group-hover:opacity-60 shrink-0" />
            <input
              type="checkbox"
              checked={step.done}
              onChange={() => toggle(step)}
              className="accent-primary shrink-0"
              aria-label={step.title}
            />
            <input
              defaultValue={step.title}
              onBlur={(e) => rename(step, e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className={cn(
                "flex-1 bg-transparent text-sm outline-none min-w-0 rounded px-1",
                "focus:bg-surface focus:ring-1 focus:ring-primary/40",
                step.done && "line-through text-subtle"
              )}
            />
            <button
              type="button"
              onClick={() => remove(step)}
              className="text-subtle hover:text-danger p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0"
              aria-label={`Eliminar ${step.title}`}
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>

      {/* Formulario propio: anidar <form> es inválido, así que en TaskForm se
          renderiza fuera del formulario principal. */}
      <form onSubmit={add} className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Añadir sub-paso y pulsar Enter..."
          className="flex-1"
        />
        <Button type="submit" variant="outline" size="md" loading={busy} disabled={!draft.trim()}>
          <Plus size={14} />
        </Button>
      </form>
    </div>
  );
}
