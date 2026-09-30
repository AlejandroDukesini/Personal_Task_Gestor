// Conversión entre programaciones de hábitos y eventos de Google Calendar.
// Funciones puras: sin red ni almacenamiento (se prueban aisladas).

import type { HabitRow, HabitScheduleRow } from "@/services/localDb";
import { stableHash } from "@/services/habits/hash";
import {
  DEFAULT_DURATION_MIN,
  addDays,
  dowOf,
  lastActiveDay,
  occursOn,
  wallClock,
  zonedToUtc,
  type ScheduleInput,
} from "@/services/habits/schedule";

/** Marca que identifica los eventos creados por la app: nunca se tocan otros. */
export const APP_TAG = "gestion-tareas";

export interface GcalEventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

/** Subconjunto del recurso Event de la API v3 que usa la app. */
export interface GcalEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  etag?: string;
  updated?: string;
  summary?: string;
  description?: string;
  start?: GcalEventDateTime;
  end?: GcalEventDateTime;
  recurrence?: string[];
  colorId?: string;
  extendedProperties?: { private?: Record<string, string> };
  reminders?: { useDefault: boolean };
  htmlLink?: string;
}

/**
 * Id del evento derivado de la programación. Google admite ids propios
 * (base32hex: 0-9 y a-v); el hex de los bytes cumple esa regla. Al ser
 * determinista, un reintento tras perder la respuesta de red NO crea un
 * segundo evento: Google responde 409 y se actualiza el existente.
 */
export function eventIdFor(scheduleId: string): string {
  const hex = Array.from(new TextEncoder().encode(scheduleId))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `hb${hex}`.slice(0, 1024);
}

export function isAppEvent(ev: Pick<GcalEvent, "extendedProperties">): boolean {
  return ev.extendedProperties?.private?.gtApp === APP_TAG;
}

/* ---------------------------------------------------------------- colores */

