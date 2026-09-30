/**
 * Reconocimiento de columnas de tablas importadas.
 *
 * Tres fuentes de pistas, de más a menos fiable:
 *   1. Un perfil (guardado por el usuario o predefinido, p. ej. Cashew).
 *   2. El nombre de la cabecera, comparado con sinónimos en varios idiomas.
 *   3. El contenido: una columna llena de fechas es la fecha aunque se llame
 *      «Col3», y «Ingreso» con true/false no es un importe sino el signo.
 * Lo que no se reconoce queda sin asignar para que el usuario decida.
 */

import { detectDecimal, isBlank, normKey, parseBool, parseFlexibleAmount, parseFlexibleDate, parseKind, type Cell } from "./normalize";

export const IMPORT_FIELDS = [
  "date",
  "amount",
  "kind",
  "incomeFlag",
  "debit",
  "credit",
  "account",
  "toAccount",
  "toAmount",
  "currency",
  "category",
  "subcategory",
  "concept",
  "description",
  "tags",
  "reason",
  "purposes",
  "id",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];
/** Campo destino por índice de columna del origen (null = se ignora). */
export type ColumnMapping = (ImportField | null)[];
export type MappingSource = "profile" | "preset" | "header" | "content" | null;

export const FIELD_LABEL: Record<ImportField, string> = {
  date: "Fecha",
  amount: "Importe (con signo)",
  kind: "Tipo de movimiento",
  incomeFlag: "¿Es ingreso? (sí/no)",
  debit: "Importe de salida (débito)",
  credit: "Importe de entrada (crédito)",
  account: "Cuenta",
  toAccount: "Cuenta destino",
  toAmount: "Importe recibido (destino)",
  currency: "Moneda",
  category: "Categoría",
  subcategory: "Subcategoría",
  concept: "Concepto",
  description: "Descripción / nota",
  tags: "Etiquetas",
  reason: "Motivo (correcciones)",
  purposes: "Finalidades",
  id: "Identificador único",
};

/** Clave de cabecera: sin tildes, sin signos, espacios simples. */
export function headerKey(h: unknown): string {
  return normKey(h).replace(/[^a-z0-9]+/g, " ").trim();
}

type Synonym = ImportField | "flexIncome" | "flexExpense" | "ignore";

const SYNONYMS: Record<string, Synonym> = {};
const syn = (field: Synonym, words: string) => words.split("|").forEach((w) => (SYNONYMS[headerKey(w)] = field));
syn("date", "fecha|date|fecha operacion|fecha de operacion|fecha valor|fecha transaccion|fecha de transaccion|fecha movimiento|fecha contable|transaction date|posted date|posting date|booking date|value date|datum|data|fecha creacion|fecha de creacion|date created|created|created at|timestamp|time|datetime|dia|day|fecha y hora|date time");
syn("amount", "importe|monto|valor|amount|cantidad|total|suma|sum|value|montant|betrag|quantia|valor total|importe total|monto total|amount cop|amount usd|amount eur|importe eur|net amount|transaction amount|valor transaccion|saldo movimiento");
syn("kind", "tipo|type|kind|tipo movimiento|tipo de movimiento|tipo transaccion|tipo de transaccion|transaction type|movement type|naturaleza|clase|operacion|tipo operacion");
syn("flexIncome", "ingreso|ingresos|income|is income|es ingreso|entrada|entradas");
syn("flexExpense", "gasto|gastos|egreso|egresos|expense|expenses|salida|salidas");
syn("debit", "debito|debitos|debit|debits|cargo|cargos|retiro|retiros|withdrawal|withdrawals|money out|paid out|valor debito|monto debito");
syn("credit", "credito|creditos|credit|credits|abono|abonos|deposito|depositos|deposit|deposits|money in|paid in|valor credito|monto credito");
syn("account", "cuenta|account|billetera|wallet|cartera|banco|bank|cuenta origen|from account|source account|account name|wallet name|medio de pago|payment method|metodo de pago|forma de pago|monedero|conta");
syn("toAccount", "cuenta destino|destino|to account|destination|destination account|target account|transfer to|cuenta de destino|hacia");
syn("toAmount", "importe destino|to amount|amount received|monto destino|importe recibido|valor destino");
syn("currency", "moneda|divisa|currency|curr|ccy|currency code|codigo moneda|moneda original|concurrencia|moeda");
syn("category", "categoria|category|rubro|category name|nombre categoria|grupo|clasificacion|categoria principal|main category");
syn("subcategory", "subcategoria|subcategory|subcategory name|sub category|sub categoria");
syn("concept", "concepto|concept|titulo|title|nombre|name|payee|beneficiario|comercio|merchant|detalle|glosa|descripcion corta|establecimiento|contraparte|counterparty|destinatario");
syn("description", "descripcion|description|nota|notas|note|notes|memo|comentario|comentarios|observaciones|observacion|details|detalles|referencia|reference|informacion adicional");
syn("tags", "etiquetas|tags|labels|etiqueta|tag|label");
syn("reason", "motivo|reason");
syn("purposes", "finalidades|purposes");
syn("id", "id|transaction id|id transaccion|id movimiento|uuid|transaction pk|external id|id externo|numero de operacion|referencia unica");
syn("ignore", "color|colour|icono|icon|emoji|saldo|balance|running balance|saldo disponible|saldo final|importe sin pagar|unpaid amount");

