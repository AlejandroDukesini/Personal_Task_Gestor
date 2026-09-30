// Interpretación de capturas de Google Calendar a partir de las líneas que
// devuelve el OCR (texto + caja). Función pura: no depende del motor de OCR.
//
// Regla de oro: no inventar. Si una fecha u hora no es legible se deja vacía
// y se marca para que el usuario la confirme. Las horas deducidas por la
// posición en la rejilla se señalan como estimadas.

import { normalizeText } from "@/services/habits/hash";

export interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: Bbox;
}

export interface OcrLine {
  text: string;
  /** 0-100, como la da Tesseract. */
  confidence: number;
  bbox: Bbox;
  words?: OcrWord[];
  /** Bloque de color del evento al que pertenece (lectura por bloque). */
  group?: number;
}

export type CalendarView = "day" | "week" | "agenda";

export interface ParseContext {
  /** Fecha que el usuario confirma para la captura (o el primer día visible). */
  referenceDate: string;
  /** Vista indicada por el usuario, o `auto` para detectarla. */
  view: CalendarView | "auto";
  imageWidth: number;
}

export interface DetectedEvent {
  key: string;
  title: string;
  date: string | null;
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
  durationMin: number | null;
  /** La hora se dedujo de la posición vertical en la rejilla, no del texto. */
  estimatedTime: boolean;
  /** 0-1. */
  confidence: number;
  /** Avisos para el usuario (en español). */
  issues: string[];
  raw: string;
  bbox: Bbox;
  color?: string | null;
}

export interface ParseResult {
  view: CalendarView;
  events: DetectedEvent[];
  warnings: string[];
}

/* --------------------------------------------------------------- horas */

