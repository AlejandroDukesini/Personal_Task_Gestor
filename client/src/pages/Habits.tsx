import { useState } from "react";
import toast from "react-hot-toast";
import { motion } from "framer-motion";
import { Activity, Edit3, Flame, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { Dialog } from "@/components/ui/Dialog";
import { HabitForm } from "@/components/forms/HabitForm";
import { useResource } from "@/hooks/useResource";
import { api } from "@/services/api";
import type { Category, Habit } from "@/types";
import { cn } from "@/lib/utils";

export function Habits() {
  const habits = useResource(() => api.get<Habit[]>("/habits"));
  const categories = useResource(() => api.get<Category[]>("/categories"));
  const [editing, setEditing] = useState<Habit | null>(null);
  const [open, setOpen] = useState(false);

  async function toggleToday(h: Habit) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const done = h.stats.last30[h.stats.last30.length - 1]?.done;
    if (done) {
      await api.delete(`/habits/${h.id}/logs?date=${today.toISOString()}`);
    } else {
      await api.post(`/habits/${h.id}/logs`, { date: today.toISOString() });
    }
    habits.reload();
  }

  async function remove(h: Habit) {
    if (!confirm(`¿Eliminar el hábito "${h.name}"?`)) return;
    await api.delete(`/habits/${h.id}`);
    toast.success("Hábito eliminado");
    habits.reload();
  }

  return (
    <>
      <PageHeader
        title="Hábitos"
        description="Construye rutinas, mantén tus rachas."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus size={16} /> Nuevo hábito
          </Button>
        }
      />

      {(habits.data ?? []).length === 0 ? (
        <Card>
          <Empty
            icon={Activity}
            title="Sin hábitos todavía"
            description="Crea tu primer hábito y empieza a seguirlo cada día."
            action={
              <Button onClick={() => setOpen(true)}>
                <Plus size={16} /> Crear hábito
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(habits.data ?? []).map((h, i) => (
            <motion.div
              key={h.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `${h.color}22`, color: h.color }}
                    >
                      <Activity size={18} />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="truncate">{h.name}</CardTitle>
                      <p className="text-xs text-subtle mt-0.5 capitalize">{h.frequency}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditing(h);
                        setOpen(true);
                      }}
                      className="text-subtle hover:text-text p-1.5 rounded-md hover:bg-muted"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => remove(h)}
                      className="text-subtle hover:text-danger p-1.5 rounded-md hover:bg-muted"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 text-center mb-4">
                    <div className="bg-muted rounded-lg p-2">
                      <div className="text-xs text-subtle">Racha</div>
                      <div className="font-semibold flex items-center justify-center gap-1">
                        <Flame size={14} className="text-orange-500" /> {h.stats.streak}
                      </div>
                    </div>
                    <div className="bg-muted rounded-lg p-2">
                      <div className="text-xs text-subtle">Mejor</div>
                      <div className="font-semibold">{h.stats.best}</div>
                    </div>
                    <div className="bg-muted rounded-lg p-2">
                      <div className="text-xs text-subtle">Éxito 30d</div>
                      <div className="font-semibold">{Math.round(h.stats.successRate * 100)}%</div>
                    </div>
                  </div>

                  {/* últimos 30 días */}
                  <div className="grid gap-1 mb-4" style={{ gridTemplateColumns: "repeat(30, 1fr)" }}>
                    {h.stats.last30.map((d) => (
                      <div
                        key={d.date}
                        title={new Date(d.date).toLocaleDateString("es-ES")}
                        className={cn(
                          "h-4 rounded-sm",
                          d.done ? "" : "bg-muted"
                        )}
                        style={d.done ? { background: h.color } : undefined}
                      />
                    ))}
                  </div>

                  <Button
                    variant={h.stats.last30[h.stats.last30.length - 1]?.done ? "secondary" : "primary"}
                    className="w-full"
                    onClick={() => toggleToday(h)}
                  >
                    {h.stats.last30[h.stats.last30.length - 1]?.done
                      ? "Desmarcar hoy"
                      : "Marcar como hecho hoy"}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar hábito" : "Nuevo hábito"}
        size="lg"
      >
        <HabitForm
          habit={editing}
          categories={categories.data ?? []}
          onSaved={() => {
            setOpen(false);
            habits.reload();
          }}
        />
      </Dialog>
    </>
  );
}
