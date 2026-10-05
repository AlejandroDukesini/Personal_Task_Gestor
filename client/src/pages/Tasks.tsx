import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from "@hello-pangea/dnd";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  Bell,
  Calendar as CalendarIcon,
  CalendarDays,
  Clock,
  Edit3,
  History,
  LayoutList,
  Plus,
  Repeat,
  Search,
  Target,
  Trash2,
  KanbanSquare,
  Filter,
  ListChecks,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Progress } from "@/components/ui/Progress";
import { Empty } from "@/components/ui/Empty";
import { Dialog } from "@/components/ui/Dialog";
import { TaskForm } from "@/components/forms/TaskForm";
import { useResource } from "@/hooks/useResource";
import { api } from "@/services/api";
import { taskCompletionError } from "@/services/rules";
import type { Category, Goal, Tag, Task, TaskStatus } from "@/types";
import {
  cn,
  formatDate,
  isOverdue,
  priorityColor,
  priorityLabel,
  relativeDay,
  statusLabel,
} from "@/lib/utils";

const STATUSES: TaskStatus[] = ["pending", "in_progress", "completed", "cancelled"];
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

type View = "list" | "kanban" | "history";
type Quick = "all" | "today" | "upcoming" | "overdue" | "nodate";
type Sort = "manual" | "due" | "priority" | "created" | "title";

const RECURRENCE_LABEL: Record<string, string> = {
  daily: "Diaria",
  weekdays: "Laborables",
  weekly: "Semanal",
  monthly: "Mensual",
  yearly: "Anual",
};

