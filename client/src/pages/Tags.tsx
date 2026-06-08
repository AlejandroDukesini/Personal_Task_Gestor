import { useState } from "react";
import toast from "react-hot-toast";
import { Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { useResource } from "@/hooks/useResource";
import { api } from "@/services/api";
import type { Tag } from "@/types";

const COLORS = ["#6366f1", "#10b981", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#64748b"];

export function Tags() {
  const tags = useResource(() => api.get<Tag[]>("/tags"));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Tag>>({ color: "#6366f1" });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) return;
    try {
      await api.post(`/tags`, form);
      toast.success("Etiqueta creada");
      setOpen(false);
      setForm({ color: "#6366f1" });
      tags.reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function remove(t: Tag) {
    if (!confirm(`¿Eliminar "${t.name}"?`)) return;
    await api.delete(`/tags/${t.id}`);
    tags.reload();
  }

  return (
    <>
      <PageHeader
        title="Etiquetas"
        description="Marca tareas con etiquetas personalizadas."
        actions={
          <Button
            onClick={() => {
              setForm({ color: "#6366f1" });
              setOpen(true);
            }}
          >
            <Plus size={16} /> Nueva etiqueta
          </Button>
        }
      />

      <Card>
        <CardContent>
          {(tags.data ?? []).length === 0 ? (
            <Empty icon={TagIcon} title="Sin etiquetas" description="Crea etiquetas para clasificar." />
          ) : (
            <div className="flex flex-wrap gap-3">
              {(tags.data ?? []).map((t) => (
                <div key={t.id} className="flex items-center gap-2 group">
                  <Badge color={t.color}>{t.name}</Badge>
                  <button
                    onClick={() => remove(t)}
                    className="text-subtle hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title="Nueva etiqueta">
        <form onSubmit={save} className="space-y-3">
          <Field label="Nombre">
            <Input
              autoFocus
              required
              value={form.name ?? ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Color">
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setForm({ ...form, color: c })}
                  className="h-8 w-8 rounded-full border-2 transition-transform"
                  style={{
                    background: c,
                    borderColor: form.color === c ? "rgb(var(--text))" : "transparent",
                    transform: form.color === c ? "scale(1.1)" : "scale(1)",
                  }}
                />
              ))}
            </div>
          </Field>
          <div className="flex justify-end pt-2">
            <Button type="submit">Crear</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
