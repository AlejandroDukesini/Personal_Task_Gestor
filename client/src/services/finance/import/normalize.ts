/**
 * Normalización tolerante de los valores que llegan de ficheros ajenos.
 *
 * El formulario de la app es estricto a propósito (`parseMoney`, `isDateKey`):
 * lo que teclea el usuario se corrige en el momento. Un fichero exportado por
 * otro programa no se puede corregir tecleando, así que aquí se acepta todo lo
 * que tenga una interpretación inequívoca y se informa de lo que se ajustó.
 * Nada de esto adivina: si un valor admite dos lecturas, se usa la que marca
 * la columna entera (ver `detectDateOrder` y `detectDecimal`) y, si no hay
 * pistas, la convención de la app, avisando.
 */

import { MAX_AMOUNT } from "@/lib/money";
import { isDateKey, toKey } from "../dates";
import type { FinTxKind } from "@/services/localDb";

export type Cell = string | number | boolean | null;

/** Minúsculas, sin tildes y con los separadores reducidos a un espacio. */
export function normKey(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9$€£#+-]+/g, " ")
    .trim();
}

export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** Texto limpio: sin caracteres de control (salvo saltos de línea) ni espacios sobrantes. */
export function cleanText(v: unknown): string {
  if (isBlank(v)) return "";
  return String(v)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[   ]/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ fechas */

export type DateOrder = "dmy" | "mdy" | "ymd";

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, jan: 1, january: 1, janeiro: 1,
  feb: 2, febrero: 2, february: 2, fev: 2, fevereiro: 2,
  mar: 3, marzo: 3, march: 3, marco: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5, mai: 5, maio: 5,
  jun: 6, junio: 6, june: 6, junho: 6,
  jul: 7, julio: 7, july: 7, julho: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  sep: 9, sept: 9, set: 9, septiembre: 9, setiembre: 9, september: 9, setembro: 9,
  oct: 10, octubre: 10, october: 10, out: 10, outubro: 10,
  nov: 11, noviembre: 11, november: 11, novembro: 11,
  dic: 12, diciembre: 12, dec: 12, december: 12, dez: 12, dezembro: 12,
};

const DMY_RE = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4}|\d{2})(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*([ap]\.?\s?m\.?)?)?$/i;
const YMD_RE = /^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

export interface DateResult {
  date: string | null;
  /** Instante en ms cuando el valor traía hora (para emparejar transferencias). */
  ts?: number;
  /** Ajuste aplicado que conviene contar al usuario. */
  fixed?: string;
  error?: string;
}

function keyFrom(y: number, m: number, d: number): string | null {
  const key = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isDateKey(key) ? key : null;
}

function fullYear(y: string): { year: number; fixed?: string } {
  if (y.length === 4) return { year: Number(y) };
  const n = Number(y);
  // Ventana habitual de las hojas de cálculo: 00-69 -> 2000s, 70-99 -> 1900s.
  const year = n < 70 ? 2000 + n : 1900 + n;
  return { year, fixed: `Año de 2 cifras interpretado como ${year}` };
}

/** Fecha desde un número: AAAAMMDD, serial de Excel o timestamp Unix (s, ms o µs). */
export type ZonePolicy = "local" | "utc";