const GOOGLE_COLORS: [string, string][] = [
  ["1", "#7986cb"],
  ["2", "#33b679"],
  ["3", "#8e24aa"],
  ["4", "#e67c73"],
  ["5", "#f6bf26"],
  ["6", "#f4511e"],
  ["7", "#039be5"],
  ["8", "#616161"],
  ["9", "#3f51b5"],
  ["10", "#0b8043"],
  ["11", "#d50000"],
];

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Color de evento de Google más parecido al del hábito. */
export function googleColorId(hex: string): string | undefined {
  const c = rgb(hex);
  if (!c) return undefined;
  let best: string | undefined;
  let bestD = Infinity;
  for (const [id, g] of GOOGLE_COLORS) {
    const [r, gg, b] = rgb(g)!;
    const d = (r - c[0]) ** 2 + (gg - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/* ------------------------------------------------------------ recurrencia */

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Primer día con ocurrencia (en la zona de la programación), o null si ya no genera ninguna. */
export function firstOccurrenceDay(s: HabitScheduleRow): string | null {
  const last = lastActiveDay(s);
  let key = s.startDate;
  for (let i = 0; i < 800; i++, key = addDays(key, 1)) {
    if (last && key > last) return null;
    if (occursOn(s, key)) return key;
  }
  return null;
}

function untilUtc(dayKey: string, tz: string): string {
  // Fin del último día en la zona de la programación, expresado en UTC (RFC 5545).
  const end = zonedToUtc(addDays(dayKey, 1), "00:00", tz).getTime() - 1000;
  return new Date(end).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function rruleFor(s: HabitScheduleRow): string | null {
  if (s.kind !== "recurring") return null;
  const parts = [`FREQ=${s.freq.toUpperCase()}`];
  if (s.interval > 1) parts.push(`INTERVAL=${s.interval}`);
  if (s.freq === "weekly") {
    const days = s.daysOfWeek.length ? s.daysOfWeek : [dowOf(s.startDate)];
    parts.push(`BYDAY=${[...days].sort().map((d) => BYDAY[d]).join(",")}`);
  }
  if (s.freq === "monthly") parts.push(`BYMONTHDAY=${Number(s.startDate.slice(8))}`);
  const last = lastActiveDay(s);
  if (last) parts.push(`UNTIL=${untilUtc(last, s.timezone)}`);
  return `RRULE:${parts.join(";")}`;
}

/* ------------------------------------------------------------------ evento */

export function buildEvent(s: HabitScheduleRow, habit: HabitRow, appName = "Productividad"): GcalEvent | null {
  const first = firstOccurrenceDay(s);
  if (!first) return null;
  const endTime = s.endTime ?? addMinutes(s.startTime, DEFAULT_DURATION_MIN);
  // Si la hora de fin "da la vuelta" (23:45 + 30 min), el fin cae al día siguiente.
  const endDay = endTime > s.startTime ? first : addDays(first, 1);
  const unit = habit.unit ? ` ${habit.unit}` : habit.dailyTarget > 1 ? " veces" : "";
  const ev: GcalEvent = {
    id: eventIdFor(s.id),
    summary: habit.name,
    description:
      `Hábito programado desde ${appName}. Meta diaria: ${habit.dailyTarget}${unit}.\n` +
      "Este evento es solo el horario previsto: registra la realización en la app.",
    start: { dateTime: `${first}T${s.startTime}:00`, timeZone: s.timezone },
    end: { dateTime: `${endDay}T${endTime}:00`, timeZone: s.timezone },
    colorId: googleColorId(habit.color),
    reminders: { useDefault: true },
    extendedProperties: { private: { gtApp: APP_TAG, gtScheduleId: s.id, gtHabitId: habit.id } },
  };
  const rule = rruleFor(s);
  if (rule) ev.recurrence = [rule];
  return ev;
}

function addMinutes(time: string, min: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (h * 60 + m + min) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/* ------------------------------------------------------------- huellas */

interface TimingCore {
  day: string;
  start: string;
  end: string;
  tz: string;
  rule: string;
}

function wallOf(dt: GcalEventDateTime | undefined, tz: string): { day: string; time: string } {
  if (!dt) return { day: "", time: "" };
  if (dt.date) return { day: dt.date, time: "" };
  const v = dt.dateTime ?? "";
  // Sin desplazamiento: ya es hora de pared en `timeZone` (así lo envía la app).
  if (/T\d{2}:\d{2}(:\d{2})?$/.test(v)) return { day: v.slice(0, 10), time: v.slice(11, 16) };
  const w = wallClock(new Date(v), tz);
  return { day: w.dateKey, time: w.time };
}

function normRule(recurrence: string[] | undefined): string {
  const rule = (recurrence ?? []).find((r) => r.startsWith("RRULE:"));
  if (!rule) return "";
  const map = new Map<string, string>();
  for (const part of rule.slice(6).split(";")) {
    const [k, v] = part.split("=");
    if (!k || v === undefined) continue;
    map.set(k.toUpperCase(), k.toUpperCase() === "BYDAY" ? v.split(",").sort().join(",") : v);
  }
  if (map.get("INTERVAL") === "1") map.delete("INTERVAL");
  // UNTIL normalizado a "AAAAMMDDTHHMMSSZ" (o solo fecha si llegó así).
  const until = map.get("UNTIL");
  if (until) {
    const m = /^(\d{8})(?:T(\d{6})Z?)?$/.exec(until);
    if (m) map.set("UNTIL", m[2] ? `${m[1]}T${m[2]}Z` : m[1]);
  }
  return [...map.entries()].sort().map(([k, v]) => `${k}=${v}`).join(";");
}

export function timingCore(ev: Pick<GcalEvent, "start" | "end" | "recurrence">): TimingCore {
  const tz = ev.start?.timeZone ?? ev.end?.timeZone ?? "UTC";
  const s = wallOf(ev.start, tz);
  const e = wallOf(ev.end, ev.end?.timeZone ?? tz);
  return { day: s.day, start: s.time, end: e.time, tz, rule: normRule(ev.recurrence) };
}

/** Huella de CUÁNDO ocurre el evento (día, horas, zona y regla). */
export function timingHash(ev: Pick<GcalEvent, "start" | "end" | "recurrence">): string {
  return stableHash(JSON.stringify(timingCore(ev)));
}

export function summaryHash(ev: Pick<GcalEvent, "summary">): string {
  return stableHash((ev.summary ?? "").trim());
}

/** Huella guardada en el vínculo: horario + título, comparables por separado. */
export function combinedHash(ev: GcalEvent): string {
  return `${timingHash(ev)}.${summaryHash(ev)}`;
}

export function splitHash(h: string | null): { timing: string | null; summary: string | null } {
  if (!h) return { timing: null, summary: null };
  const [timing, summary] = h.split(".");
  return { timing: timing || null, summary: summary || null };
}

/* ----------------------------------------------- de Google a programación */

export type RemoteParse = { ok: true; schedule: ScheduleInput } | { ok: false; reason: string };

/**
 * Traduce los cambios de horario hechos en Google a una programación. Solo
 * acepta lo que la app sabe representar; lo demás se deja para que el
 * usuario decida (nunca se aplica a medias).
 */
export function scheduleFromEvent(ev: GcalEvent, current: HabitScheduleRow): RemoteParse {
  if (ev.start?.date) return { ok: false, reason: "En Google es un evento de día completo" };
  const core = timingCore(ev);
  if (!core.day || !core.start) return { ok: false, reason: "El evento no tiene hora de inicio" };
  const base: ScheduleInput = {
    id: current.id,
    kind: "once",
    startTime: core.start,
    endTime: core.end && core.end > core.start ? core.end : null,
    startDate: core.day,
    timezone: core.tz,
    active: current.active,
  };
  if (!core.rule) return { ok: true, schedule: base };

  const map = new Map(core.rule.split(";").map((p) => p.split("=") as [string, string]));
  const freq = map.get("FREQ");
  if (map.has("COUNT")) return { ok: false, reason: "La repetición termina tras N veces (no compatible)" };
  for (const k of map.keys()) {
    if (!["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "UNTIL", "WKST"].includes(k)) {
      return { ok: false, reason: `Regla de repetición no compatible (${k})` };
    }
  }
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY") {
    return { ok: false, reason: "Frecuencia de repetición no compatible" };
  }
  const interval = Number(map.get("INTERVAL") ?? 1);
  const out: ScheduleInput = {
    ...base,
    kind: "recurring",
    freq: freq.toLowerCase() as "daily" | "weekly" | "monthly",
    interval: Number.isFinite(interval) && interval >= 1 ? interval : 1,
    // Se conserva el inicio original de la regla si es anterior: el primer
    // evento de Google puede haberse movido sin que la serie empiece después.
    startDate: current.kind === "recurring" && current.startDate < core.day ? current.startDate : core.day,
  };
  if (freq === "WEEKLY") {
    const byday = (map.get("BYDAY") ?? BYDAY[dowOf(core.day)]).split(",");
    if (byday.some((d) => !BYDAY.includes(d))) return { ok: false, reason: "Días de repetición no compatibles" };
    out.daysOfWeek = byday.map((d) => BYDAY.indexOf(d)).sort((a, b) => a - b);
  }
  if (freq === "MONTHLY") {
    const md = map.get("BYMONTHDAY");
    if (md && Number(md) !== Number(core.day.slice(8))) return { ok: false, reason: "Día del mes no compatible" };
    out.startDate = core.day;
  }
  const until = map.get("UNTIL");
  if (until) {
    const d = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
    // Con hora, UNTIL es un instante UTC: se lleva al día de la zona del evento.
    out.endDate = until.length > 8
      ? wallClock(new Date(`${d}T${until.slice(9, 11)}:${until.slice(11, 13)}:${until.slice(13, 15)}Z`), core.tz).dateKey
      : d;
  } else {
    out.endDate = null;
  }
  return { ok: true, schedule: out };
}

/** Texto legible de la versión remota (para mostrar un conflicto). */
export function describeRemote(ev: GcalEvent): Record<string, unknown> {
  const c = timingCore(ev);
  return {
    summary: ev.summary ?? "",
    day: c.day,
    start: c.start,
    end: c.end,
    timeZone: c.tz,
    rule: c.rule || null,
    updated: ev.updated ?? null,
    status: ev.status ?? "confirmed",
  };
}
