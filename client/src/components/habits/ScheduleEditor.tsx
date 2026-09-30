import { useState } from "react";
import { ChevronDown, Clock, Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { deviceTimeZone, describeSchedule } from "@/services/habits/schedule";
import { localDateKey } from "@/services/localDb";
import type { HabitSchedule } from "@/types";

/** Borrador editable de una programación (sin id = nueva). */
export interface ScheduleDraft {
  id?: string;
  kind: "once" | "recurring";
  freq: "daily" | "weekly" | "monthly";
  interval: number;
  daysOfWeek: number[];
  startTime: string;
  endTime: string | null;
  startDate: string;
  endDate: string | null;
  timezone: string;
  active: boolean;
  /** Solo interfaz. */
  _key: string;
}

// Lunes primero, como en el resto de la app.
const DAYS: [number, string, string][] = [
  [1, "L", "Lunes"],
  [2, "M", "Martes"],
  [3, "X", "Miércoles"],
  [4, "J", "Jueves"],
  [5, "V", "Viernes"],
  [6, "S", "Sábado"],
  [0, "D", "Domingo"],
];

const COMMON_TZ = [
  "America/Bogota",
  "America/Mexico_City",
  "America/Lima",
  "America/Argentina/Buenos_Aires",
  "America/Santiago",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/Madrid",
  "UTC",
];

let seq = 0;
const key = () => `d${Date.now().toString(36)}${++seq}`;

export function toDraft(s: HabitSchedule): ScheduleDraft {
  return {
    id: s.id,
    kind: s.kind,
    freq: s.freq,
    interval: s.interval,
    daysOfWeek: s.daysOfWeek,
    startTime: s.startTime,
    endTime: s.endTime,
    startDate: s.startDate,
    endDate: s.endDate,
    timezone: s.timezone,
    active: s.active,
    _key: s.id,
  };
}

export function newDraft(from?: ScheduleDraft): ScheduleDraft {
  if (from) {
    // "Otro horario" copia la repetición y propone 2 h después.
    const [h, m] = from.startTime.split(":").map(Number);
    const next = `${String(Math.min(23, h + 2)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    return { ...from, id: undefined, _key: key(), startTime: next, endTime: null, active: true };
  }
  const today = new Date();
  return {
    kind: "recurring",
    freq: "weekly",
    interval: 1,
    daysOfWeek: [today.getDay()],
    startTime: "08:00",
    endTime: null,
    startDate: localDateKey(today),
    endDate: null,
    timezone: deviceTimeZone(),
    active: true,
    _key: key(),
  };
}

/** Datos que se envían a la API (sin campos de interfaz). */
export function draftToInput(d: ScheduleDraft) {
  const { _key, ...rest } = d;
  return { ...rest, endTime: rest.endTime || null, endDate: rest.kind === "once" ? null : rest.endDate || null };
}

export function validateDraft(d: ScheduleDraft): string | null {
  if (!/^\d{2}:\d{2}$/.test(d.startTime)) return "Indica la hora de inicio";
  if (d.endTime && d.endTime <= d.startTime) return "La hora de fin debe ser posterior a la de inicio";
  if (!d.startDate) return d.kind === "once" ? "Indica la fecha" : "Indica desde qué fecha se repite";
  if (d.kind === "recurring" && d.freq === "weekly" && d.daysOfWeek.length === 0) return "Elige al menos un día de la semana";
  if (d.kind === "recurring" && d.endDate && d.endDate < d.startDate) return "La fecha de fin es anterior a la de inicio";
  return null;
}

export function ScheduleEditor({ value, onChange }: { value: ScheduleDraft[]; onChange: (v: ScheduleDraft[]) => void }) {
  const [openKey, setOpenKey] = useState<string | null>(value.length === 1 ? value[0]._key : null);
  const tzOptions = [...new Set([deviceTimeZone(), ...COMMON_TZ, ...value.map((v) => v.timezone)])];

  const update = (k: string, patch: Partial<ScheduleDraft>) => onChange(value.map((d) => (d._key === k ? { ...d, ...patch } : d)));
  const remove = (k: string) => onChange(value.filter((d) => d._key !== k));
  const add = (from?: ScheduleDraft) => {
    const d = newDraft(from);
    onChange([...value, d]);
    setOpenKey(d._key);
  };

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-sm text-subtle">
          Sin horario específico. Añade uno para que el hábito aparezca en el calendario (y en Google Calendar, si lo conectas).
        </p>
      )}

      {value.map((d, i) => {
        const open = openKey === d._key;
        const error = validateDraft(d);
        return (
          <div key={d._key} className={cn("rounded-lg border border-border", !d.active && "opacity-70")}>
            <div className="flex items-center gap-2 p-2">
              <button
                type="button"
                onClick={() => setOpenKey(open ? null : d._key)}
                className="flex-1 min-w-0 flex items-center gap-2 text-left text-sm px-1 py-1 rounded-md hover:bg-muted"
                aria-expanded={open}
              >
                <Clock size={14} className="text-subtle shrink-0" />
                <span className="truncate">
                  {error ? <span className="text-danger">{error}</span> : describeSchedule(d)}
                  {!d.active && " · desactivado"}
                </span>
                <ChevronDown size={14} className={cn("ml-auto shrink-0 transition-transform", open && "rotate-180")} />
              </button>
              <button type="button" className="p-2 rounded-md text-subtle hover:bg-muted" onClick={() => add(d)} title="Añadir otro horario igual a otra hora" aria-label={`Duplicar horario ${i + 1}`}>
                <Copy size={14} />
              </button>
              <button type="button" className="p-2 rounded-md text-subtle hover:text-danger hover:bg-muted" onClick={() => remove(d._key)} title="Eliminar este horario" aria-label={`Eliminar horario ${i + 1}`}>
                <Trash2 size={14} />
              </button>
            </div>

            {open && (
              <div className="p-3 pt-1 space-y-3 border-t border-t-theme border-border">
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de horario">
                  {(
                    [
                      ["once", "Fecha concreta"],
                      ["recurring", "Se repite"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={d.kind === k}
                      onClick={() => update(d._key, { kind: k })}
                      className={cn("h-9 rounded-md border text-sm", d.kind === k ? "bg-primary text-primary-fg border-primary" : "border-border hover:bg-muted")}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {d.kind === "recurring" && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Repetición">
                        <Select value={d.freq} onChange={(e) => update(d._key, { freq: e.target.value as ScheduleDraft["freq"] })}>
                          <option value="weekly">Semanal</option>
                          <option value="daily">Diaria</option>
                          <option value="monthly">Mensual (mismo día)</option>
                        </Select>
                      </Field>
                      <Field label={d.freq === "weekly" ? "Cada (semanas)" : d.freq === "daily" ? "Cada (días)" : "Cada (meses)"}>
                        <Input type="number" min={1} max={52} value={d.interval} onChange={(e) => update(d._key, { interval: Math.max(1, Math.min(52, Number(e.target.value) || 1)) })} />
                      </Field>
                    </div>
                    {d.freq === "weekly" && (
                      <div className="space-y-1.5">
                        <span className="text-xs font-medium text-subtle uppercase tracking-wide">Días</span>
                        <div className="flex gap-1.5 flex-wrap">
                          {DAYS.map(([n, short, long]) => {
                            const on = d.daysOfWeek.includes(n);
                            return (
                              <button
                                key={n}
                                type="button"
                                aria-pressed={on}
                                aria-label={long}
                                title={long}
                                onClick={() => update(d._key, { daysOfWeek: on ? d.daysOfWeek.filter((x) => x !== n) : [...d.daysOfWeek, n].sort() })}
                                className={cn("h-9 w-9 rounded-lg border text-sm font-medium", on ? "bg-primary text-primary-fg border-primary" : "border-border hover:bg-muted")}
                              >
                                {short}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <Field label={d.kind === "once" ? "Fecha" : "Desde"}>
                    <Input type="date" required value={d.startDate} onChange={(e) => update(d._key, { startDate: e.target.value })} />
                  </Field>
                  {d.kind === "recurring" ? (
                    <Field label="Hasta (opcional)">
                      <Input type="date" value={d.endDate ?? ""} min={d.startDate} onChange={(e) => update(d._key, { endDate: e.target.value || null })} />
                    </Field>
                  ) : (
                    <span />
                  )}
                  <Field label="Hora de inicio">
                    <Input type="time" required value={d.startTime} onChange={(e) => update(d._key, { startTime: e.target.value })} />
                  </Field>
                  <Field label="Hora de fin (opcional)">
                    <Input type="time" value={d.endTime ?? ""} onChange={(e) => update(d._key, { endTime: e.target.value || null })} />
                  </Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                  <Field label="Zona horaria">
                    <Select value={d.timezone} onChange={(e) => update(d._key, { timezone: e.target.value })}>
                      {tzOptions.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz === deviceTimeZone() ? `${tz} (este dispositivo)` : tz}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <label className="flex items-center gap-2 text-sm h-9">
                    <input type="checkbox" checked={d.active} onChange={(e) => update(d._key, { active: e.target.checked })} />
                    Horario activo
                  </label>
                </div>
                {!d.active && (
                  <p className="text-xs text-subtle">
                    Desactivado: deja de aparecer desde hoy; las fechas pasadas y tu historial se conservan.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" onClick={() => add(value[value.length - 1])}>
        <Plus size={14} /> {value.length ? "Añadir otro horario" : "Añadir horario"}
      </Button>
    </div>
  );
}
