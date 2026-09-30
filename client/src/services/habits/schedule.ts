// Programación horaria de hábitos. Se guardan REGLAS (HabitScheduleRow) y las
// ocurrencias se calculan al vuelo para el rango visible: un hábito semanal
// no llena la base de eventos futuros y editar la regla actualiza todas sus
// ocurrencias sin buscar duplicados.

import { z } from "zod";
import {
  localDateKey,
  type HabitLogRow,
  type HabitRow,
  type HabitScheduleRow,
} from "@/services/localDb";
import { logTarget, logsByDay } from "./progress";

/* ------------------------------------------------------------ zonas horarias */

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Zona horaria del dispositivo (o UTC si el navegador no la expone). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Fecha y hora de pared de un instante en `tz`. */
export function wallClock(instant: Date, tz: string): { dateKey: string; time: string } {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(instant)) parts[p.type] = p.value;
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return { dateKey: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` };
}

function offsetMs(tz: string, instantMs: number): number {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(new Date(instantMs))) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Instante UTC de una fecha+hora de pared en `tz`. Dos pasadas: resuelve bien
 * los días de cambio de horario (si la hora no existe, se desplaza a la
 * siguiente válida, como hace Google Calendar).
 */
export function zonedToUtc(dateKey: string, time: string, tz: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = offsetMs(tz, guess);
  let t = guess - off1;
  const off2 = offsetMs(tz, t);
  if (off2 !== off1) t = guess - off2;
  return new Date(t);
}

/* ------------------------------------------------------------ fechas día */

const DAY = 86400000;

export function keyToUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function utcToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(key: string, n: number): string {
  return utcToKey(keyToUtc(key) + n * DAY);
}

/** 0 = domingo … 6 = sábado. */
export function dowOf(key: string): number {
  return new Date(keyToUtc(key)).getUTCDay();
}

/** Lunes de la semana de `key` (semana ISO / WKST=MO, como Google). */
function mondayOf(key: string): number {
  const ms = keyToUtc(key);
  const dow = (new Date(ms).getUTCDay() + 6) % 7;
  return ms - dow * DAY;
}

/* -------------------------------------------------------------- validación */

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export const scheduleInputSchema = z
  .object({
    id: z.string().min(1).max(128).optional(),
    kind: z.enum(["once", "recurring"]),
    freq: z.enum(["daily", "weekly", "monthly"]).optional(),
    interval: z.number().int().min(1).max(52).optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    startTime: z.string().regex(timeRe, "Hora de inicio inválida (HH:mm)"),
    endTime: z.string().regex(timeRe, "Hora de fin inválida (HH:mm)").nullable().optional(),
    startDate: z.string().regex(dateRe, "Fecha inválida (AAAA-MM-DD)"),
    endDate: z.string().regex(dateRe, "Fecha inválida (AAAA-MM-DD)").nullable().optional(),
    timezone: z.string().max(64).optional(),
    active: z.boolean().optional(),
  })
  .refine((s) => !s.endTime || s.endTime > s.startTime, {
    message: "La hora de fin debe ser posterior a la de inicio",
    path: ["endTime"],
  })
  .refine((s) => s.kind === "once" || !s.endDate || s.endDate >= s.startDate, {
    message: "La fecha de finalización no puede ser anterior a la de inicio",
    path: ["endDate"],
  })
  .refine((s) => !s.timezone || isValidTimeZone(s.timezone), {
    message: "Zona horaria desconocida",
    path: ["timezone"],
  })
  .refine((s) => s.kind !== "recurring" || (s.freq ?? "weekly") !== "weekly" || (s.daysOfWeek ?? []).length > 0, {
    message: "Elige al menos un día de la semana",
    path: ["daysOfWeek"],
  });

export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

/** Normaliza una entrada validada a los campos de la fila. */
export function normalizeSchedule(input: ScheduleInput): Omit<
  HabitScheduleRow,
  "id" | "habitId" | "createdAt" | "updatedAt" | "inactiveFrom"
> {
  const once = input.kind === "once";
  return {
    kind: input.kind,
    freq: once ? "daily" : input.freq ?? "weekly",
    interval: once ? 1 : input.interval ?? 1,
    daysOfWeek: once ? [] : [...new Set(input.daysOfWeek ?? [])].sort(),
    startTime: input.startTime,
    endTime: input.endTime ?? null,
    startDate: input.startDate,
    endDate: once ? null : input.endDate ?? null,
    timezone: input.timezone ?? deviceTimeZone(),
    active: input.active ?? true,
  };
}

/** Campos que definen CUÁNDO ocurre: si cambian, las ocurrencias cambian. */
export const TIMING_FIELDS = [
  "kind",
  "freq",
  "interval",
  "daysOfWeek",
  "startTime",
  "endTime",
  "timezone",
] as const satisfies readonly (keyof HabitScheduleRow)[];

export function timingChanged(a: HabitScheduleRow, b: Partial<HabitScheduleRow>): boolean {
  return TIMING_FIELDS.some((f) => b[f] !== undefined && JSON.stringify(a[f]) !== JSON.stringify(b[f]));
}

/* ------------------------------------------------------------- expansión */

/** Último día (incluido) en que la regla puede generar ocurrencias. */
export function lastActiveDay(s: HabitScheduleRow): string | null {
  if (s.kind === "once") return s.startDate;
  const ends: string[] = [];
  if (s.endDate) ends.push(s.endDate);
  if (!s.active) ends.push(s.inactiveFrom ? addDays(s.inactiveFrom, -1) : addDays(s.startDate, -1));
  return ends.length ? ends.sort()[0] : null;
}

/** ¿La regla produce una ocurrencia el día `key` (en su zona)? */
export function occursOn(s: HabitScheduleRow, key: string): boolean {
  if (key < s.startDate) return false;
  const last = lastActiveDay(s);
  if (last && key > last) return false;
  if (s.kind === "once") return key === s.startDate;
  const n = Math.max(1, s.interval);
  switch (s.freq) {
    case "daily":
      return Math.round((keyToUtc(key) - keyToUtc(s.startDate)) / DAY) % n === 0;
    case "weekly": {
      const days = s.daysOfWeek.length ? s.daysOfWeek : [dowOf(s.startDate)];
      if (!days.includes(dowOf(key))) return false;
      const weeks = Math.round((mondayOf(key) - mondayOf(s.startDate)) / (7 * DAY));
      return weeks % n === 0;
    }
    case "monthly": {
      const [sy, sm, sd] = s.startDate.split("-").map(Number);
      const [y, m, d] = key.split("-").map(Number);
      if (d !== sd) return false;
      return ((y - sy) * 12 + (m - sm)) % n === 0;
    }
  }
  return false;
}

export interface Occurrence {
  /** `scheduleId@YYYY-MM-DD`: estable, sirve de clave sin guardar nada. */
  id: string;
  scheduleId: string;
  habitId: string;
  /** Día en la zona de la programación. */
  dateKey: string;
  start: string;
  end: string | null;
  recurring: boolean;
}

/** Duración que se asume cuando la programación no tiene hora de fin. */
export const DEFAULT_DURATION_MIN = 30;

export function expandSchedule(s: HabitScheduleRow, from: Date, to: Date): Occurrence[] {
  const out: Occurrence[] = [];
  // Un día de margen a cada lado: el rango llega en la zona del dispositivo.
  let key = wallClock(new Date(from.getTime() - DAY), s.timezone).dateKey;
  const lastKey = wallClock(new Date(to.getTime() + DAY), s.timezone).dateKey;
  if (key < s.startDate) key = s.startDate;
  const ruleEnd = lastActiveDay(s);
  const stop = ruleEnd && ruleEnd < lastKey ? ruleEnd : lastKey;
  // Tope defensivo: nunca más de ~3 años de días por regla y consulta.
  for (let i = 0; key <= stop && i < 1200; i++, key = addDays(key, 1)) {
    if (!occursOn(s, key)) continue;
    const start = zonedToUtc(key, s.startTime, s.timezone);
    const end = s.endTime ? zonedToUtc(key, s.endTime, s.timezone) : null;
    if ((end ?? start).getTime() < from.getTime() || start.getTime() > to.getTime()) continue;
    out.push({
      id: `${s.id}@${key}`,
      scheduleId: s.id,
      habitId: s.habitId,
      dateKey: key,
      start: start.toISOString(),
      end: end ? end.toISOString() : null,
      recurring: s.kind === "recurring",
    });
  }
  return out;
}

/* ---------------------------------------------------------------- estados */

export type OccurrenceStatus =
  | "scheduled"
  | "pending"
  | "in_progress"
  | "completed"
  | "partial"
  | "missed";

export interface CalendarOccurrence extends Occurrence {
  status: OccurrenceStatus;
  /** Día local (dispositivo) al que pertenece el registro de realizaciones. */
  logDate: string;
  count: number;
  target: number;
  /** Veces necesarias para dar por hecha ESTA franja (varias horas al día). */
  threshold: number;
}

/**
 * Estado de cada ocurrencia a partir del REGISTRO de realizaciones, nunca del
 * mero hecho de estar programada. Con varias franjas en un día, la meta se
 * reparte: con 8 vasos y 8 horas, la franja k queda hecha al llegar a k+1.
 */
export function withStatus(
  occurrences: Occurrence[],
  habits: HabitRow[],
  logs: HabitLogRow[],
  now = new Date()
): CalendarOccurrence[] {
  const habitById = new Map(habits.map((h) => [h.id, h]));
  const logIndex = new Map<string, Map<string, HabitLogRow>>();
  const logsOf = (habitId: string) => {
    let m = logIndex.get(habitId);
    if (!m) {
      m = logsByDay(logs.filter((l) => l.habitId === habitId));
      logIndex.set(habitId, m);
    }
    return m;
  };

  const groups = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const k = `${o.habitId}|${localDateKey(new Date(o.start))}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }

  const todayKey = localDateKey(now);
  const out: CalendarOccurrence[] = [];
  for (const [k, group] of groups) {
    const [habitId, logDate] = k.split("|");
    const habit = habitById.get(habitId);
    if (!habit) continue;
    const log = logsOf(habitId).get(logDate);
    const count = log?.count ?? 0;
    const target = log ? logTarget(log, habit) : Math.max(1, habit.dailyTarget);
    const sorted = [...group].sort((a, b) => a.start.localeCompare(b.start));
    sorted.forEach((o, idx) => {
      const threshold = Math.max(1, Math.ceil(((idx + 1) * target) / sorted.length));
      const startMs = new Date(o.start).getTime();
      const endMs = o.end ? new Date(o.end).getTime() : startMs + DEFAULT_DURATION_MIN * 60000;
      let status: OccurrenceStatus;
      if (count >= threshold) status = "completed";
      else if (logDate < todayKey) status = count > 0 ? "partial" : "missed";
      else if (now.getTime() >= startMs && now.getTime() <= endMs) status = "in_progress";
      else if (logDate > todayKey) status = "scheduled";
      else status = count > 0 ? "partial" : "pending";
      out.push({ ...o, status, logDate, count, target, threshold });
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export const STATUS_LABEL: Record<OccurrenceStatus, string> = {
  scheduled: "Programado",
  pending: "Pendiente",
  in_progress: "En curso",
  completed: "Completado",
  partial: "Parcial",
  missed: "Incumplido",
};

/* -------------------------------------------------------------- resumen */

const DOW_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** Texto breve de una programación: "Lun, Mié, Vie · 20:00–20:30". */
export function describeSchedule(s: Pick<HabitScheduleRow, "kind" | "freq" | "interval" | "daysOfWeek" | "startTime" | "endTime" | "startDate">): string {
  const time = s.endTime ? `${s.startTime}–${s.endTime}` : s.startTime;
  if (s.kind === "once") {
    const [y, m, d] = s.startDate.split("-");
    return `${d}/${m}/${y} · ${time}`;
  }
  const every = s.interval > 1 ? ` (cada ${s.interval})` : "";
  if (s.freq === "daily") return `${s.interval > 1 ? `Cada ${s.interval} días` : "Todos los días"} · ${time}`;
  if (s.freq === "monthly") return `Día ${Number(s.startDate.slice(8))} de cada mes${every} · ${time}`;
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => s.daysOfWeek.includes(d)).map((d) => DOW_SHORT[d]);
  return `${days.join(", ")}${s.interval > 1 ? ` · cada ${s.interval} semanas` : ""} · ${time}`;
}
