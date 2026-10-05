import { useState } from "react";
import toast from "react-hot-toast";
import { Eye, ListChecks, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Markdown } from "@/components/Markdown";
import { SubtaskList } from "@/components/tasks/SubtaskList";
import { api } from "@/services/api";
import { MESSAGES, taskCompletionError, taskDatesError } from "@/services/rules";
import type { Category, Goal, Subtask, Tag, Task } from "@/types";

const REMINDER_OPTIONS = [
  { value: "", label: "Sin recordatorio" },
  { value: "0", label: "A la hora del vencimiento" },
  { value: "10", label: "10 minutos antes" },
  { value: "30", label: "30 minutos antes" },
  { value: "60", label: "1 hora antes" },
  { value: "1440", label: "1 día antes" },
  { value: "10080", label: "1 semana antes" },
];

function toDateInput(d?: string | null) {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export function TaskForm({
  task,
  categories,
  tags,
  goals = [],
  onSaved,
}: {
  task: Task | null;
  categories: Category[];
  tags: Tag[];
  goals?: Goal[];
  onSaved: () => void;
}) {
  const currentReminder = task?.reminders.find((r) => r.minutesBefore !== null && r.minutesBefore !== undefined);
  const [form, setForm] = useState({
    title: task?.title ?? "",
    description: task?.description ?? "",
    priority: task?.priority ?? "medium",
    status: task?.status ?? "pending",
    progress: task?.progress ?? 0,
    startDate: toDateInput(task?.startDate),
    dueDate: toDateInput(task?.dueDate),
    dueTime: task?.dueTime ?? "",
    notes: task?.notes ?? "",
    categoryId: task?.categoryId ?? "",
    tagIds: task?.tags.map((t) => t.id) ?? [],
    recurrence: task?.recurrence ?? "",
    recurrenceInterval: task?.recurrenceInterval ?? 1,
    goalId: task?.goalId ?? "",
    reminder: currentReminder ? String(currentReminder.minutesBefore) : "",
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<"title" | "dates" | "time" | "reminder" | "status", string>>>({});
  const [preview, setPreview] = useState(false);
  const [steps, setSteps] = useState<Subtask[]>(task?.subtasks ?? []);

  // Con checklist, el progreso lo manda el checklist: se oculta el deslizador
  // para no ofrecer dos controles que se contradicen.
  const hasSteps = steps.length > 0;

  /** Mismas reglas que la API local: se avisa aquí, la API decide. */
  function validate() {
    const next: typeof errors = {};
    if (!form.title.trim()) next.title = "El título es obligatorio.";
    const dates = taskDatesError({ startDate: form.startDate || null, dueDate: form.dueDate || null, dueTime: form.dueTime || null });
    if (dates === MESSAGES.taskTimeWithoutDate) next.time = dates;
    else if (dates) next.dates = dates;
    if (form.reminder && !form.dueDate) next.reminder = MESSAGES.taskReminderWithoutDate;
    if (form.status === "completed" && task?.status !== "completed") {
      const pending = taskCompletionError(steps);
      if (pending) next.status = pending;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) {
      toast.error("Revisa los campos marcados");
      return;
    }
    setSaving(true);
    try {
      const { reminder, ...rest } = form;
      const payload = {
        ...rest,
        title: form.title.trim(),
        dueTime: form.dueTime || null,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        categoryId: form.categoryId || null,
        recurrence: form.recurrence || null,
        recurrenceInterval: Math.max(1, Number(form.recurrenceInterval) || 1),
        goalId: form.goalId || null,
        reminderMinutes: reminder === "" ? null : Number(reminder),
      };
      if (task) {
        await api.put(`/tasks/${task.id}`, payload);
        toast.success("Tarea actualizada");
      } else {
        await api.post(`/tasks`, payload);
        toast.success("Tarea creada");
      }
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  function toggleTag(id: string) {
    setForm((f) => ({
      ...f,
      tagIds: f.tagIds.includes(id) ? f.tagIds.filter((x) => x !== id) : [...f.tagIds, id],
    }));
  }

  return (
    // El checklist tiene su propio <form> para añadir pasos y anidar formularios
    // es HTML inválido: por eso vive fuera del formulario principal.
    <>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Título" error={errors.title}>
          <Input
            autoFocus
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-subtle uppercase tracking-wide">
              Descripción
            </span>
            <button
              type="button"
              onClick={() => setPreview((p) => !p)}
              className="text-xs text-subtle hover:text-text flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"
            >
              {preview ? <Pencil size={12} /> : <Eye size={12} />}
              {preview ? "Editar" : "Vista previa"}
            </button>
          </div>

          {preview ? (
            <div className="gt-field min-h-[80px] px-3 py-2">
              {form.description?.trim() ? (
                <Markdown>{form.description}</Markdown>
              ) : (
                <p className="text-sm text-subtle">Nada que previsualizar.</p>
              )}
            </div>
          ) : (
            <Textarea
              value={form.description ?? ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={"Admite Markdown: **negrita**, `código`, - listas, [enlaces](https://…)"}
            />
          )}
          <p className="text-xs text-subtle">
            Markdown básico: <span className="gt-mono">**negrita**</span>,{" "}
            <span className="gt-mono">*cursiva*</span>, <span className="gt-mono">`código`</span>,{" "}
            <span className="gt-mono">- listas</span>, <span className="gt-mono">```bloques```</span>
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Prioridad">
            <Select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as any })}
            >
              <option value="low">Baja</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
              <option value="critical">Crítica</option>
            </Select>
          </Field>
          <Field label="Estado" error={errors.status}>
            <Select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as any })}
            >
              <option value="pending">Pendiente</option>
              <option value="in_progress">En progreso</option>
              <option value="completed">Completada</option>
              <option value="cancelled">Cancelada</option>
            </Select>
          </Field>
          <Field label="Categoría">
            <Select
              value={form.categoryId ?? ""}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Inicio">
            <Input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </Field>
          <Field label="Vencimiento" error={errors.dates}>
            <Input
              type="date"
              min={form.startDate || undefined}
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </Field>
          <Field label="Hora" error={errors.time}>
            <Input
              type="time"
              value={form.dueTime ?? ""}
              onChange={(e) => setForm({ ...form, dueTime: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Repetir">
            <Select value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value as any })}>
              <option value="">No se repite</option>
              <option value="daily">Diariamente</option>
              <option value="weekdays">Días laborables</option>
              <option value="weekly">Semanalmente</option>
              <option value="monthly">Mensualmente</option>
              <option value="yearly">Anualmente</option>
            </Select>
          </Field>
          <Field label="Cada">
            <Input
              type="number"
              min={1}
              max={365}
              disabled={!form.recurrence}
              value={form.recurrenceInterval}
              onChange={(e) => setForm({ ...form, recurrenceInterval: Number(e.target.value) })}
            />
          </Field>
          <Field label="Recordatorio" error={errors.reminder}>
            <Select value={form.reminder} onChange={(e) => setForm({ ...form, reminder: e.target.value })}>
              {REMINDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {form.recurrence && (
          <p className="text-xs text-subtle -mt-2">
            Al completarla se crea automáticamente la siguiente con su checklist desmarcado.
          </p>
        )}

        {goals.length > 0 && (
          <Field label="Contribuye al objetivo">
            <Select value={form.goalId} onChange={(e) => setForm({ ...form, goalId: e.target.value })}>
              <option value="">Ninguno</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                  {g.source === "tasks" ? " (cuenta tareas)" : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {!hasSteps && (
          <Field label={`Progreso: ${form.progress}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={form.progress}
              onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </Field>
        )}

        {tags.length > 0 && (
          <Field label="Etiquetas">
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => {
                const active = form.tagIds.includes(t.id);
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => toggleTag(t.id)}
                    className="transition-opacity"
                    aria-pressed={active}
                    style={{ opacity: active ? 1 : 0.5 }}
                  >
                    <Badge color={t.color}>{t.name}</Badge>
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <Field label="Notas">
          <Textarea
            value={form.notes ?? ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" loading={saving}>
            {task ? "Guardar cambios" : "Crear tarea"}
          </Button>
        </div>
      </form>

      <div className="mt-5 pt-5 border-t border-t-theme border-border">
        <div className="flex items-center gap-2 mb-3">
          <ListChecks size={15} className="text-subtle" />
          <span className="text-xs font-medium text-subtle uppercase tracking-wide">
            Sub-pasos
          </span>
        </div>

        {task ? (
          <SubtaskList taskId={task.id} initial={steps} onChange={setSteps} />
        ) : (
          <p className="text-sm text-subtle">
            Guarda la tarea para empezar a añadir sub-pasos y ver su barra de progreso.
          </p>
        )}
      </div>
    </>
  );
}
