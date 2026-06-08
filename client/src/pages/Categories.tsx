import { useState } from "react";
import toast from "react-hot-toast";
import { Edit3, Folder, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Empty } from "@/components/ui/Empty";
import { useResource } from "@/hooks/useResource";
import { api } from "@/services/api";
import type { Category } from "@/types";

const COLORS = ["#6366f1", "#10b981", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#64748b"];

export function Categories() {
  const cats = useResource(() => api.get<Category[]>("/categories"));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Category> | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing?.name) return;
    try {
      const payload = {
        name: editing.name,
        color: editing.color ?? "#6366f1",
        icon: editing.icon ?? null,
        description: editing.description ?? null,
        parentId: editing.parentId || null,
      };
      if (editing.id) {
        await api.put(`/categories/${editing.id}`, payload);
        toast.success("Categoría actualizada");
      } else {
        await api.post(`/categories`, payload);
        toast.success("Categoría creada");
      }
      setOpen(false);
      cats.reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function remove(c: Category) {
    if (!confirm(`¿Eliminar "${c.name}"? Las tareas/hábitos relacionados quedarán sin categoría.`)) return;
    await api.delete(`/categories/${c.id}`);
    toast.success("Categoría eliminada");
    cats.reload();
  }

  const roots = (cats.data ?? []).filter((c) => !c.parentId);

  return (
    <>
      <PageHeader
        title="Categorías"
        description="Organiza áreas de trabajo, vida personal o lo que necesites."
        actions={
          <Button
            onClick={() => {
              setEditing({ color: "#6366f1" });
              setOpen(true);
            }}
          >
            <Plus size={16} /> Nueva categoría
          </Button>
        }
      />

      {roots.length === 0 ? (
        <Card>
          <Empty
            icon={Folder}
            title="Sin categorías"
            description="Agrupa tu trabajo en áreas para verlo más claro."
            action={
              <Button
                onClick={() => {
                  setEditing({ color: "#6366f1" });
                  setOpen(true);
                }}
              >
                <Plus size={16} /> Crear categoría
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roots.map((c) => (
            <Card key={c.id}>
              <CardContent>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `${c.color}22`, color: c.color }}
                    >
                      <Folder size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{c.name}</div>
                      {c.description && (
                        <div className="text-xs text-subtle mt-0.5 line-clamp-2">{c.description}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditing(c);
                        setOpen(true);
                      }}
                      className="text-subtle hover:text-text p-1.5 rounded-md hover:bg-muted"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => remove(c)}
                      className="text-subtle hover:text-danger p-1.5 rounded-md hover:bg-muted"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-subtle mt-3">
                  <span>{c._count?.tasks ?? 0} tareas</span>
                  <span>{c._count?.habits ?? 0} hábitos</span>
                </div>
                {c.children && c.children.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border space-y-1">
                    {c.children.map((sc) => (
                      <div key={sc.id} className="flex items-center gap-2 text-sm">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: sc.color }}
                        />
                        <span className="flex-1 truncate">{sc.name}</span>
                        <button
                          onClick={() => {
                            setEditing(sc);
                            setOpen(true);
                          }}
                          className="text-subtle hover:text-text"
                        >
                          <Edit3 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing?.id ? "Editar categoría" : "Nueva categoría"}
      >
        <form onSubmit={save} className="space-y-3">
          <Field label="Nombre">
            <Input
              autoFocus
              required
              value={editing?.name ?? ""}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </Field>
          <Field label="Descripción">
            <Textarea
              value={editing?.description ?? ""}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </Field>
          <Field label="Color">
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setEditing({ ...editing, color: c })}
                  className="h-8 w-8 rounded-full border-2 transition-transform"
                  style={{
                    background: c,
                    borderColor: editing?.color === c ? "rgb(var(--text))" : "transparent",
                    transform: editing?.color === c ? "scale(1.1)" : "scale(1)",
                  }}
                />
              ))}
            </div>
          </Field>
          <Field label="Categoría padre (opcional)">
            <Select
              value={editing?.parentId ?? ""}
              onChange={(e) => setEditing({ ...editing, parentId: e.target.value })}
            >
              <option value="">Ninguna</option>
              {roots
                .filter((c) => c.id !== editing?.id)
                .map((c) => (
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
