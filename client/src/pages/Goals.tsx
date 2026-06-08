import { useState } from "react";
import toast from "react-hot-toast";
import { Plus, Target, Trash2, Edit3 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Progress } from "@/components/ui/Progress";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { useResource } from "@/hooks/useResource";
import { api } from "@/services/api";
import type { Category, Goal, GoalType } from "@/types";
import { formatDate } from "@/lib/utils";

const TYPE_LABEL: Record<GoalType, string> = {
  daily: "Diario",
  weekly: "Semanal",
  monthly: "Mensual",
  yearly: "Anual",
};

export function Goals() {
  const goals = useResource(() => api.get<Goal[]>("/goals"));
  const categories = useResource(() => api.get<Category[]>("/categories"));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Goal> | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing?.title || !editing.endDate) return;
    try {
      const payload = {
        title: editing.title,
        description: editing.description ?? null,
        type: editing.type ?? "monthly",
        targetValue: Number(editing.targetValue ?? 100),
        currentValue: Number(editing.currentValue ?? 0),
        unit: editing.unit ?? null,
        startDate: editing.startDate ?? new Date().toISOString(),
        endDate: editing.endDate,
        categoryId: editing.categoryId || null,
        completed: editing.completed ?? false,
      };
      if (editing.id) {
        await api.put(`/goals/${editing.id}`, payload);
        toast.success("Objetivo actualizado");
      } else {
        await api.post(`/goals`, payload);
        toast.success("Objetivo creado");
      }
      setOpen(false);
      goals.reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function remove(g: Goal) {
    if (!confirm(`¿Eliminar "${g.title}"?`)) return;
    await api.delete(`/goals/${g.id}`);
    goals.reload();
  }

  return (
    <>
      <PageHeader
        title="Objetivos"
        description="Define metas claras y mide tu progreso."
        actions={
          <Button
            onClick={() => {
              const end = new Date();
              end.setDate(end.getDate() + 30);
              setEditing({
                type: "monthly",
                targetValue: 100,
                currentValue: 0,
                endDate: end.toISOString().slice(0, 10),
              });
              setOpen(true);
            }}
          >
            <Plus size={16} /> Nuevo objetivo
          </Button>
        }
      />

      {(goals.data ?? []).length === 0 ? (
        <Card>
          <Empty
            icon={Target}
            title="Sin objetivos"
            description="Define qué quieres lograr y haz seguimiento."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(goals.data ?? []).map((g) => {
            const pct = Math.min(100, (g.currentValue / g.targetValue) * 100);
            const days = Math.max(
              0,
              Math.ceil((new Date(g.endDate).getTime() - Date.now()) / 86400000)
            );
            return (
              <Card key={g.id}>
                <CardContent>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Target size={16} className="text-primary" />
                        <h3 className="font-semibold truncate">{g.title}</h3>
                      </div>
                      <Badge>{TYPE_LABEL[g.type]}</Badge>
                      {g.description && (
                        <p className="text-sm text-subtle mt-2 line-clamp-2">{g.description}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => {
                          setEditing({
                            ...g,
                            endDate: g.endDate.slice(0, 10),
                            startDate: g.startDate.slice(0, 10),
                          });
                          setOpen(true);
                        }}
                        className="text-subtle hover:text-text p-1.5 rounded-md hover:bg-muted"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => remove(g)}
                        className="text-subtle hover:text-danger p-1.5 rounded-md hover:bg-muted"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="text-subtle">Progreso</span>
                      <span className="font-medium">
                        {g.currentValue}/{g.targetValue} {g.unit ?? ""}
                      </span>
                    </div>
                    <Progress value={pct} />
                  </div>

                  <div className="flex items-center justify-between text-xs text-subtle mt-3">
                    <span>Vence: {formatDate(g.endDate)}</span>
                    <span>{days} días restantes</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing?.id ? "Editar objetivo" : "Nuevo objetivo"}
      >
        <form onSubmit={save} className="space-y-3">
          <Field label="Título">
            <Input
              autoFocus
              required
              value={editing?.title ?? ""}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            />
          </Field>
          <Field label="Descripción">
            <Textarea
              value={editing?.description ?? ""}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Tipo">
              <Select
                value={editing?.type ?? "monthly"}
                onChange={(e) =>
                  setEditing({ ...editing, type: e.target.value as GoalType })
                }
              >
                <option value="daily">Diario</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensual</option>
                <option value="yearly">Anual</option>
              </Select>
            </Field>
            <Field label="Meta">
              <Input
                type="number"
                value={editing?.targetValue ?? 100}
                onChange={(e) =>
                  setEditing({ ...editing, targetValue: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Actual">
              <Input
                type="number"
                value={editing?.currentValue ?? 0}
                onChange={(e) =>
                  setEditing({ ...editing, currentValue: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unidad (opcional)">
              <Input
                placeholder="tareas, horas..."
                value={editing?.unit ?? ""}
                onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
              />
            </Field>
            <Field label="Fecha límite">
              <Input
                type="date"
                required
                value={editing?.endDate ? String(editing.endDate).slice(0, 10) : ""}
                onChange={(e) => setEditing({ ...editing, endDate: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Categoría">
            <Select
              value={editing?.categoryId ?? ""}
              onChange={(e) => setEditing({ ...editing, categoryId: e.target.value })}
            >
              <option value="">Sin categoría</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end pt-2">
            <Button type="submit">{editing?.id ? "Guardar" : "Crear"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
