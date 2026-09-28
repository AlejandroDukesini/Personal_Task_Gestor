/**
 * Fechas contables como `YYYY-MM-DD` en hora LOCAL.
 *
 * Un movimiento del día 5 es del día 5 en cualquier zona horaria: guardarlo
 * como instante UTC lo movería al día 4 al abrirlo en otro huso. Con claves de
 * día además se comparan como texto (`"2026-01-05" < "2026-02-01"`).
 */

export type DateKey = string;

export const DATE_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isDateKey(v: unknown): boolean {
  if (typeof v !== "string" || !DATE_KEY_RE.test(v)) return false;
  const d = fromKey(v);
  return toKey(d) === v; // descarta 2026-02-30
}

export function toKey(d: Date): DateKey {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function fromKey(key: DateKey): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(now = new Date()): DateKey {
  return toKey(now);
}

export function addDays(key: DateKey, n: number): DateKey {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

/** Suma meses conservando el día cuando existe (31-ene + 1 mes = 28/29-feb). */
export function addMonths(key: DateKey, n: number, anchorDay?: number): DateKey {
  const [y, m, d] = key.split("-").map(Number);
  const day = anchorDay ?? d;
  const target = new Date(y, m - 1 + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return toKey(target);
}

export function diffDays(a: DateKey, b: DateKey): number {
  // Se redondea: los cambios de horario de verano dan días de 23 o 25 h.
  return Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / 86400000);
}

export function minKey(a: DateKey, b: DateKey): DateKey {
  return a < b ? a : b;
}

export function maxKey(a: DateKey, b: DateKey): DateKey {
  return a > b ? a : b;
}

/** Normaliza un ISO completo o una clave a clave de día local. */
export function keyOf(value: string): DateKey {
  if (DATE_KEY_RE.test(value)) return value;
  return toKey(new Date(value));
}

/* ----------------------------------------------------------------- rangos */

export type RangePreset = "day" | "week" | "month" | "quarter" | "year" | "custom";

export interface DateRange {
  from: DateKey;
  /** Inclusivo. */
  to: DateKey;
}

/** Lunes de la semana de `key` (semana ISO, como en Colombia y Europa). */
export function startOfWeek(key: DateKey): DateKey {
  const d = fromKey(key);
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dow);
  return toKey(d);
}

export function startOfMonth(key: DateKey): DateKey {
  return `${key.slice(0, 7)}-01`;
}

export function endOfMonth(key: DateKey): DateKey {
  const [y, m] = key.split("-").map(Number);
  return toKey(new Date(y, m, 0));
}

export function startOfQuarter(key: DateKey): DateKey {
  const [y, m] = key.split("-").map(Number);
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(q).padStart(2, "0")}-01`;
}

export function startOfYear(key: DateKey): DateKey {
  return `${key.slice(0, 4)}-01-01`;
}

/** Rango del preset que contiene `anchor`. */
export function rangeFor(preset: Exclude<RangePreset, "custom">, anchor: DateKey): DateRange {
  switch (preset) {
    case "day":
      return { from: anchor, to: anchor };
    case "week": {
      const from = startOfWeek(anchor);
      return { from, to: addDays(from, 6) };
    }
    case "month":
      return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
    case "quarter": {
      const from = startOfQuarter(anchor);
      return { from, to: addDays(addMonths(from, 3), -1) };
    }
    case "year":
      return { from: startOfYear(anchor), to: `${anchor.slice(0, 4)}-12-31` };
  }
}

/** Desplaza un rango `steps` periodos hacia delante (o atrás si es negativo). */
export function shiftRange(preset: RangePreset, range: DateRange, steps: number): DateRange {
  switch (preset) {
    case "day":
      return rangeFor("day", addDays(range.from, steps));
    case "week":
      return rangeFor("week", addDays(range.from, 7 * steps));
    case "month":
      return rangeFor("month", addMonths(range.from, steps));
    case "quarter":
      return rangeFor("quarter", addMonths(range.from, 3 * steps));
    case "year":
      return rangeFor("year", addMonths(range.from, 12 * steps));
    case "custom": {
      const len = diffDays(range.from, range.to) + 1;
      return { from: addDays(range.from, len * steps), to: addDays(range.to, len * steps) };
    }
  }
}

/** El periodo inmediatamente anterior y de la misma duración (para comparar). */
export function previousRange(range: DateRange): DateRange {
  const len = diffDays(range.from, range.to) + 1;
  return { from: addDays(range.from, -len), to: addDays(range.from, -1) };
}

export function inRange(key: DateKey, range: DateRange): boolean {
  return key >= range.from && key <= range.to;
}

/* ----------------------------------------------------------- agrupación */

export type Bucket = "day" | "week" | "month";

/** Granularidad razonable para pintar un rango sin saturar el eje. */
export function bucketFor(range: DateRange): Bucket {
  const days = diffDays(range.from, range.to) + 1;
  if (days <= 45) return "day";
  if (days <= 190) return "week";
  return "month";
}

export function bucketKey(key: DateKey, bucket: Bucket): DateKey {
  if (bucket === "day") return key;
  if (bucket === "week") return startOfWeek(key);
  return startOfMonth(key);
}

/** Todas las claves de cubeta del rango, incluidas las vacías (el eje no salta). */
export function bucketsBetween(range: DateRange, bucket: Bucket): DateKey[] {
  const out: DateKey[] = [];
  let cur = bucketKey(range.from, bucket);
  while (cur <= range.to) {
    out.push(cur);
    cur = bucket === "day" ? addDays(cur, 1) : bucket === "week" ? addDays(cur, 7) : addMonths(cur, 1);
    if (out.length > 1000) break; // salvaguarda ante un rango absurdo
  }
  return out;
}