/* ------------------------------------------------------------ predefinidos */

export interface Preset {
  id: string;
  name: string;
  /** Cabeceras normalizadas que identifican el formato. */
  headers: string[];
  columns: Record<string, ImportField | null>;
}

/**
 * Exportación CSV de Cashew. En español la app traduce las cabeceras de forma
 * engañosa: «concepto» contiene la BILLETERA, «titulo» el concepto,
 * «concurrencia» la moneda y «cuenta» el presupuesto. Sin este perfil, una
 * detección por nombre asignaría las columnas al revés.
 */
export const PRESETS: Preset[] = [
  {
    id: "cashew-csv-es",
    name: "Cashew (CSV en español)",
    headers: ["concepto", "importe", "importe sin pagar", "concurrencia", "titulo", "nota", "fecha", "ingreso", "tipo", "categoria", "subcategoria", "color", "icono", "emoji", "cuenta", "objectivo", "extra"],
    columns: {
      concepto: "account",
      importe: "amount",
      concurrencia: "currency",
      titulo: "concept",
      nota: "description",
      fecha: "date",
      ingreso: "incomeFlag",
      categoria: "category",
      subcategoria: "subcategory",
    },
  },
  {
    id: "cashew-csv-en",
    name: "Cashew (CSV en inglés)",
    headers: ["account", "amount", "currency", "title", "note", "date", "income", "type", "category name", "subcategory name", "color", "icon", "emoji", "budget", "objective"],
    columns: {
      account: "account",
      amount: "amount",
      currency: "currency",
      title: "concept",
      note: "description",
      date: "date",
      income: "incomeFlag",
      "category name": "category",
      "subcategory name": "subcategory",
    },
  },
];

/** Proporción de cabeceras del perfil presentes en el fichero (0-1). */
export function headerOverlap(expected: string[], headers: string[]): number {
  if (!expected.length) return 0;
  const have = new Set(headers.map(headerKey));
  return expected.filter((h) => have.has(h)).length / expected.length;
}

export function mappingFromColumns(headers: string[], columns: Record<string, ImportField | null>): ColumnMapping {
  const used = new Set<ImportField>();
  return headers.map((h) => {
    const f = columns[headerKey(h)] ?? null;
    if (!f || used.has(f)) return null;
    used.add(f);
    return f;
  });
}

export function findPreset(headers: string[]): Preset | null {
  let best: Preset | null = null;
  let score = 0;
  for (const p of PRESETS) {
    const s = headerOverlap(p.headers, headers);
    if (s > score) [best, score] = [p, s];
  }
  return score >= 0.8 ? best : null;
}