/** Día de un instante según la política: reloj local del dispositivo o UTC. */
function dayOf(ms: number, zone: ZonePolicy): string {
  const d = new Date(ms);
  if (zone === "local") return toKey(d);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function fromNumber(n: number, zone: ZonePolicy = "local"): DateResult {
  if (!Number.isFinite(n) || n <= 0) return { date: null, error: "Número que no representa una fecha" };
  if (Number.isInteger(n) && n >= 19000101 && n <= 21001231) {
    const s = String(n);
    const key = keyFrom(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
    if (key) return { date: key };
  }
  let ms: number | null = null;
  if (n >= 1e8 && n < 1e11) ms = n * 1000; // segundos (1973-5138)
  else if (n >= 1e11 && n < 1e14) ms = n; // milisegundos
  else if (n >= 1e14 && n < 1e17) ms = n / 1000; // microsegundos
  if (ms !== null) {
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? { date: null, error: "Timestamp fuera de rango" } : { date: dayOf(ms, zone), ts: ms };
  }
  if (n >= 1 && n < 2958466) {
    // Serial de Excel: días desde 1899-12-30 (incluye el falso 29-feb-1900).
    const whole = Math.floor(n);
    const d = new Date(1899, 11, 30 + whole);
    const secs = Math.round((n - whole) * 86400);
    d.setSeconds(secs);
    return { date: toKey(d), ts: d.getTime() };
  }
  return { date: null, error: "Número que no representa una fecha" };
}

function withTime(y: number, m: number, d: number, h?: string, mi?: string, s?: string, ampm?: string): number {
  let hour = Number(h ?? 0);
  if (ampm) {
    const pm = /^p/i.test(ampm);
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  return new Date(y, m - 1, d, hour, Number(mi ?? 0), Number(s ?? 0)).getTime();
}

/**
 * Convierte casi cualquier fecha a clave de día local `AAAA-MM-DD`.
 *
 * Admite ISO con o sin hora, milisegundos y zona (`2026-09-26T23:34:31.000Z`),
 * `DD/MM/AAAA`, `MM/DD/AAAA`, años de 2 cifras, nombres de mes en español,
 * inglés y portugués, `AAAAMMDD`, seriales de Excel y timestamps Unix.
 * `order` decide solo los casos ambiguos (`03/04/2026`).
 */
export function parseFlexibleDate(v: unknown, order: DateOrder = "dmy", zone: ZonePolicy = "local"): DateResult {
  if (isBlank(v)) return { date: null, error: "Fecha vacía" };
  if (typeof v === "number") return fromNumber(v, zone);
  if (typeof v === "boolean") return { date: null, error: "No es una fecha" };
  const s = cleanText(v).replace(/\s+/g, " ");

  if (/^\d+(\.\d+)?$/.test(s)) return fromNumber(Number(s), zone);

  let m = s.match(YMD_RE);
  if (m) {
    const [, y, mo, d, h, mi, sec, tz] = m;
    if (tz) {
      // Instante con zona: el día contable lo decide la política (`local` o `utc`).
      const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${(h ?? "0").padStart(2, "0")}:${mi ?? "00"}:${sec ?? "00"}${tz.length === 3 ? `${tz}:00` : tz.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")}`;
      const t = Date.parse(iso);
      if (!Number.isNaN(t)) return { date: dayOf(t, zone), ts: t };
    }
    const key = keyFrom(Number(y), Number(mo), Number(d));
    if (!key) return { date: null, error: "Fecha imposible (día o mes fuera de rango)" };
    return { date: key, ts: h ? withTime(Number(y), Number(mo), Number(d), h, mi, sec) : undefined };
  }

  m = s.match(DMY_RE);
  if (m) {
    const [, a, b, yRaw, h, mi, sec, ampm] = m;
    const { year, fixed } = fullYear(yRaw);
    let day = Number(a);
    let month = Number(b);
    if (order === "mdy") [day, month] = [month, day];
    // Si el orden elegido es imposible pero el otro no, el dato manda.
    let note = fixed;
    if (month > 12 && day <= 12) {
      [day, month] = [month, day];
      note = [note, "Día y mes intercambiados (el mes no puede ser mayor que 12)"].filter(Boolean).join(". ");
    }
    const key = keyFrom(year, month, day);
    if (!key) return { date: null, error: "Fecha imposible (día o mes fuera de rango)" };
    return { date: key, ts: h ? withTime(year, month, day, h, mi, sec, ampm) : undefined, fixed: note };
  }

  // Con nombre de mes: "26 sep 2026", "26 de septiembre de 2026", "Sep 26, 2026".
  const words = normKey(s).replace(/[^a-z0-9.]+/g, " ").replace(/\bde\b|\bdel\b|\bof\b/g, " ").split(/\s+/).filter(Boolean);
  const monthIdx = words.findIndex((w) => MONTHS[w.replace(/\.$/, "")] !== undefined);
  if (monthIdx >= 0) {
    const month = MONTHS[words[monthIdx].replace(/\.$/, "")];
    const nums = words.filter((w, i) => i !== monthIdx && /^\d{1,4}$/.test(w));
    const yearTok = nums.find((w) => w.length === 4) ?? nums.find((w, i) => i > 0 && w.length === 2);
    const dayTok = nums.find((w) => w !== yearTok && w.length <= 2);
    if (yearTok && dayTok) {
      const { year, fixed } = fullYear(yearTok);
      const key = keyFrom(year, month, Number(dayTok));
      if (key) return { date: key, fixed };
    }
  }

  return { date: null, error: "Formato de fecha no reconocido" };
}

/**
 * Orden día/mes de una columna entera. Un solo `25/03/2026` basta para saber
 * que la columna es DD/MM; si ningún valor lo decide, `ambiguous` = true.
 */
export function detectDateOrder(values: unknown[]): { order: DateOrder; ambiguous: boolean } {
  let dmy = 0;
  let mdy = 0;
  let pairs = 0;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const m = v.trim().match(/^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})\b/);
    if (!m) continue;
    pairs++;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  if (mdy > dmy) return { order: "mdy", ambiguous: false };
  return { order: "dmy", ambiguous: pairs > 0 && dmy === 0 };
}

/* ---------------------------------------------------------------- importes */

export type DecimalSep = "," | ".";

const SYMBOLS: [RegExp, string | null][] = [
  [/US\$|U\$S|USD\$/i, "USD"],
  [/R\$/i, "BRL"],
  [/S\/\.?/i, "PEN"],
  [/COL\$|COP\$/i, "COP"],
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/¥/, "JPY"],
  [/\$/, null], // «$» a secas: la moneda la pone la cuenta
];

export interface AmountResult {
  /** Céntimos con signo. */
  cents: number | null;
  /** Moneda ISO leída junto al importe (`USD 20`, `12 €`). */
  currency?: string | null;
  fixed?: string;
  /** El redondeo a céntimos cambia el valor más de un 1 % (p. ej. 0,007 BTC). */
  lossy?: boolean;
  /** Hubo que redondear a céntimos (más de 2 decimales reales). */
  rounded?: boolean;
  error?: string;
}

function stripCurrency(s: string): { rest: string; currency: string | null; found: boolean } {
  let currency: string | null = null;
  let found = false;
  for (const [re, code] of SYMBOLS) {
    if (re.test(s)) {
      s = s.replace(re, " ");
      found = true;
      currency = currency ?? code;
    }
  }
  const iso = s.match(/(^|[^A-Za-z])([A-Za-z]{3})(?![A-Za-z])/);
  if (iso && !/^(cr|dr)$/i.test(iso[2])) {
    currency = currency ?? iso[2].toUpperCase();
    s = s.replace(iso[2], " ");
    found = true;
  }
  return { rest: s, currency, found };
}

/**
 * Decide el separador decimal de una columna a partir de los valores que no
 * admiten dos lecturas (`1.234,56`, `12,5`, `0.007`). Null si ninguno decide.
 */
/**
 * ¿Hay importes que admiten dos lecturas (`1.234` = 1234 o 1,234) y ninguno
 * en la columna que lo decida? Entonces hay que preguntar.
 */
export function decimalAmbiguous(values: unknown[]): boolean {
  if (detectDecimal(values) !== null) return false;
  return values.some((v) => typeof v === "string" && /^\s*[-+(]?\s*\D{0,4}\s*[1-9]\d{0,2}[.,]\d{3}\s*\D{0,4}\)?\s*$/.test(v));
}

export function detectDecimal(values: unknown[]): DecimalSep | null {
  let comma = 0;
  let dot = 0;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const s = stripCurrency(v).rest.replace(/[^\d.,]/g, "");
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastDot >= 0 && lastComma >= 0) {
      if (lastComma > lastDot) comma++;
      else dot++;
      continue;
    }
    for (const [sep, other] of [[".", ","], [",", "."]] as const) {
      const parts = s.split(sep);
      if (parts.length < 2) continue;
      if (parts.length > 2) {
        // Varias apariciones: es el separador de miles, luego el decimal es el otro.
        if (other === ",") comma++;
        else dot++;
      } else if (parts[1].length !== 3 || /^0+$/.test(parts[0]) || parts[0] === "") {
        if (sep === ",") comma++;
        else dot++;
      }
    }
  }
  if (!comma && !dot) return null;
  return comma > dot ? "," : ".";
}

