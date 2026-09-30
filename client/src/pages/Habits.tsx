import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { motion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import { Activity, CalendarClock, CalendarRange, Edit3, Flame, ImageUp, Plus, RefreshCw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Dialog } from "@/components/ui/Dialog";
import { HabitForm } from "@/components/forms/HabitForm";
import { HabitHeatmap } from "@/components/habits/HabitHeatmap";
import { HabitCounter } from "@/components/habits/HabitCounter";
import { ScreenshotImport } from "@/components/habits/ScreenshotImport";
import { useResource } from "@/hooks/useResource";
import { api } from "@/services/api";
import { describeSchedule, deviceTimeZone } from "@/services/habits/schedule";
import type { GcalLinkRow } from "@/services/localDb";
import type { Category, Habit, HabitDayProgress } from "@/types";
import { cn } from "@/lib/utils";

const FREQ_LABEL: Record<string, string> = { daily: "Diario", weekly: "Semanal", monthly: "Mensual", custom: "Personalizado" };

export function Habits() {
  const habits = useResource(() => api.get<Habit[]>("/habits"));
  const categories = useResource(() => api.get<Category[]>("/categories"));
  const links = useResource(() => api.get<GcalLinkRow[]>("/gcal/links"));
  const [editing, setEditing] = useState<Habit | null>(null);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // El mapa anual necesita tarjetas anchas; la tira de 30 días cabe en 3 columnas.
  const [range, setRange] = useState<"30d" | "year">("30d");
  const [params, setParams] = useSearchParams();

  // El calendario enlaza a /habitos?h=<id>: se abre la edición de ese hábito.
  useEffect(() => {
    const id = params.get("h");
    if (!id || !habits.data) return;
    const h = habits.data.find((x) => x.id === id);
    if (h) {
      setEditing(h);
      setOpen(true);
    }
    params.delete("h");
    setParams(params, { replace: true });
  }, [params, habits.data, setParams]);

  function setToday(h: Habit, today: HabitDayProgress) {
    habits.setData((list) => list?.map((x) => (x.id === h.id ? { ...x, stats: { ...x.stats, today } } : x)) ?? null);
    // Racha y tira de 30 días se recalculan en segundo plano.
    habits.reload();
  }

  async function remove(h: Habit) {
    if (!confirm(`¿Eliminar el hábito "${h.name}"? Se borrarán su historial y sus horarios.`)) return;
    const linked = (links.data ?? []).some((l) => l.habitId === h.id);
    const remote = linked && confirm("Tiene eventos en Google Calendar.\n\nAceptar: quitar sus eventos futuros de Google.\nCancelar: dejarlos en Google.") ? "future" : "keep";
    await api.delete(`/habits/${h.id}?remote=${remote}`);
    toast.success("Hábito eliminado");
    habits.reload();
    links.reload();
  }

  const gcalState = (h: Habit) => {
    const mine = (links.data ?? []).filter((l) => l.habitId === h.id);
    if (!mine.length) return null;
    if (mine.some((l) => l.state === "conflict" || l.state === "remote_changed" || l.state === "error")) return "attention";
    return "synced";
  };

  return (
    <>
      <PageHeader
        title="Hábitos"
        description="Construye rutinas, mantén tus rachas."
        actions={
          <>
            <div className="flex rounded-md border border-theme border-border overflow-hidden">
              <button onClick={() => setRange("30d")} className={cn("px-3 h-9 text-sm flex items-center gap-1.5", range === "30d" ? "bg-primary text-primary-fg" : "hover:bg-muted")}>
                <Activity size={14} /> 30 días
              </button>
              <button onClick={() => setRange("year")} className={cn("px-3 h-9 text-sm flex items-center gap-1.5", range === "year" ? "bg-primary text-primary-fg" : "hover:bg-muted")}>
                <CalendarRange size={14} /> Año
              </button>
            </div>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <ImageUp size={16} /> <span className="hidden sm:inline">Importar desde captura</span>
              <span className="sm:hidden">Importar</span>
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus size={16} /> Nuevo hábito
            </Button>
          </>
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
        <div className={cn("grid grid-cols-1 gap-4", range === "30d" ? "md:grid-cols-2 xl:grid-cols-3" : "xl:grid-cols-2")}>
          {(habits.data ?? []).map((h, i) => {
            const active = h.schedules.filter((s) => s.active);
            const sync = gcalState(h);
            return (
              <motion.div key={h.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${h.color}22`, color: h.color }}>
                        <Activity size={18} />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="truncate">{h.name}</CardTitle>
                        <p className="text-xs text-subtle mt-0.5">
                          {FREQ_LABEL[h.frequency] ?? h.frequency} · meta {h.dailyTarget} {h.unit ?? (h.dailyTarget === 1 ? "vez" : "veces")}/día
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {sync && (
                        <span
                          className={cn("p-1.5", sync === "attention" ? "text-warning" : "text-subtle")}
                          title={sync === "attention" ? "Google Calendar: requiere revisión (Configuración › Integraciones)" : "Sincronizado con Google Calendar"}
                        >
                          <RefreshCw size={14} />
                        </span>
                      )}
                      <button
                        onClick={() => {
                          setEditing(h);
                          setOpen(true);
                        }}
                        className="text-subtle hover:text-text p-1.5 rounded-md hover:bg-muted"
                        aria-label={`Editar ${h.name}`}
                      >
                        <Edit3 size={14} />
                      </button>
                      <button onClick={() => remove(h)} className="text-subtle hover:text-danger p-1.5 rounded-md hover:bg-muted" aria-label={`Eliminar ${h.name}`}>
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

                    <div className="mb-4">
                      {range === "30d" ? (
                        <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(30, 1fr)" }}>
                          {h.stats.last30.map((d) => {
                            const partial = !d.done && d.count > 0;
                            return (
                              <div
                                key={d.date}
                                title={`${new Date(d.date).toLocaleDateString("es-ES")}: ${d.count}/${d.target}`}
                                className={cn("h-4 rounded-sm", d.done || partial ? "" : "bg-muted")}
                                style={d.done ? { background: h.color } : partial ? { background: h.color, opacity: 0.25 + 0.5 * (d.count / d.target) } : undefined}
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <HabitHeatmap habitId={h.id} color={h.color} />
                      )}
                    </div>

                    {active.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        {active.slice(0, 4).map((s) => (
                          <span key={s.id} className="gt-pill inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-muted" title={s.timezone !== deviceTimeZone() ? `Zona: ${s.timezone}` : undefined}>
                            <CalendarClock size={11} /> {describeSchedule(s)}
                          </span>
                        ))}
                        {active.length > 4 && <span className="text-xs text-subtle self-center">+{active.length - 4} horarios</span>}
                      </div>
                    )}

                    <HabitCounter habitId={h.id} color={h.color} unit={h.unit} progress={h.stats.today} onChanged={(p) => setToday(h, p)} />
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? "Editar hábito" : "Nuevo hábito"} size="lg">
        <HabitForm
          key={editing?.id ?? "new"}
          habit={editing}
          categories={categories.data ?? []}
          onSaved={() => {
            setOpen(false);
            habits.reload();
            links.reload();
          }}
        />
      </Dialog>

      <ScreenshotImport open={importOpen} onClose={() => setImportOpen(false)} onImported={() => habits.reload()} />
    </>
  );
}
