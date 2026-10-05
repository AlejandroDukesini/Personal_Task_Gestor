import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";
import toast from "react-hot-toast";
import { ExternalLink, Plus, Repeat } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { useResource } from "@/hooks/useResource";
import { api } from "@/services/api";
import { HabitCounter } from "@/components/habits/HabitCounter";
import { STATUS_LABEL } from "@/services/habits/schedule";
import { eventRangeError, localToday } from "@/services/rules";
import { fromLocalInput, toLocalInput } from "@/lib/utils";
import type { Category, Event, HabitDayProgress, HabitOccurrence, OccurrenceStatus, Task } from "@/types";

/** Símbolo por estado: el color no es la única pista (accesibilidad). */
const STATUS_ICON: Record<OccurrenceStatus, string> = {
  scheduled: "•",
  pending: "○",
  in_progress: "▶",
  completed: "✓",
  partial: "◐",
  missed: "✗",
};

function localDayIso(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toISOString();
}

export function CalendarPage() {
  const events = useResource(() => api.get<Event[]>("/events"));
  const tasks = useResource(() => api.get<Task[]>("/tasks"));
  const categories = useResource(() => api.get<Category[]>("/categories"));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Event> & { id?: string }>({});
  // Rango visible: las ocurrencias de hábitos se calculan solo para él.
  const [visible, setVisible] = useState<{ from: string; to: string } | null>(null);
  const occurrences = useResource(
    () => (visible ? api.get<HabitOccurrence[]>(`/habits/calendar?from=${encodeURIComponent(visible.from)}&to=${encodeURIComponent(visible.to)}`) : Promise.resolve([])),
    [visible?.from, visible?.to]
  );
  const [quick, setQuick] = useState<{ occ: HabitOccurrence; progress: HabitDayProgress | null } | null>(null);
  const navigate = useNavigate();

  // Los estados "en curso"/"pendiente" dependen de la hora: se refrescan cada minuto.
  useEffect(() => {
    const t = setInterval(() => occurrences.reload(), 60_000);
    return () => clearInterval(t);
  }, [occurrences.reload]);

  async function openQuick(occ: HabitOccurrence) {
    setQuick({ occ, progress: null });
    try {
      const p = await api.get<HabitDayProgress>(`/habits/${occ.habitId}/progress?date=${encodeURIComponent(localDayIso(occ.logDate))}`);
      setQuick({ occ, progress: p });
    } catch (e: any) {
      toast.error(e.message);
      setQuick(null);
    }
  }

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
        // Día local de vencimiento (+ hora si la tiene), no la medianoche UTC.
        start: t.dueTime ? `${t.dueDate!.slice(0, 10)}T${t.dueTime}` : t.dueDate!.slice(0, 10),
        allDay: !t.dueTime,
        backgroundColor: t.category?.color ?? "#94a3b8",
        extendedProps: { kind: "task", ref: t },
      }));
    const hs = (occurrences.data ?? []).map((o) => {
      const end = o.end ?? new Date(new Date(o.start).getTime() + 30 * 60000).toISOString();
      const counter = o.target > 1 ? ` (${o.count}/${o.target})` : "";
      return {
        id: `h:${o.id}`,
        title: `${STATUS_ICON[o.status]} ${o.habit.name}${counter}${o.recurring ? " ↻" : ""}`,
        start: o.start,
        end,
        allDay: false,
        editable: false,
        backgroundColor: o.habit.color,
        borderColor: o.status === "missed" ? "#dc2626" : o.habit.color,
        classNames: ["gt-habit", `gt-habit-${o.status}`],
        extendedProps: { kind: "habit", ref: o },
      };
    });
    return [...evs, ...ts, ...hs];
  }, [events.data, tasks.data, occurrences.data]);

  const [errors, setErrors] = useState<{ title?: string; start?: string; end?: string }>({});

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const next = {
      title: editing.title?.trim() ? undefined : "El título es obligatorio.",
      start: editing.start ? undefined : "Indica la fecha de inicio.",
      end: editing.end ? undefined : "Indica la fecha de fin.",
    };
    if (!next.start && !next.end) next.end = eventRangeError(editing) ?? undefined;
    setErrors(next);
    if (next.title || next.start || next.end) return;
    try {
      const payload = {
        title: editing.title!.trim(),
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
        description="Tareas, eventos y hábitos programados en un solo lugar."
        actions={
          <Button
            onClick={() => {
              const now = new Date();
              const end = new Date(now.getTime() + 60 * 60 * 1000);
              setEditing({ start: now.toISOString(), end: end.toISOString(), allDay: false });
              setErrors({});
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
          datesSet={(info) => {
            const next = { from: info.start.toISOString(), to: info.end.toISOString() };
            setVisible((cur) => (cur && cur.from === next.from && cur.to === next.to ? cur : next));
          }}
          editable
          selectable
          select={(info) => {
            // Date -> ISO: `startStr` de un día completo ("2026-10-05") se
            // leería como medianoche UTC, es decir, la víspera en América.
            setEditing({
              start: info.start.toISOString(),
              end: info.end.toISOString(),
              allDay: info.allDay,
            });
            setErrors({});
            setOpen(true);
          }}
          eventClick={(info) => {
            const ev = info.event.extendedProps as any;
            if (ev.kind === "habit") {
              openQuick(ev.ref as HabitOccurrence);
              return;
            }
            if (ev.kind === "event") {
              const e = ev.ref as Event;
              setEditing({
                ...e,
                start: new Date(e.start).toISOString(),
                end: new Date(e.end).toISOString(),
              });
              setErrors({});
              setOpen(true);
            }
          }}
          eventDrop={async (info) => {
            const props = info.event.extendedProps as any;
            try {
              const start = info.event.start!;
              if (props.kind === "event") {
                // Sin `end` (evento sin duración) se conserva la duración original.
                const ref = props.ref as Event;
                const duration = Math.max(new Date(ref.end).getTime() - new Date(ref.start).getTime(), 30 * 60000);
                const end = info.event.end ?? new Date(start.getTime() + duration);
                await api.put(`/events/${props.ref.id}`, {
                  start: start.toISOString(),
                  end: end.toISOString(),
                });
              } else if (props.kind === "task") {
                // El vencimiento es un día de calendario: se envía el día LOCAL
                // donde se soltó y, si cayó en una franja horaria, su hora.
                const pad = (n: number) => String(n).padStart(2, "0");
                await api.put(`/tasks/${props.ref.id}`, {
                  dueDate: localToday(start),
                  dueTime: info.event.allDay ? null : `${pad(start.getHours())}:${pad(start.getMinutes())}`,
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
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-subtle" aria-label="Leyenda de estados de hábitos">
          {(Object.keys(STATUS_ICON) as OccurrenceStatus[]).map((s) => (
            <span key={s}>
              {STATUS_ICON[s]} {STATUS_LABEL[s]}
            </span>
          ))}
          <span>↻ Se repite</span>
        </div>
      </Card>

      <Dialog open={!!quick} onClose={() => setQuick(null)} title={quick?.occ.habit.name ?? "Hábito"} size="sm">
        {quick && (
          <div className="space-y-4">
            <div className="text-sm space-y-1">
              <p>
                {new Date(quick.occ.start).toLocaleString("es-ES", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                {quick.occ.end && ` – ${new Date(quick.occ.end).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`}
              </p>
              <p className="text-subtle flex items-center gap-1.5">
                {STATUS_ICON[quick.occ.status]} {STATUS_LABEL[quick.occ.status]}
                {quick.occ.recurring && (
                  <>
                    · <Repeat size={12} /> se repite
                  </>
                )}
              </p>
            </div>
            {quick.progress ? (
              <HabitCounter
                habitId={quick.occ.habitId}
                color={quick.occ.habit.color}
                unit={quick.occ.habit.unit}
                progress={quick.progress}
                date={localDayIso(quick.occ.logDate)}
                source="calendar"
                onChanged={(p) => {
                  setQuick((q) => (q ? { ...q, progress: p } : q));
                  occurrences.reload();
                }}
              />
            ) : (
              <p className="text-sm text-subtle">Cargando…</p>
            )}
            <p className="text-xs text-subtle">Estar en el calendario no cuenta como hecho: registra aquí cada realización.</p>
            <Button variant="outline" className="w-full" onClick={() => navigate(`/habitos?h=${quick.occ.habitId}`)}>
              <ExternalLink size={14} /> Abrir el hábito
            </Button>
          </div>
        )}
      </Dialog>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing.id ? "Editar evento" : "Nuevo evento"}
      >
        <form onSubmit={save} className="space-y-3">
          <Field label="Título" error={errors.title}>
            <Input
              autoFocus
              required
              value={editing.title ?? ""}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Inicio" error={errors.start}>
              <Input
                type="datetime-local"
                required
                value={toLocalInput(editing.start)}
                onChange={(e) => setEditing({ ...editing, start: fromLocalInput(e.target.value) })}
              />
            </Field>
            <Field label="Fin" error={errors.end}>
              <Input
                type="datetime-local"
                required
                min={toLocalInput(editing.start) || undefined}
                value={toLocalInput(editing.end)}
                onChange={(e) => setEditing({ ...editing, end: fromLocalInput(e.target.value) })}
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