/** Texto decimal (`-1234.5678`) -> céntimos redondeados (mitad hacia fuera). */
function decimalToCents(int: string, frac: string, negative: boolean): { cents: number; rounded: boolean } {
  const f = (frac + "000").slice(0, 3);
  let cents = Number(int || "0") * 100 + Number(f.slice(0, 2));
  if (Number(f[2]) >= 5) cents += 1;
  // `39999.99999999999` es ruido de coma flotante del programa de origen, no un ajuste real.
  const noise = frac.length >= 8 && Math.abs(Number(`0.${frac}`) * 100 - Math.round(Number(`0.${frac}`) * 100)) < 1e-4;
  const rounded = frac.length > 2 && /[1-9]/.test(frac.slice(2)) && !noise;
  return { cents: negative ? -cents : cents, rounded };
}

/**
 * Importe tolerante -> céntimos. Admite separadores de miles y decimales de
 * cualquier convención, símbolos y códigos de moneda, `(1.200)` contable,
 * signo al final (`20-`), sufijos `CR`/`DR`, notación científica y más de 2
 * decimales (se redondea al céntimo y se avisa).
 */
export function parseFlexibleAmount(v: unknown, decimal: DecimalSep | null = null): AmountResult {
  if (isBlank(v)) return { cents: null, error: "Importe vacío" };
  if (typeof v === "boolean") return { cents: null, error: "No es un importe" };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return { cents: null, error: "Importe no numérico" };
    const exact = v * 100;
    const cents = Math.round(exact);
    if (Math.abs(cents) > MAX_AMOUNT) return { cents: null, error: "Importe demasiado grande" };
    // El ruido de coma flotante (39999.99999999999) no es un ajuste real.
    const rounded = Math.abs(exact - cents) > 1e-6;
    return { cents, rounded, fixed: rounded ? `Redondeado a 2 decimales (${v})` : undefined, lossy: rounded && Math.abs(exact - cents) > Math.abs(exact) * 0.01 };
  }

  let s = cleanText(v).replace(/[−‒–]/g, "-").replace(/\s+/g, " ");
  let negative = false;
  if (/\bDR$/i.test(s)) {
    negative = true;
    s = s.replace(/\s*DR$/i, "");
  } else s = s.replace(/\s*CR$/i, "");
  const cur = stripCurrency(s);
  s = cur.rest.replace(/\s|'|’/g, "");
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (!s) return { cents: null, error: cur.found ? "No contiene ningún número" : "Importe vacío" };

  if (/^\d+(\.\d+)?e[-+]?\d+$/i.test(s)) {
    const r = parseFlexibleAmount(Number(s) * (negative ? -1 : 1));
    return { ...r, currency: cur.currency };
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return { cents: null, error: "El importe contiene caracteres no numéricos" };

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let int = s;
  let frac = "";
  let note: string | undefined;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma);
    const head = s.slice(0, dec);
    frac = s.slice(dec + 1);
    // Antes del decimal solo va el separador de miles, en grupos de 2-3 cifras (1,23,456.78 también vale).
    const groups = head.split(s[dec] === "." ? "," : ".");
    if (head.includes(s[dec]) || !groups.every((g, i) => (i === 0 ? /^\d{1,3}$/.test(g) : /^\d{2,3}$/.test(g)))) {
      return { cents: null, error: "Separadores de miles y decimales mezclados" };
    }
    int = groups.join("");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    const groupsOk = parts.every((p, i) => (i === 0 ? p.length >= 1 && p.length <= 3 && !/^0/.test(p) : p.length === 3));
    let isDecimal: boolean;
    if (parts.length > 2) isDecimal = false;
    else if (decimal) isDecimal = sep === decimal || !groupsOk;
    else isDecimal = tail.length !== 3 || !groupsOk;
    if (isDecimal && parts.length > 2) return { cents: null, error: "Separador decimal repetido" };
    if (!isDecimal && !groupsOk) {
      return { cents: null, error: `No se puede interpretar «${cleanText(v)}» (grupos de miles irregulares)` };
    }
    if (isDecimal) {
      int = parts[0];
      frac = tail;
      if (decimal && sep !== decimal) note = `«${sep}» leído como separador decimal`;
    } else int = parts.join("");
  }
  if (!/^\d*$/.test(int) || !/^\d*$/.test(frac)) return { cents: null, error: "Importe no válido" };
  if (int.length > 14) return { cents: null, error: "Importe demasiado grande" };
  const { cents, rounded } = decimalToCents(int, frac, negative);
  if (Math.abs(cents) > MAX_AMOUNT) return { cents: null, error: "Importe demasiado grande" };
  const fixes = [note, rounded ? `Redondeado a 2 decimales (${int || "0"}.${frac})` : undefined].filter(Boolean);
  const exact = Number(`${int || "0"}.${frac || "0"}`) * 100;
  return {
    cents,
    currency: cur.currency,
    fixed: fixes.length ? fixes.join(". ") : undefined,
    rounded,
    lossy: rounded && Math.abs(exact - Math.abs(cents)) > exact * 0.01,
  };
}

