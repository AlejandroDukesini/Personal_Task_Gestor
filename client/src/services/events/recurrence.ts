import { z } from "zod";
import { localToday } from "@/services/rules";
import type { EventRecurrence } from "@/types";

/**
 * Repetición de eventos (clases, reuniones fijas…). Un evento repetido es UNA
 * fila: sus ocurrencias se calculan al vuelo para el rango visible, conservando
 * la hora local y la duración del evento original. No se "completan": solo
 * recuerdan que el evento existe.
 */

export const FREQ_LABEL: Record<EventRecurrence["freq"], string> = {
  daily: "Diaria",
  weekly: "Semanal",
  monthly: "Mensual",
  days: "Días específicos",
};

export const recurrenceSchema = z
  .object({
    freq: z.enum(["daily", "weekly", "monthly", "days"]),
    interval: z.number().int().min(1).max(52).optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de fin de repetición inválida")
      .nullable()
      .optional(),
  })
  .refine((r) => r.freq !== "days" || (r.daysOfWeek ?? []).length > 0, {
    message: "Elige al menos un día de la semana",
  });

/** Error de negocio del rango de repetición, o null. */
export function recurrenceError(e: { start?: string | null; recurrence?: EventRecurrence | null }): string | null {
  const r = e.recurrence;
  if (!r || !e.start) return null;
  if (r.freq === "days" && !(r.daysOfWeek ?? []).length) return "Elige al menos un día de la semana";
  if (r.until && r.until < localToday(new Date(e.start))) return "La repetición no puede terminar antes del inicio del evento.";
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Días de calendario entre dos fechas locales (inmune al cambio de horario). */
function dayDiff(a: Date, b: Date): number {
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);
}

/** Mismo instante local (hora y minuto de `base`) en el día `y-m-d`. */
function at(base: Date, y: number, m: number, d: number): Date {
  return new Date(y, m, d, base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds());
}

/**
 * Ocurrencias de un evento que se solapan con [from, to). Sin repetición
 * devuelve el propio evento si cae en el rango.
 */
export function expandEvent(
  e: { start: string; end: string; recurrence?: EventRecurrence | null },
  from: Date,
  to: Date
): { start: Date; end: Date }[] {
  const start = new Date(e.start);
  const duration = Math.max(new Date(e.end).getTime() - start.getTime(), 0);
  const out: { start: Date; end: Date }[] = [];
  const push = (s: Date) => {
    const end = new Date(s.getTime() + duration);
    if (s < to && (end > from || (duration === 0 && s >= from))) out.push({ start: s, end });
  };

  const r = e.recurrence;
  if (!r) {
    push(start);
    return out;
  }

  const interval = Math.max(1, r.interval ?? 1);
  // Último día incluido: el de `until` o el final del rango visible.
  const [uy, um, ud] = (r.until ?? "").split("-").map(Number);
  const lastDay = r.until ? new Date(uy, um - 1, ud) : null;
  const beyond = (s: Date) => s >= to || (lastDay !== null && dayDiff(lastDay, s) > 0);

  if (r.freq === "monthly") {
    const day = start.getDate();
    // Se salta hasta cerca del rango para no recorrer años de meses.
    const skip = Math.max(0, (from.getFullYear() - start.getFullYear()) * 12 + from.getMonth() - start.getMonth() - 1);
    for (let k = Math.floor(skip / interval); ; k++) {
      const total = start.getMonth() + k * interval;
      const y = start.getFullYear() + Math.floor(total / 12);
      const m = ((total % 12) + 12) % 12;
      const s = at(start, y, m, day);
      if (beyond(s)) break;
      // Un mes sin ese día (31 en abril) no tiene ocurrencia, como en Google Calendar.
      if (s.getDate() === day) push(s);
    }
    return out;
  }

  // Diaria, semanal o días específicos: se recorre día a día desde poco antes del rango.
  const step = r.freq === "daily" ? interval : r.freq === "weekly" ? 7 * interval : 1;
  const days = r.freq === "days" ? new Set(r.daysOfWeek ?? []) : null;
  // Semana (de lunes) del inicio: base del "cada N semanas" en días específicos.
  const weekStart = at(start, start.getFullYear(), start.getMonth(), start.getDate() - ((start.getDay() + 6) % 7));
  const margin = Math.ceil(duration / DAY_MS) + 1;
  let k = Math.max(0, dayDiff(start, from) - margin);
  k = Math.ceil(k / step) * step;
  for (; ; k += step) {
    const s = at(start, start.getFullYear(), start.getMonth(), start.getDate() + k);
    if (beyond(s)) break;
    if (days) {
      if (!days.has(s.getDay())) continue;
      if (Math.floor(dayDiff(weekStart, s) / 7) % interval !== 0) continue;
    }
    push(s);
  }
  return out;
}

/** Texto corto de la repetición para el formulario y la leyenda. */
export function describeRecurrence(r: EventRecurrence | null | undefined): string {
  if (!r) return "No se repite";
  const n = Math.max(1, r.interval ?? 1);
  const DAY_NAMES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  let txt: string;
  switch (r.freq) {
    case "daily":
      txt = n === 1 ? "Todos los días" : `Cada ${n} días`;
      break;
    case "weekly":
      txt = n === 1 ? "Cada semana" : `Cada ${n} semanas`;
      break;
    case "monthly":
      txt = n === 1 ? "Cada mes" : `Cada ${n} meses`;
      break;
    case "days": {
      const list = [1, 2, 3, 4, 5, 6, 0].filter((d) => r.daysOfWeek?.includes(d)).map((d) => DAY_NAMES[d]).join(", ");
      txt = `${n === 1 ? "Cada semana" : `Cada ${n} semanas`}: ${list}`;
      break;
    }
  }
  return r.until ? `${txt} hasta el ${r.until.split("-").reverse().join("/")}` : txt;
}