const MERIDIEM = String.raw`(a\.?\s?m\.?|p\.?\s?m\.?)`;
const TIME = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*${MERIDIEM}?`;
const SEP = String.raw`\s*(?:-|–|—|−|~|a|to|hasta)\s*`;
const RANGE_RE = new RegExp(String.raw`(?<![\d:])${TIME}${SEP}${TIME}(?![\d])`, "i");
const SINGLE_RE = new RegExp(String.raw`(?<![\d:])(\d{1,2})(?:[:.](\d{2}))\s*${MERIDIEM}?|(?<![\d:])(\d{1,2})\s*${MERIDIEM}`, "i");

type Mer = "am" | "pm" | null;

function merOf(s: string | undefined): Mer {
  if (!s) return null;
  return s.toLowerCase().startsWith("p") ? "pm" : "am";
}

function to24(h: number, m: number, mer: Mer): string | null {
  if (m > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === "am" && h === 12) h = 0;
    if (mer === "pm" && h !== 12) h += 12;
  } else if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface TimeMatch {
  start: string;
  end: string | null;
  index: number;
  length: number;
}

/** Arreglos típicos del OCR en horas: "8:0O" → "8:00", "p.rn." → "p.m.". */
function cleanTimeText(t: string): string {
  return t
    .replace(/(\d)[oO](?=\D|$)/g, "$10")
    .replace(/[oO](\d)/g, "0$1")
    .replace(/p\.?\s?rn\.?/gi, "p.m.")
    .replace(/a\.?\s?rn\.?/gi, "a.m.");
}

/** Busca un rango ("8:00 – 8:30 p. m.") o una hora suelta ("20:00", "8 pm"). */
export function findTime(text: string): TimeMatch | null {
  const t = cleanTimeText(text);
  const r = RANGE_RE.exec(t);
  if (r) {
    const [h1, m1, mer1, h2, m2, mer2] = [r[1], r[2], r[3], r[4], r[5], r[6]];
    // "8 - 9" sin minutos ni am/pm son probablemente fechas o números: se descartan.
    const plausible = m1 || m2 || mer1 || mer2;
    if (plausible) {
      const e2 = merOf(mer2);
      let e1 = merOf(mer1) ?? e2;
      const endT = to24(Number(h2), Number(m2 ?? 0), e2);
      let startT = to24(Number(h1), Number(m1 ?? 0), e1);
      // "11:30 – 1 p. m.": el inicio heredado quedaría después del fin → era a. m.
      if (!mer1 && e2 === "pm" && startT && endT && startT > endT) {
        e1 = "am";
        startT = to24(Number(h1), Number(m1 ?? 0), e1);
      }
      if (startT && endT) return { start: startT, end: endT, index: r.index, length: r[0].length };
    }
  }
  const s = SINGLE_RE.exec(t);
  if (s) {
    const start = s[1] !== undefined ? to24(Number(s[1]), Number(s[2]), merOf(s[3])) : to24(Number(s[4]), 0, merOf(s[5]));
    if (start) return { start, end: null, index: s.index, length: s[0].length };
  }
  return null;
}

/* --------------------------------------------------------------- fechas */

const WEEKDAYS: [RegExp, number][] = [
  [/^(dom|domingo|sun|sunday)\.?$/, 0],
  [/^(lun|lunes|mon|monday)\.?$/, 1],
  [/^(mar|martes|tue|tues|tuesday)\.?$/, 2],
  [/^(mie|mier|miercoles|wed|wednesday)\.?$/, 3],
  [/^(jue|jueves|thu|thur|thurs|thursday)\.?$/, 4],
  [/^(vie|viernes|fri|friday)\.?$/, 5],
  [/^(sab|sabado|sat|saturday)\.?$/, 6],
];

const MONTHS: [RegExp, number][] = [
  [/^(ene|enero|jan|january)\.?$/, 1],
  [/^(feb|febrero|february)\.?$/, 2],
  [/^(mar|marzo|march)\.?$/, 3],
  [/^(abr|abril|apr|april)\.?$/, 4],
  [/^(may|mayo)\.?$/, 5],
  [/^(jun|junio|june)\.?$/, 6],
  [/^(jul|julio|july)\.?$/, 7],
  [/^(ago|agosto|aug|august)\.?$/, 8],
  [/^(sep|sept|septiembre|setiembre|september)\.?$/, 9],
  [/^(oct|octubre|october)\.?$/, 10],
  [/^(nov|noviembre|november)\.?$/, 11],
  [/^(dic|diciembre|dec|december)\.?$/, 12],
];

function weekdayOf(token: string): number | null {
  const t = normalizeText(token);
  for (const [re, d] of WEEKDAYS) if (re.test(t)) return d;
  return null;
}

function monthOf(token: string): number | null {
  const t = normalizeText(token);
  for (const [re, m] of MONTHS) if (re.test(t)) return m;
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function dateToKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Fecha completa a partir de piezas (día del mes, mes, día de la semana), la
 * más cercana a la fecha de referencia. Si hay varias candidatas igual de
 * plausibles o ninguna, devuelve null (no se inventa).
 */
export function resolveDate(
  parts: { day: number; month?: number | null; year?: number | null; weekday?: number | null },
  referenceDate: string
): string | null {
  const ref = keyToDate(referenceDate);
  if (parts.day < 1 || parts.day > 31) return null;
  const candidates: Date[] = [];
  for (let offset = -45; offset <= 45; offset++) {
    const d = new Date(ref.getTime() + offset * 86400000);
    if (d.getUTCDate() !== parts.day) continue;
    if (parts.month && d.getUTCMonth() + 1 !== parts.month) continue;
    if (parts.year && d.getUTCFullYear() !== parts.year) continue;
    if (parts.weekday !== undefined && parts.weekday !== null && d.getUTCDay() !== parts.weekday) continue;
    candidates.push(d);
  }
  if (parts.year && parts.month && candidates.length === 0) {
    const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    return d.getUTCDate() === parts.day ? dateToKey(d) : null;
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.abs(a.getTime() - ref.getTime()) - Math.abs(b.getTime() - ref.getTime()));
  // Dos candidatas a la misma distancia (sin mes ni día de semana): ambiguo.
  if (
    candidates.length > 1 &&
    Math.abs(candidates[0].getTime() - ref.getTime()) === Math.abs(candidates[1].getTime() - ref.getTime())
  ) {
    return null;
  }
  return dateToKey(candidates[0]);
}

interface DateHeader {
  date: string | null;
  weekday: number | null;
  day: number | null;
  cx: number;
  y: number;
  bbox: Bbox;
}

const tokensOf = (s: string) => s.split(/[\s,./]+/).filter(Boolean);

/**
 * Cabecera de agenda: "30 SEP, MIÉ", "mié, 30 sept", "Miércoles, 30 de
 * septiembre de 2026". Devuelve null si la línea no parece una fecha.
 */
export function parseDateHeader(text: string, referenceDate: string): Omit<DateHeader, "cx" | "y" | "bbox"> | null {
  const toks = tokensOf(text);
  if (toks.length === 0 || toks.length > 7) return null;
  let weekday: number | null = null;
  let month: number | null = null;
  let day: number | null = null;
  let year: number | null = null;
  let ambiguousMar = false;
  let other = 0;
  for (const tok of toks) {
    const n = normalizeText(tok);
    if (n === "de" || n === "del" || n === "of" || n === "hoy" || n === "today") continue;
    // "mar" puede ser martes o marzo: se decide al final.
    if (n === "mar") {
      ambiguousMar = true;
      continue;
    }
    const wd = weekdayOf(tok);
    if (wd !== null && weekday === null) {
      weekday = wd;
      continue;
    }
    const mo = monthOf(tok);
    if (mo !== null && month === null) {
      month = mo;
      continue;
    }
    if (/^\d{4}$/.test(n)) {
      year = Number(n);
      continue;
    }
    if (/^\d{1,2}$/.test(n) && day === null) {
      day = Number(n);
      continue;
    }
    other++;
  }
  if (ambiguousMar) {
    if (weekday !== null && month === null) month = 3;
    else if (weekday === null) weekday = 2;
  }
  if (day === null || other > 0 || (weekday === null && month === null)) return null;
  return { date: resolveDate({ day, month, year, weekday }, referenceDate), weekday, day };
}

/* ----------------------------------------------------------- ruido de UI */

const UI_NOISE = new Set(
  [
    "hoy", "today", "semana", "week", "mes", "month", "dia", "day", "ano", "year", "agenda", "programacion", "schedule",
    "crear", "create", "buscar", "search", "calendario", "calendar", "google calendar", "mis calendarios", "my calendars",
    "otros calendarios", "other calendars", "tareas", "tasks", "recordatorios", "gmt", "todo el dia", "all day",
  ].map(normalizeText)
);

function isNoise(text: string): boolean {
  const n = normalizeText(text);
  if (n.length < 2) return true;
  if (UI_NOISE.has(n)) return true;
  if (/^gmt[ +\-\d:]*$/.test(n) || /^utc[ +\-\d:]*$/.test(n)) return true;
  // Solo números/símbolos (números de día sueltos, etc.)
  if (!/[a-zñ]{2,}/.test(n)) return true;
  // Título de mes: "septiembre 2026", "sep – oct 2026"
  const toks = n.split(" ").filter((t) => t !== "de" && t !== "del");
  if (toks.length && toks.every((t) => monthOf(t) !== null || /^\d{4}$/.test(t) || t === "")) return true;
  return false;
}

/* ------------------------------------------------------------- utilidades */

const cx = (b: Bbox) => (b.x0 + b.x1) / 2;
const cy = (b: Bbox) => (b.y0 + b.y1) / 2;
const h = (b: Bbox) => Math.max(1, b.y1 - b.y0);

function stripTime(text: string, m: TimeMatch): string {
  return (text.slice(0, m.index) + " " + text.slice(m.index + m.length))
    .replace(/[,·•|–—-]\s*$/g, "")
    .replace(/^\s*[,·•|–—-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function minutesBetween(a: string, b: string): number {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  let d = bh * 60 + bm - (ah * 60 + am);
  if (d < 0) d += 24 * 60;
  return d;
}

function cleanTitle(t: string): string {
  return t
    .replace(/^[\s•·●○◦▪■□|:,.-]+/, "")
    .replace(/[\s•·|,.:-]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/* --------------------------------------------------- marcas de fecha */

interface DateMarks {
  /** Fila horizontal de días (vista semana/varios días). */
  week: DateHeader[];
  /** Fechas sueltas (agenda: "MIÉ" encima de "30", "JUE 1"…). */
  loose: DateHeader[];
  /** Palabras que forman parte de una fecha: se retiran del texto de su línea. */
  consumed: Set<OcrWord>;
}

/**
 * Busca días de la semana a nivel de PALABRA: el OCR a menudo parte la fecha
 * en dos líneas ("MIÉ" / "30") o la pega a lo que tiene al lado ("JUE
 * Gimnasio", "1 6:00 — 7:00 a. m.").
 */
function findDateMarks(lines: OcrLine[], referenceDate: string): DateMarks {
  const words: OcrWord[] = lines.flatMap((l) => (l.words?.length ? l.words : [{ text: l.text, confidence: l.confidence, bbox: l.bbox }]));
  const isNum = (w: OcrWord) => /^\d{1,2}[,.]?$/.test(w.text.trim());
  const cands: { hd: DateHeader; used: OcrWord[] }[] = [];
  const taken = new Set<OcrWord>();
  for (const w of words) {
    // Una palabra puede traer ambas piezas ("LUN29") o solo el día de la semana.
    const m = /^([a-záéíóúñ]{3,9})\.?,?(\d{1,2})?$/i.exec(w.text.trim());
    if (!m) continue;
    const wd = weekdayOf(m[1]);
    if (wd === null) continue;
    let day = m[2] ? Number(m[2]) : null;
    const used = [w];
    if (day === null) {
      // El número del día: debajo, encima o al lado, muy cerca.
      const near = words
        .filter((o) => o !== w && isNum(o) && !taken.has(o))
        .map((o) => ({ o, d: Math.hypot(cx(o.bbox) - cx(w.bbox), cy(o.bbox) - cy(w.bbox)) }))
        // Unidad: el tamaño de la palabra (en mayúsculas pequeñas la altura sola se queda corta).
        .filter(({ o, d }) => {
          const unit = Math.max(h(w.bbox), w.bbox.x1 - w.bbox.x0);
          return d < unit * 2.5 && Math.abs(cx(o.bbox) - cx(w.bbox)) < unit * 2;
        })
        .sort((a, b) => a.d - b.d)[0];
      if (near) {
        day = Number(near.o.text.replace(/\D/g, ""));
        used.push(near.o);
        taken.add(near.o);
      }
    }
    const bbox = used.reduce(
      (b, u) => ({ x0: Math.min(b.x0, u.bbox.x0), y0: Math.min(b.y0, u.bbox.y0), x1: Math.max(b.x1, u.bbox.x1), y1: Math.max(b.y1, u.bbox.y1) }),
      { ...w.bbox }
    );
    cands.push({
      hd: { date: day ? resolveDate({ day, weekday: wd }, referenceDate) : null, weekday: wd, day, cx: cx(w.bbox), y: cy(w.bbox), bbox },
      used,
    });
  }
  // La fila horizontal más poblada es la cabecera de la semana.
  const rows: typeof cands[] = [];
  for (const c of [...cands].sort((a, b) => a.hd.y - b.hd.y)) {
    const row = rows.find((r) => Math.abs(r[0].hd.y - c.hd.y) < h(c.hd.bbox) * 1.5);
    if (row) row.push(c);
    else rows.push([c]);
  }
  const best = rows.sort((a, b) => b.length - a.length)[0] ?? [];
  const week = best.length >= 2 ? best : [];
  if (week.length >= 2) recoverColumns(week, words, cands, taken);
  // Fuera de la fila de la semana, solo cuenta como fecha si trae número de día
  // (un título como "Lunes de pierna" no es una fecha).
  const loose = cands.filter((c) => !week.includes(c) && c.hd.day !== null);
  if (!week.length) recoverAgendaDays(loose, words, taken);
  const consumed = new Set<OcrWord>();
  for (const c of [...week, ...loose]) for (const u of c.used) consumed.add(u);
  return { week: week.map((c) => c.hd).sort((a, b) => a.cx - b.cx), loose: loose.map((c) => c.hd), consumed };
}

const DAY_MS = 86400000;
const addDaysKey = (key: string, n: number) => dateToKey(new Date(keyToDate(key).getTime() + n * DAY_MS));

/**
 * Columnas de la semana cuyo día de la semana el OCR leyó mal ("wie 30",
 * "vE2"). Con al menos dos columnas fechadas, la rejilla fija qué fecha
 * corresponde a cada posición; se acepta la columna solo si el NÚMERO de día
 * que se ve en ella coincide con esa fecha (se verifica, no se supone).
 */
function recoverColumns(
  week: { hd: DateHeader; used: OcrWord[] }[],
  words: OcrWord[],
  cands: { hd: DateHeader; used: OcrWord[] }[],
  taken: Set<OcrWord>
): void {
  const dated = week.filter((c) => c.hd.date).sort((a, b) => a.hd.cx - b.hd.cx);
  if (dated.length < 2) return;
  const perDay: number[] = [];
  for (let i = 1; i < dated.length; i++) {
    const days = Math.round((keyToDate(dated[i].hd.date!).getTime() - keyToDate(dated[i - 1].hd.date!).getTime()) / DAY_MS);
    if (days > 0) perDay.push((dated[i].hd.cx - dated[i - 1].hd.cx) / days);
  }
  if (!perDay.length) return;
  const spacing = perDay.sort((a, b) => a - b)[Math.floor(perDay.length / 2)];
  if (!(spacing > 0)) return;
  // Desplazamiento típico del número respecto al día de la semana ("LUN 28").
  const offsets = dated.filter((c) => c.used[1]).map((c) => cx(c.used[1].bbox) - c.hd.cx);
  const offset = offsets.length ? offsets.sort((a, b) => a - b)[Math.floor(offsets.length / 2)] : 0;
  const anchor = dated[0].hd;
  const rowY = anchor.y;
  const rowH = h(anchor.bbox);
  const inWeek = new Set(week.flatMap((c) => c.used));
  for (const w of words) {
    if (inWeek.has(w) || taken.has(w) || Math.abs(cy(w.bbox) - rowY) > rowH * 1.5) continue;
    const m = /(\d{1,2})[,.]?$/.exec(w.text.trim());
    if (!m) continue;
    const x = cx(w.bbox) - offset;
    const date = addDaysKey(anchor.date!, Math.round((x - anchor.cx) / spacing));
    if (Number(date.slice(8)) !== Number(m[1])) continue;
    if (week.some((c) => Math.abs(c.hd.cx - x) < spacing * 0.4)) continue;
    const hd: DateHeader = { date, weekday: keyToDate(date).getUTCDay(), day: Number(m[1]), cx: x, y: rowY, bbox: w.bbox };
    const cand = { hd, used: [w] };
    week.push(cand);
    cands.push(cand);
    taken.add(w);
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * Agenda: días cuyo nombre el OCR no leyó ("E" en vez de "JUE"). Un número
 * suelto en la MISMA columna y con el MISMO tamaño de letra que los números de
 * día ya reconocidos es el siguiente día con ese número, porque la agenda va
 * en orden cronológico hacia abajo.
 */
function recoverAgendaDays(loose: { hd: DateHeader; used: OcrWord[] }[], words: OcrWord[], taken: Set<OcrWord>): void {
  const anchors = loose.filter((c) => c.hd.date && c.used[1]);
  if (!anchors.length) return;
  const numH = median(anchors.map((c) => h(c.used[1].bbox)));
  const colX = median(anchors.map((c) => cx(c.used[1].bbox)));
  const used = new Set(loose.flatMap((c) => c.used));
  for (const w of [...words].sort((a, b) => cy(a.bbox) - cy(b.bbox))) {
    if (used.has(w) || taken.has(w) || !/^\d{1,2}$/.test(w.text.trim())) continue;
    if (Math.abs(cx(w.bbox) - colX) > numH * 1.2 || h(w.bbox) < numH * 0.7) continue;
    const prev = loose.filter((c) => c.hd.date && c.hd.y < cy(w.bbox)).sort((a, b) => b.hd.y - a.hd.y)[0];
    if (!prev) continue;
    const n = Number(w.text.trim());
    let date: string | null = null;
    for (let i = 1; i <= 45 && !date; i++) {
      const d = addDaysKey(prev.hd.date!, i);
      if (Number(d.slice(8)) === n) date = d;
    }
    if (!date) continue;
    loose.push({ hd: { date, weekday: keyToDate(date).getUTCDay(), day: n, cx: colX, y: cy(w.bbox), bbox: w.bbox }, used: [w] });
    used.add(w);
    taken.add(w);
  }
}

/** Quita de cada línea las palabras que eran una fecha; descarta las que quedan vacías. */
function withoutDateWords(lines: OcrLine[], consumed: Set<OcrWord>): OcrLine[] {
  const out: OcrLine[] = [];
  for (const l of lines) {
    if (!l.words?.length || !l.words.some((w) => consumed.has(w))) {
      out.push(l);
      continue;
    }
    const rest = l.words.filter((w) => !consumed.has(w));
    if (!rest.length) continue;
    out.push({
      ...l,
      text: rest.map((w) => w.text).join(" "),
      words: rest,
      bbox: {
        x0: Math.min(...rest.map((w) => w.bbox.x0)),
        y0: Math.min(...rest.map((w) => w.bbox.y0)),
        x1: Math.max(...rest.map((w) => w.bbox.x1)),
        y1: Math.max(...rest.map((w) => w.bbox.y1)),
      },
    });
  }
  return out;
}

/* ------------------------------------------------------- eje de horas */

interface AxisLabel {
  minutes: number;
  y: number;
  x1: number;
}

/** Etiquetas del eje vertical ("7 a. m.", "08:00") para estimar horas por posición. */
function findAxis(lines: OcrLine[], imageWidth: number): AxisLabel[] {
  const out: AxisLabel[] = [];
  for (const l of lines) {
    if (l.bbox.x1 > imageWidth * 0.2) continue;
    if (/[a-zñ]{3,}/i.test(l.text.replace(/a\.?\s?m\.?|p\.?\s?m\.?/gi, ""))) continue;
    const t = findTime(l.text);
    if (!t || t.end) continue;
    const [hh, mm] = t.start.split(":").map(Number);
    out.push({ minutes: hh * 60 + mm, y: cy(l.bbox), x1: l.bbox.x1 });
  }
  const sorted = out.sort((a, b) => a.y - b.y);
  // Deben crecer con la altura; si no, no es un eje fiable.
  for (let i = 1; i < sorted.length; i++) if (sorted[i].minutes <= sorted[i - 1].minutes) return [];
  return sorted.length >= 2 ? sorted : [];
}

function timeFromAxis(axis: AxisLabel[], y: number): string | null {
  if (axis.length < 2) return null;
  const a = axis[0];
  const b = axis[axis.length - 1];
  const perPx = (b.minutes - a.minutes) / (b.y - a.y);
  if (!Number.isFinite(perPx) || perPx <= 0) return null;
  // Redondeo a 15 min: la posición es aproximada.
  const minutes = Math.round((a.minutes + (y - a.y) * perPx) / 15) * 15;
  if (minutes < 0 || minutes >= 24 * 60) return null;
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/* ------------------------------------------------------------- análisis */

export function parseCalendarText(lines: OcrLine[], ctx: ParseContext): ParseResult {
  const warnings: string[] = [];
  const normalized = lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text.length > 0);

  const marks = findDateMarks(normalized, ctx.referenceDate);
  const clean = withoutDateWords(normalized, marks.consumed);
  const weekHeaders = marks.week;
  const agendaHeaders: DateHeader[] = [...marks.loose];
  for (const l of clean) {
    const hd = parseDateHeader(l.text, ctx.referenceDate);
    if (hd) agendaHeaders.push({ ...hd, cx: cx(l.bbox), y: cy(l.bbox), bbox: l.bbox });
  }

  let view: CalendarView;
  if (ctx.view !== "auto") view = ctx.view;
  else if (weekHeaders.length >= 2) view = "week";
  else if (marks.loose.length >= 2 && new Set(marks.loose.map((m) => m.date)).size >= 2) view = "agenda";
  else if (agendaHeaders.length >= 1 && weekHeaders.length <= 1) view = agendaHeaders.length >= 2 ? "agenda" : "day";
  else view = "day";

  const axis = view === "agenda" ? [] : findAxis(clean, ctx.imageWidth);
  const headerLineIdx = new Set<number>();
  clean.forEach((l, i) => {
    if (parseDateHeader(l.text, ctx.referenceDate)) headerLineIdx.add(i);
    const onWeekRow = weekHeaders.some((hd) => hd.bbox.y0 >= l.bbox.y0 - 2 && hd.bbox.y1 <= l.bbox.y1 + 2);
    if (onWeekRow && weekHeaders.length >= 2) headerLineIdx.add(i);
  });
  const headerBottom = weekHeaders.length ? Math.max(...weekHeaders.map((hd) => hd.bbox.y1)) : -Infinity;
  const axisRight = axis.length ? Math.max(...axis.map((a) => a.x1)) : -Infinity;
  const gridTop = axis.length ? axis[0].y - (axis.length > 1 ? (axis[1].y - axis[0].y) : 40) : Infinity;

  const isAxisLine = (l: OcrLine) =>
    axis.length > 0 && l.bbox.x1 <= axisRight + 2 && !!findTime(l.text) && !/[a-zñ]{3,}/i.test(l.text.replace(/a\.?\s?m\.?|p\.?\s?m\.?/gi, ""));

  /** Día de un elemento según la vista. */
  const dayFor = (b: Bbox): { date: string | null; weekday: number | null } => {
    if (view === "week" && weekHeaders.length >= 2) {
      // Las cabeceras van centradas en su columna y el texto de los eventos
      // alineado a la izquierda: se usa el borde izquierdo del texto.
      const x = b.x0 + 4;
      const gaps = weekHeaders.slice(1).map((hd, i) => hd.cx - weekHeaders[i].cx);
      const colW = gaps.length ? gaps.sort((a, c) => a - c)[Math.floor(gaps.length / 2)] : Infinity;
      let best = weekHeaders[0];
      for (const hd of weekHeaders) {
        if (x >= hd.cx - colW / 2 && x < hd.cx + colW / 2) {
          best = hd;
          break;
        }
        if (Math.abs(hd.cx - x) < Math.abs(best.cx - x)) best = hd;
      }
      return { date: best.date, weekday: best.weekday };
    }
    if (view === "agenda") {
      const above = agendaHeaders.filter((hd) => hd.bbox.y0 <= b.y0 + 2).sort((a, c) => c.y - a.y)[0];
      // En el móvil, la fecha va a la izquierda del primer evento del día.
      const beside = agendaHeaders.find((hd) => Math.abs(hd.y - cy(b)) < h(b) * 2 && hd.cx < cx(b));
      const hd = beside ?? above;
      return hd ? { date: hd.date, weekday: hd.weekday } : { date: null, weekday: null };
    }
    const single = weekHeaders[0] ?? agendaHeaders[0];
    if (single?.date) return { date: single.date, weekday: single.weekday };
    return { date: ctx.referenceDate, weekday: keyToDate(ctx.referenceDate).getUTCDay() };
  };

  const used = new Set<number>();
  const events: DetectedEvent[] = [];

  const candidates = clean
    .map((l, i) => ({ l, i, t: findTime(l.text) }))
    .filter(({ l, i }) => !headerLineIdx.has(i) && !isAxisLine(l));

  // 1) Líneas con hora.
  for (const { l, i, t } of candidates) {
    if (!t) continue;
    used.add(i);
    let title = cleanTitle(stripTime(l.text, t));
    let titleConf = l.confidence;
    let bbox = l.bbox;
    if (!/[a-zñ]{2,}/i.test(normalizeText(title))) {
      // Título en la línea vecina (encima en semana/día; encima o debajo en agenda).
      const near = clean
        .map((o, j) => ({ o, j }))
        .filter(({ o, j }) => j !== i && !used.has(j) && !headerLineIdx.has(j) && !findTime(o.text) && !isNoise(o.text))
        // Dentro de un bloque de color, el título es el de ese mismo bloque.
        .filter(({ o }) => l.group === undefined || o.group === undefined || o.group === l.group)
        .filter(({ o }) => o.bbox.x0 < l.bbox.x1 && o.bbox.x1 > l.bbox.x0)
        .map(({ o, j }) => ({ o, j, d: cy(o.bbox) - cy(l.bbox) }))
        .filter(({ d }) => Math.abs(d) <= h(l.bbox) * 2.2)
        .sort((a, b) => (a.d < 0 ? 0 : 1) - (b.d < 0 ? 0 : 1) || Math.abs(a.d) - Math.abs(b.d))[0];
      if (near) {
        used.add(near.j);
        title = cleanTitle(near.o.text);
        titleConf = near.o.confidence;
        bbox = {
          x0: Math.min(l.bbox.x0, near.o.bbox.x0),
          y0: Math.min(l.bbox.y0, near.o.bbox.y0),
          x1: Math.max(l.bbox.x1, near.o.bbox.x1),
          y1: Math.max(l.bbox.y1, near.o.bbox.y1),
        };
      } else title = "";
    }
    const { date, weekday } = dayFor(bbox);
    events.push(buildEvent({ title, date, weekday, start: t.start, end: t.end, estimated: false, conf: (l.confidence + titleConf) / 2, raw: l.text, bbox }));
  }

  // 2) Bloques sin hora dentro de la rejilla (vista semana/día): hora estimada.
  for (const { l, i } of candidates) {
    if (used.has(i) || isNoise(l.text)) continue;
    if (view === "agenda") continue;
    const inGrid = l.bbox.y0 > headerBottom && l.bbox.x0 > axisRight;
    if (!inGrid) continue;
    used.add(i);
    const allDay = cy(l.bbox) < gridTop;
    const start = allDay ? null : timeFromAxis(axis, l.bbox.y0);
    const { date, weekday } = dayFor(l.bbox);
    const ev = buildEvent({
      title: cleanTitle(l.text),
      date,
      weekday,
      start,
      end: null,
      estimated: !!start,
      conf: l.confidence,
      raw: l.text,
      bbox: l.bbox,
    });
    if (allDay) ev.issues.unshift("Parece un evento de todo el día (sin hora)");
    events.push(ev);
  }

  if (events.length === 0) warnings.push("No se reconocieron eventos. Prueba a recortar la zona del calendario o a usar una captura más nítida.");
  if (view === "week" && weekHeaders.some((hd) => !hd.date)) warnings.push("Algunas columnas no tienen fecha legible: revisa las fechas propuestas.");
  if (events.some((e) => e.estimatedTime)) warnings.push("Algunas horas se estimaron por la posición en la rejilla: compruébalas.");

  // Mismo evento detectado dos veces (p. ej. título y hora en líneas separadas).
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    const k = `${normalizeText(e.title)}|${e.date}|${e.startTime}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { view, events: unique.sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)), warnings };
}