/* -------------------------------------------------- tipos, booleanos, moneda */

const KIND_WORDS: Record<string, FinTxKind> = {};
const addKinds = (kind: FinTxKind, words: string) => words.split("|").forEach((w) => (KIND_WORDS[w] = kind));
addKinds("income", "ingreso|ingresos|income|incomes|entrada|entradas|abono|abonos|credito|creditos|credit|deposito|depositos|deposit|cobro|cobros|in|+|receita|revenue|inflow|recibido|received|haber");
addKinds("expense", "gasto|gastos|egreso|egresos|expense|expenses|salida|salidas|cargo|cargos|debito|debitos|debit|retiro|retiros|withdrawal|pago|pagos|payment|compra|compras|purchase|out|-|despesa|outflow|spent|debe");
addKinds("transfer", "transferencia|transferencias|transfer|transfers|traspaso|traspasos|transferencia interna|movimiento entre cuentas|internal transfer");
addKinds("adjustment", "correccion|correcciones|ajuste|ajustes|adjustment|adjust|balance correction|correccion de balance|correccion de saldo|ajuste de saldo|reconciliacion|reconciliation");

export function parseKind(v: unknown): FinTxKind | null {
  const k = normKey(v);
  return k ? KIND_WORDS[k] ?? null : null;
}

