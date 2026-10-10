import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";
import type { EventInput } from "@fullcalendar/core";
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
import { expandEvent, describeRecurrence, FREQ_LABEL, recurrenceError } from "@/services/events/recurrence";
import { cn, fromLocalInput, toLocalInput } from "@/lib/utils";
import type { Category, Event, EventRecurrence, HabitDayProgress, HabitOccurrence, OccurrenceStatus, Task } from "@/types";

/** Símbolo por estado: el color no es la única pista (accesibilidad). */
const STATUS_ICON: Record<OccurrenceStatus, string> = {
  scheduled: "•",
  pending: "○",
  in_progress: "▶",
  completed: "✓",
  partial: "◐",
  missed: "✗",
};

const EVENT_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#64748b"];

/** Lunes primero, como el calendario. */
const WEEK_DAYS: [number, string, string][] = [
  [1, "L", "Lunes"],
  [2, "M", "Martes"],
  [3, "X", "Miércoles"],
  [4, "J", "Jueves"],
  [5, "V", "Viernes"],
  [6, "S", "Sábado"],
  [0, "D", "Domingo"],
];

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
    // Los eventos repetidos se expanden solo para el rango visible.
    const from = visible ? new Date(visible.from) : null;
    const to = visible ? new Date(visible.to) : null;
    const evs = (events.data ?? []).flatMap((e): EventInput[] => {
      const color = e.color ?? e.category?.color ?? "#6366f1";
      const base = {
        allDay: e.allDay,
        backgroundColor: color,
        borderColor: color,
        extendedProps: { kind: "event", ref: e },
      };
      if (!e.recurrence) return [{ ...base, id: `e:${e.id}`, title: e.title, start: e.start, end: e.end }];
      if (!from || !to) return [];
      // Arrastrar una ocurrencia movería toda la serie: se edita desde el formulario.
      return expandEvent(e, from, to).map((o, i) => ({
        ...base,
        id: `e:${e.id}:${i}`,
        title: `${e.title} ↻`,
        start: o.start,
        end: o.end,
        editable: false,
      }));
    });
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
  }, [events.data, tasks.data, occurrences.data, visible?.from, visible?.to]);

  const [errors, setErrors] = useState<{ title?: string; start?: string; end?: string; recurrence?: string }>({});
  const rec = editing.recurrence ?? null;
  const setRec = (patch: Partial<EventRecurrence> | null) =>
    setEditing((cur) => ({
      ...cur,
      recurrence: patch === null ? null : { ...(cur.recurrence ?? { freq: "weekly", interval: 1 }), ...patch },
    }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const next = {
      title: editing.title?.trim() ? undefined : "El título es obligatorio.",
      start: editing.start ? undefined : "Indica la fecha de inicio.",
      end: editing.end ? undefined : "Indica la fecha de fin.",
    };
    if (!next.start && !next.end) next.end = eventRangeError(editing) ?? undefined;
    const recurrence = recurrenceError(editing) ?? undefined;
    setErrors({ ...next, recurrence });
    if (next.title || next.start || next.end || recurrence) return;
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
        recurrence: editing.recurrence ?? null,
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
          <Field label="Color">
            <div className="flex gap-2 flex-wrap items-center">
              <button
                type="button"
                onClick={() => setEditing({ ...editing, color: null })}
                className={cn("h-8 px-2.5 rounded-full border text-xs", !editing.color ? "border-text font-medium" : "border-border text-subtle")}
                aria-pressed={!editing.color}
                title="Usa el color de la categoría"
              >
                Auto
              </button>
              {EVENT_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setEditing({ ...editing, color: c })}
                  className={cn("h-8 w-8 rounded-full border-2 transition-transform", editing.color === c ? "border-text scale-110" : "border-transparent")}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                  aria-pressed={editing.color === c}
                />
              ))}
              <Input
                type="color"
                aria-label="Color personalizado"
                title="Color personalizado"
                value={editing.color ?? "#6366f1"}
                onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                className="w-12 h-8 p-1"
              />
            </div>
          </Field>
          <Field label="Repetición" error={errors.recurrence} hint={rec ? describeRecurrence(rec) : undefined}>
            <Select
              value={rec?.freq ?? ""}
              onChange={(e) => {
                const freq = e.target.value as EventRecurrence["freq"] | "";
                if (!freq) return setRec(null);
                // Días específicos parte del día de la semana del inicio.
                const startDay = editing.start ? new Date(editing.start).getDay() : new Date().getDay();
                setRec({ freq, daysOfWeek: freq === "days" ? (rec?.daysOfWeek?.length ? rec.daysOfWeek : [startDay]) : undefined });
              }}
            >
              <option value="">No se repite</option>
              {(Object.keys(FREQ_LABEL) as EventRecurrence["freq"][]).map((f) => (
                <option key={f} value={f}>
                  {FREQ_LABEL[f]}
                </option>
              ))}
            </Select>
          </Field>
          {rec && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              {rec.freq === "days" && (
                <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Días de la semana">
                  {WEEK_DAYS.map(([n, short, long]) => {
                    const on = rec.daysOfWeek?.includes(n) ?? false;
                    return (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={on}
                        aria-label={long}
                        title={long}
                        onClick={() => {
                          const cur = rec.daysOfWeek ?? [];
                          setRec({ daysOfWeek: on ? cur.filter((x) => x !== n) : [...cur, n].sort() });
                        }}
                        className={cn("h-9 w-9 rounded-lg border text-sm font-medium", on ? "bg-primary text-primary-fg border-primary" : "border-border hover:bg-muted")}
                      >
                        {short}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label={rec.freq === "daily" ? "Cada (días)" : rec.freq === "monthly" ? "Cada (meses)" : "Cada (semanas)"}>
                  <Input
                    type="number"
                    min={1}
                    max={52}
                    value={rec.interval ?? 1}
                    onChange={(e) => setRec({ interval: Math.max(1, Math.min(52, Math.floor(Number(e.target.value)) || 1)) })}
                  />
                </Field>
                <Field label="Hasta (opcional)">
                  <Input
                    type="date"
                    min={editing.start ? localToday(new Date(editing.start)) : undefined}
                    value={rec.until ?? ""}
                    onChange={(e) => setRec({ until: e.target.value || null })}
                  />
                </Field>
              </div>
            </div>
          )}
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
