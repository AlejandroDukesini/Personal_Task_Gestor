/**
 * Motor de cálculos de las notas.
 *
 * - Analizador propio (descenso recursivo) que solo admite números, `+ - * /`
 *   (también `× ÷ ·`), paréntesis, signo y `%`. Nunca se usa `eval`,
 *   `Function` ni nada que ejecute código: una expresión que no encaja en la
 *   gramática es simplemente «no válida».
 * - Aritmética EXACTA con fracciones de `BigInt`: `0.1 + 0.2` da `0.3`, no
 *   `0.30000000000000004`. Solo se redondea al PRESENTAR el resultado.
 * - Límites de tamaño (longitud, cifras, profundidad) para que una expresión
 *   enorme no bloquee el editor.
 *
 * Convención de porcentaje (inequívoca y documentada): `x%` significa
 * `x / 100` siempre. Así `200*10% = 20` y `50% = 0.5`; `200+10%` es
 * `200 + 0.1` (no «200 más su 10 %», que es otra convención de calculadora).
 */

/* ----------------------------------------------------------- fracciones */

export interface Ratio {
  n: bigint;
  d: bigint;
}

const abs = (x: bigint) => (x < 0n ? -x : x);
function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}
function ratio(n: bigint, d: bigint): Ratio {
  if (d === 0n) throw new MathError("División entre cero");
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const add = (a: Ratio, b: Ratio) => ratio(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Ratio, b: Ratio) => ratio(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Ratio, b: Ratio) => ratio(a.n * b.n, a.d * b.d);
const div = (a: Ratio, b: Ratio) => {
  if (b.n === 0n) throw new MathError("División entre cero");
  return ratio(a.n * b.d, a.d * b.n);
};

export class MathError extends Error {}

/* ------------------------------------------------------------ analizador */

export const MAX_EXPRESSION = 200;
const MAX_DIGITS = 30;
const MAX_DEPTH = 40;
/** Tope de magnitud de los resultados intermedios (evita BigInt gigantes). */
const MAX_BITS = 2000n;

type Tok = { t: "num"; v: Ratio; raw: string } | { t: "op"; v: string };

const OPS: Record<string, string> = { "+": "+", "-": "-", "−": "-", "*": "*", "×": "*", "·": "*", "/": "/", "÷": "/", "(": "(", ")": ")", "%": "%" };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (OPS[ch]) {
      out.push({ t: "op", v: OPS[ch] });
      i++;
      continue;
    }
    const m = /^(\d+(?:[.,]\d+)?|[.,]\d+)/.exec(src.slice(i, i + MAX_DIGITS + 2));
    if (!m) throw new MathError(`Carácter no admitido «${ch}»`);
    const raw = m[1];
    const [int, frac = ""] = raw.split(/[.,]/);
    if (int.length + frac.length > MAX_DIGITS) throw new MathError("Número demasiado largo");
    out.push({ t: "num", raw, v: ratio(BigInt((int || "0") + frac), 10n ** BigInt(frac.length)) });
    i += raw.length;
  }
  return out;
}

class Parser {
  private i = 0;
  private depth = 0;
  constructor(private readonly toks: Tok[]) {}

  parse(): Ratio {
    if (!this.toks.length) throw new MathError("Expresión vacía");
    const v = this.expr();
    if (this.i < this.toks.length) throw new MathError("Expresión incompleta o mal formada");
    return v;
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }
  private isOp(v: string) {
    const t = this.peek();
    return t?.t === "op" && t.v === v;
  }
  private guard(r: Ratio): Ratio {
    if (BigInt(r.n.toString(2).length) > MAX_BITS || BigInt(r.d.toString(2).length) > MAX_BITS) throw new MathError("Resultado demasiado grande");
    return r;
  }

  private expr(): Ratio {
    let v = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.toks[this.i++] as { v: string }).v;
      const r = this.term();
      v = this.guard(op === "+" ? add(v, r) : sub(v, r));
    }
    return v;
  }

  private term(): Ratio {
    let v = this.factor();
    while (this.isOp("*") || this.isOp("/")) {
      const op = (this.toks[this.i++] as { v: string }).v;
      const r = this.factor();
      v = this.guard(op === "*" ? mul(v, r) : div(v, r));
    }
    return v;
  }

  private factor(): Ratio {
    if (++this.depth > MAX_DEPTH) throw new MathError("Demasiados niveles de anidación");
    try {
      if (this.isOp("-") || this.isOp("+")) {
        const neg = (this.toks[this.i++] as { v: string }).v === "-";
        const v = this.factor();
        return neg ? { n: -v.n, d: v.d } : v;
      }
      let v = this.primary();
      while (this.isOp("%")) {
        this.i++;
        v = div(v, { n: 100n, d: 1n });
      }
      return v;
    } finally {
      this.depth--;
    }
  }

  private primary(): Ratio {
    const t = this.peek();
    if (!t) throw new MathError("Expresión incompleta");
    if (t.t === "num") {
      this.i++;
      return t.v;
    }
    if (t.v === "(") {
      this.i++;
      const v = this.expr();
      if (!this.isOp(")")) throw new MathError("Falta cerrar un paréntesis");
      this.i++;
      return v;
    }
    throw new MathError("Expresión incompleta o mal formada");
  }
}

