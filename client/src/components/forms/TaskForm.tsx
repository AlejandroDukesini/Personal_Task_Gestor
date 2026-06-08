import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/services/api";
import type { Category, Tag, Task } from "@/types";

function toDateInput(d?: string | null) {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export function TaskForm({
  task,
  categories,
  tags,
  onSaved,
}: {
  task: Task | null;
  categories: Category[];
  tags: Tag[];
  onSaved: () => void;
}) {
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
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        categoryId: form.categoryId || null,
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
    <form onSubmit={submit} className="space-y-4">
      <Field label="Título">
        <Input
          autoFocus
          required
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </Field>

      <Field label="Descripción">
        <Textarea
          value={form.description ?? ""}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>

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
        <Field label="Estado">
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
        <Field label="Vencimiento">
          <Input
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
          />
        </Field>
        <Field label="Hora">
          <Input
            type="time"
            value={form.dueTime ?? ""}
            onChange={(e) => setForm({ ...form, dueTime: e.target.value })}
          />
        </Field>
      </div>

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
  );
}
