import { useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";
import toast from "react-hot-toast";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { useResource } from "@/hooks/useResource";
import { api } from "@/services/api";
import type { Category, Event, Task } from "@/types";

export function CalendarPage() {
  const events = useResource(() => api.get<Event[]>("/events"));
  const tasks = useResource(() => api.get<Task[]>("/tasks"));
  const categories = useResource(() => api.get<Category[]>("/categories"));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Event> & { id?: string }>({});

  const items = useMemo(() => {
    const evs = (events.data ?? []).map((e) => ({
      id: `e:${e.id}`,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      backgroundColor: e.color ?? e.category?.color ?? "#6366f1",
      extendedProps: { kind: "event", ref: e },
    }));
    const ts = (tasks.data ?? [])
      .filter((t) => t.dueDate)
      .map((t) => ({
        id: `t:${t.id}`,
        title: `📋 ${t.title}`,
        start: t.dueDate!,
        allDay: !t.dueTime,
        backgroundColor: t.category?.color ?? "#94a3b8",
        extendedProps: { kind: "task", ref: t },
      }));
    return [...evs, ...ts];
  }, [events.data, tasks.data]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing.title || !editing.start || !editing.end) return;
    try {
      const payload = {
        title: editing.title,
        description: editing.description ?? null,
        start: editing.start,
        end: editing.end,
        allDay: editing.allDay ?? false,
        color: editing.color ?? null,
        location: editing.location ?? null,
        categoryId: editing.categoryId || null,
      };
      if (editing.id) {
        await api.put(`/events/${editing.id}`, payload);
        toast.success("Evento actualizado");
      } else {
        await api.post(`/events`, payload);
        toast.success("Evento creado");
      }
      setOpen(false);
      events.reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function remove() {
    if (!editing.id || !confirm("¿Eliminar este evento?")) return;
    await api.delete(`/events/${editing.id}`);
    toast.success("Evento eliminado");
    setOpen(false);
    events.reload();
  }

  return (
    <>
      <PageHeader
        title="Calendario"
        description="Tareas y eventos en un solo lugar."
        actions={
          <Button
            onClick={() => {
              const now = new Date();
              const end = new Date(now.getTime() + 60 * 60 * 1000);
              setEditing({ start: now.toISOString(), end: end.toISOString(), allDay: false });
              setOpen(true);
            }}
          >
            <Plus size={16} /> Nuevo evento
          </Button>
        }
      />

      <Card className="p-4">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locales={[esLocale]}
          locale="es"
          firstDay={1}
          height="auto"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
          }}
          buttonText={{
            today: "Hoy",
            month: "Mes",
            week: "Semana",
            day: "Día",
            list: "Agenda",
          }}
          events={items}
          editable
          selectable
          select={(info) => {
            setEditing({
              start: info.startStr,
              end: info.endStr,
              allDay: info.allDay,
            });
            setOpen(true);
          }}
          eventClick={(info) => {
            const ev = info.event.extendedProps as any;
            if (ev.kind === "event") {
              const e = ev.ref as Event;
              setEditing({
                ...e,
                start: new Date(e.start).toISOString(),
                end: new Date(e.end).toISOString(),
              });
              setOpen(true);
            }
          }}
          eventDrop={async (info) => {
            const props = info.event.extendedProps as any;
            try {
              if (props.kind === "event") {
                await api.put(`/events/${props.ref.id}`, {
                  start: info.event.start!.toISOString(),
                  end: info.event.end!.toISOString(),
                });
              } else if (props.kind === "task") {
                await api.put(`/tasks/${props.ref.id}`, {
                  dueDate: info.event.start!.toISOString(),
                });
              }
              events.reload();
              tasks.reload();
            } catch (e: any) {
              toast.error(e.message);
              info.revert();
            }
          }}
        />
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing.id ? "Editar evento" : "Nuevo evento"}
      >
        <form onSubmit={save} className="space-y-3">
          <Field label="Título">
            <Input
              autoFocus
              required
              value={editing.title ?? ""}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Inicio">
              <Input
                type="datetime-local"
                required
                value={editing.start ? editing.start.slice(0, 16) : ""}
                onChange={(e) =>
                  setEditing({ ...editing, start: new Date(e.target.value).toISOString() })
                }
              />
            </Field>
            <Field label="Fin">
              <Input
                type="datetime-local"
                required
                value={editing.end ? editing.end.slice(0, 16) : ""}
                onChange={(e) =>
                  setEditing({ ...editing, end: new Date(e.target.value).toISOString() })
                }
              />
            </Field>
          </div>
          <Field label="Categoría">
            <Select
              value={editing.categoryId ?? ""}
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
          <Field label="Descripción">
            <Textarea
              value={editing.description ?? ""}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </Field>
          <div className="flex justify-between pt-2">
            {editing.id ? (
              <Button type="button" variant="danger" onClick={remove}>
                Eliminar
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit">{editing.id ? "Guardar" : "Crear"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