/** Día (local) del vencimiento: la fecha se guarda como medianoche UTC del día elegido. */
function dueDay(t: Task): string | null {
  return t.dueDate ? t.dueDate.slice(0, 10) : null;
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function Tasks() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(() => (["list", "kanban", "history"].includes(params.get("view") ?? "") ? (params.get("view") as View) : "list"));
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "open" | TaskStatus>("open");
  const [tagFilter, setTagFilter] = useState("");
  const [quick, setQuick] = useState<Quick>(() => (params.get("quick") as Quick) || "all");
  const [sort, setSort] = useState<Sort>("manual");
  const [editing, setEditing] = useState<Task | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const tasks = useResource(() => api.get<Task[]>("/tasks"));
  const categories = useResource(() => api.get<Category[]>("/categories"));
  const tags = useResource(() => api.get<Tag[]>("/tags"));
  const goals = useResource(() => api.get<Goal[]>("/goals"));

  const today = localToday();

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (tasks.data ?? []).filter((t) => {
      if (needle && !`${t.title} ${t.description ?? ""} ${t.notes ?? ""}`.toLowerCase().includes(needle)) return false;
      if (categoryFilter && t.categoryId !== categoryFilter) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (tagFilter && !t.tags.some((x) => x.id === tagFilter)) return false;
      // El Kanban necesita todas las columnas: el filtro de estado solo aplica a la lista.
      if (view === "list") {
        if (statusFilter === "open" && (t.status === "completed" || t.status === "cancelled")) return false;
        if (statusFilter && statusFilter !== "open" && t.status !== statusFilter) return false;
      }
      const d = dueDay(t);
      if (quick === "today" && d !== today) return false;
      if (quick === "upcoming" && !(d && d > today)) return false;
      if (quick === "overdue" && !isOverdue(t.dueDate, t.status, t.dueTime)) return false;
      if (quick === "nodate" && d) return false;
      return true;
    });
    const cmp: Record<Sort, (a: Task, b: Task) => number> = {
      manual: () => 0,
      due: (a, b) => (dueDay(a) ?? "9999").localeCompare(dueDay(b) ?? "9999") || (a.dueTime ?? "").localeCompare(b.dueTime ?? ""),
      priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
      title: (a, b) => a.title.localeCompare(b.title, "es"),
    };
    return sort === "manual" ? list : [...list].sort(cmp[sort]);
  }, [tasks.data, search, categoryFilter, priorityFilter, tagFilter, statusFilter, quick, sort, view, today]);

  const byStatus = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = { pending: [], in_progress: [], completed: [], cancelled: [] };
    for (const t of filtered) groups[t.status as TaskStatus]?.push(t);
    return groups;
  }, [filtered]);

  // Historial: completadas agrupadas por día de cierre.
  const history = useMemo(() => {
    const done = (tasks.data ?? [])
      .filter((t) => t.status === "completed" && t.completedAt)
      .filter((t) => !search || t.title.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    const groups: { day: string; items: Task[] }[] = [];
    for (const t of done) {
      const day = new Date(t.completedAt!).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      const last = groups[groups.length - 1];
      if (last?.day === day) last.items.push(t);
      else groups.push({ day, items: [t] });
    }
    return groups;
  }, [tasks.data, search]);

  const counts = useMemo(() => {
    const list = tasks.data ?? [];
    const open = list.filter((t) => t.status === "pending" || t.status === "in_progress");
    return {
      today: open.filter((t) => dueDay(t) === today).length,
      overdue: open.filter((t) => isOverdue(t.dueDate, t.status, t.dueTime)).length,
    };
  }, [tasks.data, today]);

  async function handleDelete(t: Task) {
    const extra = t.recurrence ? " Las próximas repeticiones ya creadas no se borran." : "";
    if (!confirm(`¿Eliminar «${t.title}»?${extra}`)) return;
    await api.delete(`/tasks/${t.id}`);
    toast.success("Tarea eliminada");
    tasks.reload();
  }

  async function toggleStatus(task: Task) {
    const newStatus: TaskStatus = task.status === "completed" ? "pending" : "completed";
    const pending = newStatus === "completed" ? taskCompletionError(task.subtasks ?? []) : null;
    if (pending) {
      toast.error(pending);
      return;
    }
    try {
      await api.put(`/tasks/${task.id}`, { status: newStatus });
      if (newStatus === "completed" && task.recurrence) toast.success("Hecho. Se programó la siguiente repetición.");
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo cambiar el estado");
    }
    tasks.reload();
    goals.reload();
  }

  async function onDragEnd(result: DropResult) {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId as TaskStatus;
    const column = byStatus[newStatus].filter((t) => t.id !== result.draggableId);
    const moved = (tasks.data ?? []).find((t) => t.id === result.draggableId);
    if (!moved) return;
    if (newStatus === "completed" && moved.status !== "completed") {
      const pending = taskCompletionError(moved.subtasks ?? []);
      if (pending) {
        toast.error(pending);
        return;
      }
    }
    column.splice(result.destination.index, 0, moved);
    // Se persiste el orden de la columna completa (antes se perdía al soltar).
    try {
      await api.patch("/tasks/reorder", column.map((t, i) => ({ id: t.id, position: i, status: t.id === moved.id ? newStatus : undefined })));
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo mover la tarea");
    }
    tasks.reload();
  }

  // `/tareas?new=1` es el destino de la acción "Nueva tarea" de la paleta de
  // comandos. Se consume el parámetro para que recargar no reabra el diálogo.
  useEffect(() => {
    if (params.get("new") !== "1") return;
    setEditing(null);
    setDialogOpen(true);
    params.delete("new");
    setParams(params, { replace: true });
  }, [params, setParams]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(t: Task) {
    setEditing(t);
    setDialogOpen(true);
  }

  const viewBtn = (id: View, Icon: typeof LayoutList, label: string) => (
    <button
      onClick={() => setView(id)}
      aria-pressed={view === id}
      className={cn("px-3 h-9 text-sm flex items-center gap-1.5", view === id ? "bg-primary text-primary-fg" : "hover:bg-muted")}
    >
      <Icon size={14} /> <span className="hidden sm:inline">{label}</span>
    </button>
  );

  const quickBtn = (id: Quick, label: string, count?: number) => (
    <button
      onClick={() => setQuick(id)}
      aria-pressed={quick === id}
      className={cn(
        "gt-pill px-3 py-1 text-xs whitespace-nowrap",
        quick === id ? "bg-primary text-primary-fg" : "bg-muted hover:bg-border"
      )}
    >
      {label}
      {count ? <span className={cn("ml-1", id === "overdue" && quick !== id && "text-danger font-semibold")}>{count}</span> : null}
    </button>
  );

  return (
    <>
      <PageHeader
        title="Tareas"
        description={view === "history" ? `${history.reduce((s, g) => s + g.items.length, 0)} completada(s)` : `${filtered.length} tarea(s) visible(s)`}
        actions={
          <>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {viewBtn("list", LayoutList, "Lista")}
              {viewBtn("kanban", KanbanSquare, "Kanban")}
              {viewBtn("history", History, "Historial")}
            </div>
            <Link to="/calendario" className="p-2 rounded-md hover:bg-muted text-subtle" aria-label="Ver en el calendario" title="Ver en el calendario">
              <CalendarDays size={18} />
            </Link>
            <Button onClick={openCreate}>
              <Plus size={16} /> Nueva tarea
            </Button>
          </>
        }
      />

      {view !== "history" && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-3 -mx-1 px-1" role="group" aria-label="Vistas rápidas">
          {quickBtn("all", "Todas")}
          {quickBtn("today", "Hoy", counts.today)}
          {quickBtn("upcoming", "Próximas")}
          {quickBtn("overdue", "Vencidas", counts.overdue)}
          {quickBtn("nodate", "Sin fecha")}
        </div>
      )}

      {/* Filtros */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">
        <div className="col-span-2 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
          <Input
            placeholder="Buscar en título, descripción y notas…"
            aria-label="Buscar tareas"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {view !== "history" && (
          <>
            <Select aria-label="Categoría" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">Todas las categorías</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Prioridad" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="">Todas las prioridades</option>
              <option value="critical">Crítica</option>
              <option value="high">Alta</option>
              <option value="medium">Media</option>
              <option value="low">Baja</option>
            </Select>
            {view === "list" ? (
              <Select aria-label="Estado" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
                <option value="open">Abiertas</option>
                <option value="">Todos los estados</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="hidden md:block" />
            )}
            <Select aria-label="Ordenar" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="manual">Orden manual</option>
              <option value="due">Vencimiento</option>
              <option value="priority">Prioridad</option>
              <option value="created">Más recientes</option>
              <option value="title">Título (A-Z)</option>
            </Select>
            {(tags.data ?? []).length > 0 && (
              <Select aria-label="Etiqueta" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                <option value="">Todas las etiquetas</option>
                {(tags.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </>
        )}
      </div>

      {view === "history" ? (
        <Card>
          <CardContent>
            {history.length === 0 ? (
              <Empty icon={History} title="Aún no hay tareas completadas" description="Aquí verás lo que vayas terminando, día a día." />
            ) : (
              <div className="space-y-4">
                {history.map((g) => (
                  <section key={g.day}>
                    <h3 className="text-xs uppercase tracking-wide text-subtle mb-1 capitalize">
                      {g.day} · {g.items.length}
                    </h3>
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {g.items.map((t) => (
                        <li key={t.id} className="flex items-center gap-3 p-3 text-sm">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.category?.color ?? "#94a3b8" }} aria-hidden />
                          <span className="flex-1 min-w-0 truncate">{t.title}</span>
                          {t.dueDate && (
                            <span className={cn("text-xs", t.completedAt && t.completedAt.slice(0, 10) > t.dueDate.slice(0, 10) ? "text-warning" : "text-subtle")}>
                              {t.completedAt && t.completedAt.slice(0, 10) > t.dueDate.slice(0, 10) ? "con retraso" : "a tiempo"}
                            </span>
                          )}
                          <span className="text-xs text-subtle tabular-nums">
                            {new Date(t.completedAt!).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <button onClick={() => toggleStatus(t)} className="text-xs text-primary hover:underline">
                            Reabrir
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : view === "list" ? (
        <Card>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <Empty
                icon={Filter}
                title="No se encontraron tareas"
                description="Ajusta los filtros o crea una nueva tarea."
                action={
                  <Button onClick={openCreate}>
                    <Plus size={16} /> Crear tarea
                  </Button>
                }
              />
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((t) => (
                  <TaskRow key={t.id} task={t} onToggle={() => toggleStatus(t)} onEdit={() => openEdit(t)} onDelete={() => handleDelete(t)} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {STATUSES.map((status) => (
              <Droppable droppableId={status} key={status}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={cn("rounded-xl border border-border bg-muted/30 p-3 min-h-[300px]", snapshot.isDraggingOver && "bg-muted")}
                  >
                    <div className="flex items-center justify-between mb-3 px-1">
                      <span className="font-medium text-sm">{statusLabel(status)}</span>
                      <Badge>{byStatus[status].length}</Badge>
                    </div>
                    <div className="space-y-2">
                      {byStatus[status].map((t, idx) => (
                        <Draggable draggableId={t.id} index={idx} key={t.id}>
                          {(prov, snap) => (
                            <div
                              ref={prov.innerRef}
                              {...prov.draggableProps}
                              {...prov.dragHandleProps}
                              className={cn("bg-surface border border-border rounded-lg p-3 shadow-soft cursor-grab", snap.isDragging && "rotate-1 shadow-lg")}
                              onClick={() => openEdit(t)}
                            >
                              <div className="flex items-start gap-2">
                                {t.category && <span className="h-2 w-2 mt-1.5 rounded-full shrink-0" style={{ background: t.category.color }} />}
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{t.title}</div>
                                  {t.dueDate && (
                                    <div className={cn("text-xs flex items-center gap-1 mt-1", isOverdue(t.dueDate, t.status, t.dueTime) ? "text-danger" : "text-subtle")}>
                                      <CalendarIcon size={11} />
                                      {relativeDay(t.dueDate)}
                                      {t.recurrence && <Repeat size={11} aria-label="Recurrente" />}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center justify-between mt-2 gap-2">
                                <Badge className={priorityColor(t.priority)}>{priorityLabel(t.priority)}</Badge>
                                <div className="flex items-center gap-2 text-xs text-subtle">
                                  {t.subtasks.length > 0 && (
                                    <span className="flex items-center gap-1">
                                      <ListChecks size={11} />
                                      {t.subtasks.filter((s) => s.done).length}/{t.subtasks.length}
                                    </span>
                                  )}
                                  {t.progress > 0 && <span>{t.progress}%</span>}
                                </div>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  </div>
                )}
              </Droppable>
            ))}
          </div>
        </DragDropContext>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Editar tarea" : "Nueva tarea"} size="lg">
        <TaskForm
          task={editing}
          categories={categories.data ?? []}
          tags={tags.data ?? []}
          goals={(goals.data ?? []).filter((g) => !g.completed || g.id === editing?.goalId)}
          onSaved={() => {
            setDialogOpen(false);
            tasks.reload();
            goals.reload();
          }}
        />
      </Dialog>
    </>
  );
}

function TaskRow({
  task,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: Task;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const overdue = isOverdue(task.dueDate, task.status, task.dueTime);
  const hasReminder = task.reminders.some((r) => !r.delivered);
  return (
    <motion.div layout className="flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors">
      <button
        onClick={onToggle}
        className={cn(
          "h-5 w-5 rounded-full border-2 shrink-0 transition-colors",
          task.status === "completed" ? "bg-success border-success" : "border-border hover:border-primary"
        )}
        aria-label={task.status === "completed" ? `Reabrir ${task.title}` : `Completar ${task.title}`}
      >
        {task.status === "completed" && (
          <svg viewBox="0 0 24 24" className="w-full h-full text-white p-0.5">
            <path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M5 12l5 5L20 7" />
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
        <div className={cn("font-medium text-sm", task.status === "completed" && "line-through text-subtle")}>{task.title}</div>
        <div className="text-xs text-subtle flex items-center gap-2 mt-0.5 flex-wrap">
          {task.category && (
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: task.category.color }} />
              {task.category.name}
            </span>
          )}
          {task.dueDate && (
            <span className={cn("flex items-center gap-1", overdue && "text-danger")}>
              <Clock size={11} /> {formatDate(task.dueDate)}
              {task.dueTime && ` · ${task.dueTime}`}
            </span>
          )}
          {task.recurrence && (
            <span className="flex items-center gap-1">
              <Repeat size={11} /> {RECURRENCE_LABEL[task.recurrence]}
              {task.recurrenceInterval && task.recurrenceInterval > 1 ? ` ×${task.recurrenceInterval}` : ""}
            </span>
          )}
          {hasReminder && (
            <span className="flex items-center gap-1" title="Con recordatorio">
              <Bell size={11} aria-label="Con recordatorio" />
            </span>
          )}
          {task.goal && (
            <span className="flex items-center gap-1">
              <Target size={11} /> {task.goal.title}
            </span>
          )}
          {task.subtasks.length > 0 && (
            <span className="flex items-center gap-1">
              <ListChecks size={11} />
              {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length}
            </span>
          )}
          {task.tags.map((t) => (
            <Badge key={t.id} color={t.color}>
              {t.name}
            </Badge>
          ))}
        </div>
        {task.progress > 0 && task.status !== "completed" && <Progress value={task.progress} className="mt-2 h-1.5" />}
      </div>
      <Badge className={cn(priorityColor(task.priority), "hidden sm:inline-flex")}>{priorityLabel(task.priority)}</Badge>
      <button onClick={onEdit} className="text-subtle hover:text-text p-1.5 rounded-md hover:bg-muted" aria-label={`Editar ${task.title}`}>
        <Edit3 size={14} />
      </button>
      <button onClick={onDelete} className="text-subtle hover:text-danger p-1.5 rounded-md hover:bg-muted" aria-label={`Eliminar ${task.title}`}>
        <Trash2 size={14} />
      </button>
    </motion.div>
  );
}