/** Evalúa una expresión (lanza `MathError` si no es válida). */
export function evaluate(expression: string): Ratio {
  if (expression.length > MAX_EXPRESSION) throw new MathError("Expresión demasiado larga");
  return new Parser(tokenize(expression)).parse();
}

/* ----------------------------------------------------------- presentación */

export interface FormatOptions {
  /** Decimales fijos (0-10). `null` = automático: hasta 10, sin ceros sobrantes. */
  decimals: number | null;
  /** Separador decimal de salida (el mismo que usó la expresión). */
  separator?: "." | ",";
}

export const AUTO_DECIMALS = 10;

/**
 * Fracción -> texto decimal. Redondeo «mitad lejos de cero» (el escolar:
 * 2,5 -> 3; -2,5 -> -3) solo en la cifra mostrada. `exact` indica si el texto
 * representa el valor sin redondear.
 */
export function formatRatio(r: Ratio, opts: FormatOptions = { decimals: null }): { text: string; exact: boolean } {
  const places = opts.decimals ?? AUTO_DECIMALS;
  const scale = 10n ** BigInt(places);
  const neg = r.n < 0n;
  const num = abs(r.n) * scale;
  let q = num / r.d;
  const rem = num % r.d;
  if (rem * 2n >= r.d) q += 1n;
  const exact = rem === 0n;
  let int = (q / scale).toString();
  let frac = places ? (q % scale).toString().padStart(places, "0") : "";
  if (opts.decimals === null) frac = frac.replace(/0+$/, "");
  if (q === 0n) int = "0";
  const sep = opts.separator ?? ".";
  const text = `${neg && q !== 0n ? "-" : ""}${int}${frac ? sep + frac : ""}`;
  return { text, exact };
}

/* ------------------------------------------------- reconocimiento en texto */

export interface Calculation {
  /** Índice del primer carácter de la expresión dentro del texto. */
  from: number;
  /** Índice del signo `=`. */
  eq: number;
  expression: string;
  /** Resultado formateado o null si la expresión no es válida. */
  result: string | null;
  exact: boolean;
  error: string | null;
  /**
   * El usuario ya escribió un número tras el `=`: el resultado es manual.
   * `manualTo` marca su fin y `mismatch` si no coincide con el cálculo.
   */
  manual: { from: number; to: number; text: string; mismatch: boolean } | null;
}

