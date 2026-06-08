import { useMemo, useState } from "react";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from "@hello-pangea/dnd";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  Calendar as CalendarIcon,
  Clock,
  Edit3,
  LayoutList,
  Plus,
  Search,
  Trash2,
  KanbanSquare,
  Filter,
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
import type { Category, Tag, Task, TaskStatus } from "@/types";
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

export function Tasks() {
  const [view, setView] = useState<"list" | "kanban">("list");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const tasks = useResource(() => api.get<Task[]>("/tasks"));
  const categories = useResource(() => api.get<Category[]>("/categories"));
  const tags = useResource(() => api.get<Tag[]>("/tags"));

  const filtered = useMemo(() => {
    const list = tasks.data ?? [];
    return list.filter((t) => {
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (categoryFilter && t.categoryId !== categoryFilter) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      return true;
    });
  }, [tasks.data, search, categoryFilter, priorityFilter]);

  const byStatus = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = {
      pending: [],
      in_progress: [],
      completed: [],
      cancelled: [],
    };
    for (const t of filtered) groups[t.status as TaskStatus].push(t);
    return groups;
  }, [filtered]);

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta tarea?")) return;
    await api.delete(`/tasks/${id}`);
    toast.success("Tarea eliminada");
    tasks.reload();
  }

  async function toggleStatus(task: Task) {
    const newStatus: TaskStatus = task.status === "completed" ? "pending" : "completed";
    await api.put(`/tasks/${task.id}`, { status: newStatus });
    tasks.reload();
  }

  async function onDragEnd(result: DropResult) {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId as TaskStatus;
    const id = result.draggableId;
    await api.put(`/tasks/${id}`, { status: newStatus });
    tasks.reload();
  }

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(t: Task) {
    setEditing(t);
    setDialogOpen(true);
  }

  return (
    <>
      <PageHeader
        title="Tareas"
        description={`${filtered.length} tarea(s) visible(s)`}
        actions={
          <>
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setView("list")}
                className={cn(
                  "px-3 h-9 text-sm flex items-center gap-1.5",
                  view === "list" ? "bg-primary text-primary-fg" : "hover:bg-muted"
                )}
              >
                <LayoutList size={14} /> Lista
              </button>
              <button
                onClick={() => setView("kanban")}
                className={cn(
                  "px-3 h-9 text-sm flex items-center gap-1.5",
                  view === "kanban" ? "bg-primary text-primary-fg" : "hover:bg-muted"
                )}
              >
                <KanbanSquare size={14} /> Kanban
              </button>
            </div>
            <Button onClick={openCreate}>
              <Plus size={16} /> Nueva tarea
            </Button>
          </>
        }
      />

      {/* Filtros */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <div className="md:col-span-2 relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none"
          />
          <Input
            placeholder="Buscar tareas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">Todas las categorías</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="">Todas las prioridades</option>
          <option value="critical">Crítica</option>
          <option value="high">Alta</option>
          <option value="medium">Media</option>
          <option value="low">Baja</option>
        </Select>
      </div>

      {view === "list" ? (
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
                  <TaskRow
                    key={t.id}
                    task={t}
                    onToggle={() => toggleStatus(t)}
                    onEdit={() => openEdit(t)}
                    onDelete={() => handleDelete(t.id)}
                  />
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
                    className={cn(
                      "rounded-xl border border-border bg-muted/30 p-3 min-h-[300px]",
                      snapshot.isDraggingOver && "bg-muted"
                    )}
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
                              className={cn(
                                "bg-surface border border-border rounded-lg p-3 shadow-soft cursor-grab",
                                snap.isDragging && "rotate-1 shadow-lg"
                              )}
                              onClick={() => openEdit(t)}
                            >
                              <div className="flex items-start gap-2">
                                {t.category && (
                                  <span
                                    className="h-2 w-2 mt-1.5 rounded-full shrink-0"
                                    style={{ background: t.category.color }}
                                  />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{t.title}</div>
                                  {t.dueDate && (
                                    <div className="text-xs text-subtle flex items-center gap-1 mt-1">
                                      <CalendarIcon size={11} />
                                      {relativeDay(t.dueDate)}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center justify-between mt-2 gap-2">
                                <Badge className={priorityColor(t.priority)}>
                                  {priorityLabel(t.priority)}
                                </Badge>
                                {t.progress > 0 && (
                                  <span className="text-xs text-subtle">{t.progress}%</span>
                                )}
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

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Editar tarea" : "Nueva tarea"}
        size="lg"
      >
        <TaskForm
          task={editing}
          categories={categories.data ?? []}
          tags={tags.data ?? []}
          onSaved={() => {
            setDialogOpen(false);
            tasks.reload();
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
  const overdue = isOverdue(task.dueDate, task.status);
  return (
    <motion.div
      layout
      className="flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors"
    >
      <button
        onClick={onToggle}
        className={cn(
          "h-5 w-5 rounded-full border-2 shrink-0 transition-colors",
          task.status === "completed"
            ? "bg-success border-success"
            : "border-border hover:border-primary"
        )}
        aria-label="Marcar"
      >
        {task.status === "completed" && (
          <svg viewBox="0 0 24 24" className="w-full h-full text-white p-0.5">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 12l5 5L20 7"
            />
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
        <div
          className={cn(
            "font-medium text-sm",
            task.status === "completed" && "line-through text-subtle"
          )}
        >
          {task.title}
        </div>
        <div className="text-xs text-subtle flex items-center gap-2 mt-0.5 flex-wrap">
          {task.category && (
            <span className="flex items-center gap-1">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: task.category.color }}
              />
              {task.category.name}
            </span>
          )}
          {task.dueDate && (
            <span className={cn("flex items-center gap-1", overdue && "text-danger")}>
              <Clock size={11} /> {formatDate(task.dueDate)}
              {task.dueTime && ` · ${task.dueTime}`}
            </span>
          )}
          {task.tags.map((t) => (
            <Badge key={t.id} color={t.color}>
              {t.name}
            </Badge>
          ))}
        </div>
        {task.progress > 0 && task.status !== "completed" && (
          <Progress value={task.progress} className="mt-2 h-1.5" />
        )}
      </div>
      <Badge className={priorityColor(task.priority)}>{priorityLabel(task.priority)}</Badge>
      <button onClick={onEdit} className="text-subtle hover:text-text p-1.5 rounded-md hover:bg-muted">
        <Edit3 size={14} />
      </button>
      <button onClick={onDelete} className="text-subtle hover:text-danger p-1.5 rounded-md hover:bg-muted">
        <Trash2 size={14} />
      </button>
    </motion.div>
  );
}