function buildEvent(p: {
  title: string;
  date: string | null;
  weekday: number | null;
  start: string | null;
  end: string | null;
  estimated: boolean;
  conf: number;
  raw: string;
  bbox: Bbox;
}): DetectedEvent {
  const issues: string[] = [];
  let confidence = Math.max(0, Math.min(1, p.conf / 100));
  if (!p.title) {
    issues.push("Nombre no legible: escríbelo");
    confidence *= 0.4;
  } else if (p.title.length < 3) {
    issues.push("Nombre muy corto: compruébalo");
    confidence *= 0.7;
  }
  if (!p.date) {
    issues.push("Fecha no legible: confírmala");
    confidence *= 0.6;
  }
  if (!p.start) {
    issues.push("Hora no legible");
    confidence *= 0.5;
  } else if (p.estimated) {
    issues.push("Hora estimada por la posición");
    confidence *= 0.75;
  }
  if (p.start && !p.end && !p.estimated) confidence *= 0.95;
  const key = `${p.date ?? "?"}|${p.start ?? "?"}|${normalizeText(p.title)}|${Math.round(p.bbox.x0)}:${Math.round(p.bbox.y0)}`;
  return {
    key,
    title: p.title,
    date: p.date,
    weekday: p.weekday,
    startTime: p.start,
    endTime: p.end,
    durationMin: p.start && p.end ? minutesBetween(p.start, p.end) : null,
    estimatedTime: p.estimated,
    confidence: Math.round(confidence * 100) / 100,
    issues,
    raw: p.raw,
    bbox: p.bbox,
  };
}