/** Categorías que en otros programas significan «corrección de saldo» (Cashew: «Corrección de Balance»). */
export function isBalanceCorrection(category: unknown): boolean {
  return /^(correccion de (balance|saldo)|balance correction|ajuste de saldo)$/.test(normKey(category));
}

const TRUE_WORDS = new Set(["true", "verdadero", "si", "yes", "y", "s", "1", "x", "sim", "vrai"]);
const FALSE_WORDS = new Set(["false", "falso", "no", "n", "0", "nao", "faux"]);

export function parseBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  const k = normKey(v);
  if (TRUE_WORDS.has(k)) return true;
  if (FALSE_WORDS.has(k)) return false;
  return null;
}

const CURRENCY_NAMES: Record<string, string> = {
  "$": "",
  "€": "EUR",
  "£": "GBP",
  "us$": "USD",
  "r$": "BRL",
  dolar: "USD",
  dolares: "USD",
  euro: "EUR",
  euros: "EUR",
  "peso colombiano": "COP",
  "pesos colombianos": "COP",
};

/** Moneda normalizada: código ISO en mayúsculas, "" si no se sabe, o `{ invalid }`. */
export function parseCurrency(v: unknown): { code: string } | { invalid: string } {
  const raw = cleanText(v);
  if (!raw) return { code: "" };
  const k = raw.toLowerCase();
  if (CURRENCY_NAMES[k] !== undefined) return { code: CURRENCY_NAMES[k] };
  const up = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(up)) return { code: up };
  return { invalid: raw };
}

/** `0XFF66BB6A` (ARGB de Cashew/Android) o `#66bb6a` -> `#66bb6a`. */
export function parseColor(v: unknown): string | null {
  const s = cleanText(v);
  const argb = s.match(/^0x[0-9a-f]{2}([0-9a-f]{6})$/i);
  if (argb) return `#${argb[1].toLowerCase()}`;
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null;
}