/** Caracteres que pueden formar parte de una expresión. */
const EXPR_CHAR = /[0-9.,+\-−*×·/÷()%  ]/;
/** Lo que no puede ir pegado ANTES de una expresión (evita «abc12+3», «v1.2+1»). */
const WORD_CHAR = /[\p{L}\p{N}_#@$€£:'"´`]/u;

/** 2026-09-26, 2026/9/26, 26/09/2026, 26-9-26 (no 100-20-5 ni 12-5-3). */
const DATE_LIKE = /^\s*(\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}|\d{1,2}[/\-.]\d{1,2}[/\-.](\d{2}|\d{4}))\s*$/;
/** 300-555-1234: tres o más grupos de 3+ cifras unidos por guiones. */
const PHONE_LIKE = /^\s*\d{3,}(-\d{3,}){2,}\s*$/;
const LEADING_ZERO_ID = /(^|[^\d.,])0\d/;
const HAS_BINARY_OP = /\d\s*\)*\s*%?\s*[+\-−*×·/÷]\s*[(\-+−]*\s*[\d.,(]/;

/** ¿Tiene forma de cálculo y no de fecha, teléfono o identificador? */
export function looksLikeCalculation(expr: string): boolean {
  const e = expr.trim();
  if (!e || !/\d/.test(e) || !HAS_BINARY_OP.test(e)) return false;
  if (DATE_LIKE.test(e) || PHONE_LIKE.test(e)) return false;
  // Números con ceros a la izquierda (007, 0123): códigos, no cantidades.
  if (LEADING_ZERO_ID.test(e)) return false;
  return true;
}

function separatorOf(expr: string): "." | "," {
  return /\d,\d/.test(expr) && !/\d\.\d/.test(expr) ? "," : ".";
}

/**
 * Busca cálculos `expresión=` en un texto (un párrafo). Solo cuenta un `=`
 * que no sea parte de `==`, `<=`, `>=`, `!=`, `=>` y cuya expresión empiece en
 * un límite de palabra. Si la expresión completa no es válida se prueba el
 * sufijo más largo que sí lo sea («Tengo 3 cajas y 2+2=» -> «2+2»).
 */
export function findCalculations(text: string, opts: FormatOptions = { decimals: null }): Calculation[] {
  const out: Calculation[] = [];
  for (let eq = text.indexOf("="); eq >= 0; eq = text.indexOf("=", eq + 1)) {
    const prev = text[eq - 1];
    const next = text[eq + 1];
    if (prev === "=" || prev === "<" || prev === ">" || prev === "!" || next === "=" || next === ">") continue;

    // Hacia atrás: el tramo máximo de caracteres de expresión.
    let start = eq;
    while (start > 0 && EXPR_CHAR.test(text[start - 1]) && eq - start < MAX_EXPRESSION) start--;
    if (start > 0 && WORD_CHAR.test(text[start - 1])) {
      // Pegado a una palabra: solo vale si hay un espacio que lo separe dentro del tramo.
      const firstSpace = text.slice(start, eq).search(/[  ]/);
      if (firstSpace < 0) continue;
      start += firstSpace + 1;
    }

    // Candidatos: el tramo entero y sus sufijos que empiezan tras un espacio.
    const segment = text.slice(start, eq);
    const offsets = [0];
    for (let k = 0; k < segment.length; k++) if (/[  ]/.test(segment[k]) && k + 1 < segment.length) offsets.push(k + 1);
    let found: Calculation | null = null;
    let firstError: { from: number; expr: string; message: string } | null = null;
    for (const off of offsets) {
      const expr = segment.slice(off).trim();
      // Un cálculo completo, o uno a medias que termina en operador («2+=»).
      const incomplete = /^[(\-+−]*\d/.test(expr) && /[+\-−*×·/÷(]\s*$/.test(expr) && !LEADING_ZERO_ID.test(expr);
      if (!expr || !(looksLikeCalculation(expr) || incomplete)) continue;
      const from = start + off + (segment.slice(off).length - segment.slice(off).trimStart().length);
      try {
        const value = evaluate(expr);
        const sep = separatorOf(expr);
        const { text: result, exact } = formatRatio(value, { ...opts, separator: sep });
        found = { from, eq, expression: expr, result, exact, error: null, manual: null };
        break;
      } catch (e) {
        firstError ??= { from, expr, message: e instanceof MathError ? e.message : "Expresión no válida" };
      }
    }
    if (!found && firstError && /[\d)%]\s*$|[+\-−*×·/÷(]\s*$/.test(firstError.expr)) {
      found = { from: firstError.from, eq, expression: firstError.expr, result: null, exact: false, error: firstError.message, manual: null };
    }
    if (!found) continue;

    // ¿Hay ya un resultado escrito a mano tras el `=`?
    // Solo si ese número no empieza otra expresión («2+2= 3+3=» son dos cálculos).
    const after = /^[  ]*(-?\d+(?:[.,]\d+)?)(?![\d.,]*[  ]*[+\-−*×·/÷%(=])/.exec(text.slice(eq + 1));
    if (after) {
      const mFrom = eq + 1 + after[0].length - after[1].length;
      const mTo = eq + 1 + after[0].length;
      let mismatch = false;
      if (found.result !== null) {
        try {
          const written = evaluate(after[1].replace(/^-/, "0-"));
          mismatch = sub(written, evaluate(found.expression)).n !== 0n && !approxEqual(after[1], found);
        } catch {
          mismatch = true;
        }
      }
      found.manual = { from: mFrom, to: mTo, text: after[1], mismatch };
    }
    out.push(found);
  }
  return out;
}

/** Un resultado escrito con menos decimales que el exacto (1/3=0.33) no es un error. */
function approxEqual(written: string, calc: Calculation): boolean {
  const decimals = (written.split(/[.,]/)[1] ?? "").length;
  const value = evaluate(calc.expression);
  const rounded = formatRatio(value, { decimals, separator: "." }).text;
  return rounded === written.replace(",", ".");
}