/* ------------------------------------------------------- análisis de datos */

interface ColumnStats {
  filled: number;
  date: number;
  amount: number;
  bool: number;
  kind: number;
  accountMatch: number;
  distinct: number;
  avgLen: number;
}

function stats(values: Cell[], accountKeys: Set<string>): ColumnStats {
  const sample = values.filter((v) => !isBlank(v)).slice(0, 300);
  const decimal = detectDecimal(sample);
  const s: ColumnStats = { filled: sample.length, date: 0, amount: 0, bool: 0, kind: 0, accountMatch: 0, distinct: new Set(sample.map(String)).size, avgLen: 0 };
  for (const v of sample) {
    const text = String(v);
    s.avgLen += text.length;
    // Un número suelto (p. ej. 20000) no cuenta como fecha: solo formatos con forma de fecha.
    if ((typeof v === "string" && /[-/.\s]|[a-z]/i.test(text.trim()) && parseFlexibleDate(v).date) || (typeof v === "number" && v > 1e8)) s.date++;
    if (parseFlexibleAmount(v, decimal).cents !== null && !/^\d{4}-\d{2}-\d{2}/.test(text)) s.amount++;
    if (parseBool(v) !== null && !/^\d+$/.test(text.trim()) || typeof v === "boolean") s.bool++;
    if (parseKind(v)) s.kind++;
    if (accountKeys.has(normKey(v))) s.accountMatch++;
  }
  if (s.filled) s.avgLen /= s.filled;
  return s;
}

const ratio = (n: number, s: ColumnStats) => (s.filled ? n / s.filled : 0);

/**
 * Fila de cabecera: los extractos bancarios suelen traer líneas de título
 * («Extracto de cuenta», «Periodo: …») antes de la tabla. Devuelve -1 si la
 * primera fila ya son datos (fichero sin cabecera).
 */
export function detectHeaderRow(grid: Cell[][]): number {
  const limit = Math.min(grid.length, 30);
  const width = (r: Cell[]) => r.filter((c) => !isBlank(c)).length;
  const widths = grid.slice(0, 60).map(width).filter((w) => w > 1);
  const modal = widths.sort((a, b) => widths.filter((x) => x === b).length - widths.filter((x) => x === a).length)[0] ?? 0;
  for (let i = 0; i < limit; i++) {
    const row = grid[i] ?? [];
    const known = row.filter((c) => typeof c === "string" && SYNONYMS[headerKey(c)] !== undefined).length;
    if (known >= 2) return i;
  }
  for (let i = 0; i < limit; i++) {
    const row = grid[i] ?? [];
    const filled = row.filter((c) => !isBlank(c));
    if (filled.length < Math.max(2, Math.ceil(modal * 0.6))) continue;
    const textual = filled.filter((c) => typeof c === "string" && !parseFlexibleDate(c).date && parseFlexibleAmount(c).cents === null);
    // Primera fila «ancha» y toda de texto: cabecera. Si trae fechas o importes, ya son datos.
    return textual.length === filled.length ? i : -1;
  }
  return 0;
}

export interface DetectedMapping {
  mapping: ColumnMapping;
  source: MappingSource[];
  preset: Preset | null;
}

/**
 * Asignación automática. `accountNames`: cuentas existentes, para reconocer
 * una columna de cuenta por su contenido aunque la cabecera diga otra cosa.
 */
