import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CalendarDays, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Field, Input, Select } from "@/components/ui/Input";
import { SidePanel } from "@/components/ui/SidePanel";
import { errorMessage } from "@/components/finance/shared";
import { api } from "@/services/api";
import { ApiError, newId, type AcadClassRow, type AcadSubjectRow } from "@/services/localDb";
import { conflictsFor, DAY_LABELS, DAY_SHORT, layoutDay, toMinutes, weeklyHours } from "@/services/academic/logic";
import { readableOn } from "@/services/notes/icons";
import { cn } from "@/lib/utils";
import type { AcademicState } from "./shared";

const HOUR_PX = 48;

/**
 * Horario semanal: una columna por día y las clases colocadas según su hora.
 * Las posiciones se calculan a partir de los minutos (nada fijo), y las clases
 * que se solapan se reparten en carriles y se marcan en rojo.
 */
export function ScheduleView({ data, reload, onGoTab }: { data: AcademicState; reload: () => void; onGoTab: (tab: string) => void }) {
  const [editing, setEditing] = useState<AcadClassRow | { day: number } | null>(null);
  const subjects = useMemo(() => new Map(data.subjects.map((s) => [s.id, s])), [data.subjects]);
  const conflicts = useMemo(() => new Set(data.conflicts), [data.conflicts]);

  // Días visibles: lunes a sábado siempre; domingo solo si tiene clases.
  const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => d <= 6 || data.classes.some((c) => c.day === d));
  // Rango horario: de 7 a 19 por defecto, ampliado si alguna clase se sale.
  const from = Math.min(7, ...data.classes.map((c) => Math.floor(toMinutes(c.startTime) / 60)));
  const to = Math.max(19, ...data.classes.map((c) => Math.ceil(toMinutes(c.endTime) / 60)));
  const hours = Array.from({ length: to - from }, (_, i) => from + i);

  if (data.subjects.length === 0) {
    return (
      <Card>
        <Empty icon={CalendarDays} title="Primero añade tus materias" description="Cada clase del horario pertenece a una materia del semestre." action={<Button onClick={() => onGoTab("materias")}><Plus size={16} /> Ir a materias</Button>} />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-subtle tabular-nums">
          {data.classes.length} clases · {weeklyHours(data.classes).toLocaleString("es", { maximumFractionDigits: 1 })} h a la semana
        </p>
        <Button size="sm" onClick={() => setEditing({ day: 1 })}>
          <Plus size={14} /> Nueva clase
        </Button>
      </div>

      {conflicts.size > 0 && (
        <div role="alert" className="gt-surface p-3 flex items-start gap-2 text-sm border-l-4 border-l-danger">
          <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" aria-hidden />
          <span>Hay {conflicts.size} clases que se solapan (marcadas en rojo). Revisa sus horas.</span>
        </div>
      )}

      <div className="gt-surface overflow-x-auto">
        <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="border-b border-border" />
          {days.map((d) => (
            <button key={d} onClick={() => setEditing({ day: d })} className="h-10 text-sm font-medium border-b border-l border-border hover:bg-muted" title={`Añadir clase el ${DAY_LABELS[d].toLowerCase()}`}>
              <span className="hidden sm:inline">{DAY_LABELS[d]}</span>
              <span className="sm:hidden">{DAY_SHORT[d]}</span>
            </button>
          ))}

          <div className="relative" style={{ height: hours.length * HOUR_PX }}>
            {hours.map((h, i) => (
              <span key={h} className="absolute right-1.5 text-[10px] text-subtle tabular-nums -translate-y-1/2" style={{ top: i * HOUR_PX }}>
                {i > 0 && `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>

          {days.map((d) => {
            const dayClasses = data.classes.filter((c) => c.day === d);
            const lanes = layoutDay(dayClasses);
            return (
              <div key={d} className="relative border-l border-border" style={{ height: hours.length * HOUR_PX }}>
                {hours.map((h, i) => (
                  <div key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: i * HOUR_PX }} aria-hidden />
                ))}
                {dayClasses.map((c) => {
                  const s = subjects.get(c.subjectId);
                  const color = s?.color ?? "#64748b";
                  const l = lanes.get(c.id) ?? { lane: 0, lanes: 1 };
                  const top = ((toMinutes(c.startTime) - from * 60) / 60) * HOUR_PX;
                  const height = Math.max(22, ((toMinutes(c.endTime) - toMinutes(c.startTime)) / 60) * HOUR_PX - 2);
                  const bad = conflicts.has(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => setEditing(c)}
                      className={cn("absolute rounded-md px-1.5 py-1 text-left text-[11px] leading-tight overflow-hidden shadow-sm hover:brightness-105", bad && "ring-2 ring-danger")}
                      style={{ top, height, left: `calc(${(l.lane / l.lanes) * 100}% + 2px)`, width: `calc(${100 / l.lanes}% - 4px)`, background: color, color: readableOn(color) }}
                      title={`${s?.name ?? "Materia"} · ${c.startTime}–${c.endTime}${bad ? " · se solapa con otra clase" : ""}`}
                    >
                      <span className="font-semibold block truncate">{s?.name ?? "Materia"}</span>
                      <span className="block tabular-nums opacity-90">{c.startTime}–{c.endTime}</span>
                      {(c.room ?? s?.room) && <span className="block truncate opacity-90">{c.room ?? s?.room}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <ClassForm open={!!editing} value={editing} data={data} onClose={() => setEditing(null)} reload={reload} />
    </div>
  );
}

function ClassForm({ open, value, data, onClose, reload }: { open: boolean; value: AcadClassRow | { day: number } | null; data: AcademicState; onClose: () => void; reload: () => void }) {
  const existing = value && "id" in value ? value : null;
  const [form, setForm] = useState({ subjectId: "", day: 1, startTime: "08:00", endTime: "10:00", professor: "", room: "" });
  const [busy, setBusy] = useState(false);
  const idRef = useRef(newId());

  useEffect(() => {
    if (!open || !value) return;
    idRef.current = newId();
    setForm(
      existing
        ? { subjectId: existing.subjectId, day: existing.day, startTime: existing.startTime, endTime: existing.endTime, professor: existing.professor ?? "", room: existing.room ?? "" }
        : { subjectId: data.subjects[0]?.id ?? "", day: value.day, startTime: "08:00", endTime: "10:00", professor: "", room: "" }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  const subject: AcadSubjectRow | undefined = data.subjects.find((s) => s.id === form.subjectId);
  const timeError = form.startTime && form.endTime && toMinutes(form.endTime) <= toMinutes(form.startTime) ? "La hora de finalización debe ser posterior a la de inicio" : null;
  const clashes = !timeError && data.semester ? conflictsFor({ id: existing?.id, semesterId: data.semester.id, day: form.day, startTime: form.startTime, endTime: form.endTime }, data.classes) : [];
  const valid = !!subject && !timeError && form.startTime && form.endTime;

  async function save(allowOverlap: boolean) {
    const body = { subjectId: form.subjectId, day: form.day, startTime: form.startTime, endTime: form.endTime, professor: form.professor.trim() || null, room: form.room.trim() || null, allowOverlap };
    if (existing) await api.put(`/academic/classes/${existing.id}`, body);
    else await api.post("/academic/classes", { ...body, id: idRef.current });
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      try {
        await save(false);
      } catch (err) {
        // Solape: el servidor explica con qué choca y el usuario decide.
        if (!(err instanceof ApiError && err.status === 409) || !confirm(`${err.message}.\n\n¿Guardar la clase de todas formas?`)) throw err;
        await save(true);
      }
      toast.success(existing ? "Clase actualizada" : "Clase añadida al horario");
      reload();
      onClose();
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409)) toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing || !confirm("¿Quitar esta clase del horario?")) return;
    try {
      await api.delete(`/academic/classes/${existing.id}`);
      toast.success("Clase eliminada");
      reload();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={existing ? "Editar clase" : "Nueva clase"}
      footer={
        <>
          {existing && (
            <Button variant="ghost" className="mr-auto text-danger" onClick={remove}>
              <Trash2 size={14} /> Eliminar
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} disabled={!valid} onClick={() => submit()}>{existing ? "Guardar" : "Añadir"}</Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Materia">
          <Select value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
            {data.subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Día">
          <Select value={form.day} onChange={(e) => setForm({ ...form, day: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <option key={d} value={d}>{DAY_LABELS[d]}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Inicio">
            <Input type="time" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
          </Field>
          <Field label="Fin" error={timeError}>
            <Input type="time" required value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
          </Field>
        </div>
        {clashes.length > 0 && (
          <p role="alert" className="text-sm text-danger flex items-start gap-1.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            Se solapa con {clashes.map((c) => `${data.subjects.find((s) => s.id === c.subjectId)?.name ?? "otra clase"} (${c.startTime}–${c.endTime})`).join(", ")}.
          </p>
        )}
        <Field label="Profesor" hint={subject?.professor ? `Vacío = ${subject.professor} (el de la materia).` : "Opcional."}>
          <Input maxLength={120} value={form.professor} onChange={(e) => setForm({ ...form, professor: e.target.value })} />
        </Field>
        <Field label="Aula" hint={subject?.room ? `Vacío = ${subject.room} (la de la materia).` : "Opcional."}>
          <Input maxLength={80} value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} />
        </Field>
        <button type="submit" hidden />
      </form>
    </SidePanel>
  );
}
