/**
 * Dinero en unidades menores enteras (céntimos).
 *
 * Todo importe que se guarda, se suma o se compara es un entero: 1.234,56 se
 * guarda como 123456. La coma flotante solo aparece al PINTAR (dividir entre
 * 100 para Intl), nunca al calcular. Así 0,10 + 0,20 da exactamente 0,30 y un
 * saldo con miles de movimientos no acumula error.
 */

export const MINOR_PER_UNIT = 100;
/** Tope por importe: 10^13 céntimos (100 billones). Muy por debajo de 2^53. */
export const MAX_AMOUNT = 10_000_000_000_000;

export const CURRENCIES = [
  { code: "COP", name: "Peso colombiano" },
  { code: "USD", name: "Dólar estadounidense" },
  { code: "EUR", name: "Euro" },
  { code: "MXN", name: "Peso mexicano" },
  { code: "ARS", name: "Peso argentino" },
  { code: "CLP", name: "Peso chileno" },
  { code: "PEN", name: "Sol peruano" },
  { code: "BRL", name: "Real brasileño" },
  { code: "GBP", name: "Libra esterlina" },
] as const;

export function isCurrencyCode(v: string): boolean {
  return /^[A-Z]{3}$/.test(v);
}

/**
 * Convierte lo que teclea el usuario en céntimos, SIN pasar por `parseFloat`.
 *
 * Acepta `1234`, `1234.5`, `1234,56`, `1.234,56`, `1,234.56`, `-20`, `$ 1 200`.
 * Regla de separadores: si aparecen `.` y `,`, el ÚLTIMO es el decimal; si
 * solo aparece uno, es decimal cuando le siguen 1 o 2 dígitos una sola vez
 * (`12,5`) y de miles en otro caso (`1.200.000`).
 *
 * Devuelve null si el texto no es un importe válido o tiene más de 2 decimales.
 */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    // Redondeo a céntimo del número recibido (p. ej. de un CSV ya numérico).
    const cents = Math.round(input * MINOR_PER_UNIT);
    return Math.abs(cents) > MAX_AMOUNT ? null : cents;
  }

  let s = input.trim().replace(/[\s $€£]/g, "").replace(/^[A-Z]{3}/i, "");
  if (!s) return null;

  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("(") && s.endsWith(")")) {
    negative = true; // notación contable (1.200,00)
    s = s.slice(1, -1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let intPart = s;
  let fracPart = "";

  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma);
    const decChar = s[dec];
    const groupChar = decChar === "." ? "," : ".";
    const head = s.slice(0, dec);
    // La parte entera solo puede llevar el separador de miles, en grupos de 3.
    if (head.includes(decChar)) return null;
    const groups = head.split(groupChar);
    if (!groups.every((g, i) => (i === 0 ? g.length >= 1 && g.length <= 3 : g.length === 3))) return null;
    intPart = groups.join("");
    fracPart = s.slice(dec + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    if (parts.length === 2 && tail.length <= 2) {
      // "12," o "12." (a medio teclear) valen 12; "12,5" vale 12,50.
      intPart = parts[0];
      fracPart = tail;
    } else if (parts.every((p, i) => (i === 0 ? p.length >= 1 && p.length <= 3 : p.length === 3))) {
      intPart = parts.join(""); // separador de miles
    } else {
      return null;
    }
  }

  if (!/^\d*$/.test(intPart) || !/^\d{0,2}$/.test(fracPart)) return null;
  if (!intPart && !fracPart) return null;

  const cents = Number(intPart || "0") * MINOR_PER_UNIT + Number(fracPart.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT) return null;
  return negative ? -cents : cents;
}

/** Céntimos -> texto editable estable (`1234.5` -> "1234.50"), sin separador de miles. */
export function toInputValue(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const int = Math.floor(abs / MINOR_PER_UNIT);
  const frac = abs % MINOR_PER_UNIT;
  return frac === 0 ? `${sign}${int}` : `${sign}${int}.${String(frac).padStart(2, "0")}`;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, locale: string, compact: boolean): Intl.NumberFormat {
  const key = `${locale}|${currency}|${compact}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        notation: compact ? "compact" : "standard",
        maximumFractionDigits: compact ? 1 : 2,
        minimumFractionDigits: compact ? 0 : undefined,
      });
    } catch {
      // Código de moneda que el motor no conoce: se pinta como número + código.
      f = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    }
    formatters.set(key, f);
  }
  return f;
}

/** Pinta céntimos como moneda. `compact` = "1,2 M" para ejes y KPIs estrechos. */
export function formatMoney(
  cents: number,
  currency = "COP",
  opts: { locale?: string; compact?: boolean; signed?: boolean } = {}
): string {
  const locale = opts.locale ?? "es-CO";
  const text = formatter(currency, locale, !!opts.compact).format(cents / MINOR_PER_UNIT);
  if (opts.signed && cents > 0) return `+${text}`;
  return text;
}

/** Suma exacta de enteros; lanza si algún sumando no es un entero seguro. */
export function sumCents(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) {
    if (!Number.isSafeInteger(v)) throw new Error("Importe no entero");
    total += v;
  }
  return total;
}

/** Porcentaje 0..∞ (no se recorta: 130 % de un presupuesto es información). */
export function percent(part: number, whole: number): number {
  if (whole === 0) return part > 0 ? 100 : 0;
  return (part / whole) * 100;
}

/** Aplica un porcentaje a céntimos y redondea al céntimo (redondeo bancario no necesario aquí). */
export function applyPercent(cents: number, pct: number): number {
  return Math.round((cents * pct) / 100);
}