export function detectMapping(headers: string[], rows: Cell[][], accountNames: string[] = []): DetectedMapping {
  const preset = findPreset(headers);
  if (preset) {
    const mapping = mappingFromColumns(headers, preset.columns);
    return { mapping, source: mapping.map((f) => (f ? "preset" : null)), preset };
  }

  const accountKeys = new Set(accountNames.map(normKey));
  const col = (i: number) => rows.map((r) => r[i] ?? null);
  const st = headers.map((_, i) => stats(col(i), accountKeys));
  const mapping: ColumnMapping = headers.map(() => null);
  const source: MappingSource[] = headers.map(() => null);
  const taken = new Set<ImportField>();
  const set = (i: number, f: ImportField, how: MappingSource) => {
    if (taken.has(f) || mapping[i]) return false;
    mapping[i] = f;
    source[i] = how;
    taken.add(f);
    return true;
  };

  // 1) Por cabecera, corrigiendo con el contenido cuando contradice al nombre.
  headers.forEach((h, i) => {
    const s = SYNONYMS[headerKey(h)];
    if (!s || s === "ignore") return;
    const numeric = ratio(st[i].amount, st[i]) >= 0.8;
    const boolean = ratio(st[i].bool, st[i]) >= 0.8;
    if (s === "flexIncome") set(i, boolean ? "incomeFlag" : numeric ? "credit" : "kind", "header");
    else if (s === "flexExpense") set(i, numeric ? "debit" : "kind", "header");
    else if (s === "kind" && boolean) set(i, "incomeFlag", "header");
    else if (s === "kind" && numeric && !ratio(st[i].kind, st[i])) return;
    else set(i, s, "header");
  });

  // Débito y crédito juntos sustituyen al importe con signo, no se suman a él.
  if (taken.has("debit") !== taken.has("credit")) {
    const lone = mapping.findIndex((f) => f === "debit" || f === "credit");
    if (!taken.has("amount")) {
      // Una sola columna: es el importe (el signo lo pondrá el tipo o el propio valor).
      taken.delete(mapping[lone]!);
      mapping[lone] = null;
      set(lone, "amount", "header");
    }
  }

  // 2) Una columna cuyo contenido son nombres de cuentas existentes es la cuenta.
  if (!taken.has("account") && accountKeys.size) {
    const i = st.findIndex((s, i) => ratio(s.accountMatch, s) >= 0.6 && mapping[i] !== "date" && mapping[i] !== "amount");
    if (i >= 0) {
      if (mapping[i]) taken.delete(mapping[i]!);
      mapping[i] = null;
      set(i, "account", "content");
    }
  }

  // 3) Por contenido, para lo imprescindible que siga sin asignar.
  const free = (i: number) => !mapping[i] && SYNONYMS[headerKey(headers[i])] !== "ignore";
  const best = (score: (s: ColumnStats) => number, min: number) => {
    let bi = -1;
    let bs = min;
    st.forEach((s, i) => {
      if (!free(i) || !s.filled) return;
      const v = score(s);
      if (v > bs) [bi, bs] = [i, v];
    });
    return bi;
  };
  if (!taken.has("date")) {
    const i = best((s) => ratio(s.date, s), 0.8);
    if (i >= 0) set(i, "date", "content");
  }
  if (!taken.has("amount") && !taken.has("debit") && !taken.has("credit")) {
    const i = best((s) => ratio(s.amount, s) - ratio(s.date, s), 0.8);
    if (i >= 0) set(i, "amount", "content");
  }
  if (!taken.has("kind") && !taken.has("incomeFlag")) {
    const i = best((s) => ratio(s.kind, s), 0.8);
    if (i >= 0) set(i, "kind", "content");
  }
  if (!taken.has("concept")) {
    if (taken.has("description")) {
      // Solo hay «descripción»: hace de concepto.
      const i = mapping.indexOf("description");
      mapping[i] = null;
      taken.delete("description");
      set(i, "concept", source[i] ?? "header");
    } else {
      // El texto más variado y largo suele ser el concepto.
      const i = best((s) => (s.distinct / Math.max(1, s.filled)) * Math.min(1, s.avgLen / 8) - ratio(s.amount, s) - ratio(s.date, s), 0.3);
      if (i >= 0) set(i, "concept", "content");
    }
  }
  return { mapping, source, preset: null };
}

/** Firma de un conjunto de cabeceras, para reconocer ficheros del mismo origen. */
export function headerSignature(headers: string[]): string {
  return headers.map(headerKey).filter(Boolean).sort().join("|");
}
