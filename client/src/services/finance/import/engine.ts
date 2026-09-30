/**
 * Importación inteligente de movimientos (CSV, TSV, Excel, JSON, SQL, SQLite, Cashew).
 *
 * A diferencia de la importación JSON propia (`io.ts`), que es todo o nada
 * porque restaura un estado completo, aquí cada fila se valida por separado:
 * una fila rota no impide importar las demás. Se mantienen las mismas
 * garantías de integridad:
 *
 *   - `plan` no escribe nada; `apply` vuelve a planificar DENTRO de `mutate`
 *     (atómico) sobre el estado actual, así que lo que se aplica es
 *     exactamente lo que resultaría de la vista previa en ese momento.
 *   - Toda fila final pasa por el mismo esquema zod que la sincronización.
 *   - Ids deterministas: reimportar el mismo fichero no duplica nada, y las
 *     filas que ya existen (mismo id) no se pueden forzar.
 *   - Cuentas y categorías nuevas también tienen id determinista: importar el
 *     mismo fichero en dos dispositivos no crea dos cuentas al sincronizar.
 *   - Lo que el sistema no puede decidir con seguridad (fechas ambiguas,
 *     separador decimal dudoso, moneda desconocida, columnas deducidas por su
 *     contenido) se pide al usuario: sin su confirmación no se importa.
 */

import {
  ApiError,
  newId,
  nowIso,
  tagOwnerActive,
  type Db,
  type FinAccountRow,
  type FinAllocation,
  type FinCategoryRow,
  type FinTransactionRow,
  type FinTxKind,
} from "@/services/localDb";
import { stripDangerousKeys } from "@/services/routeKit";
import { toInputValue } from "@/lib/money";
import { FINANCE_ROW_SCHEMAS } from "../schemas";
import { addDays, diffDays, todayKey } from "../dates";
import { stableHash } from "../io";
import { cashewRecords } from "./cashew";
import { detectHeaderRow, detectMapping, FIELD_LABEL, headerSignature, IMPORT_FIELDS, type ColumnMapping, type ImportField } from "./columns";
import {
  cleanText,
  decimalAmbiguous,
  detectDateOrder,
  detectDecimal,
  isBalanceCorrection,
  isBlank,
  normKey,
  parseBool,
  parseCurrency,
  parseFlexibleAmount,
  parseFlexibleDate,
  parseKind,
  type Cell,
  type DateOrder,
  type DecimalSep,
  type ZonePolicy,
} from "./normalize";
import {
  DEFAULT_OPTIONS,
  EDITABLE_FIELDS,
  type AccountHint,
  type Confirmation,
  type DuplicateKind,
  type EditableField,
  type EntityChoice,
  type Extracted,
  type ImportIssue,
  type ImportOptions,
  type IssueSeverity,
  type PreviewRow,
  type RawRecord,
  type SmartImportInput,
  type SmartImportResult,
  type SmartPreview,
  type TableSource,
} from "./types";

export const MAX_IMPORT_ROWS = 50_000;

const KIND_ES: Record<FinTxKind, string> = { income: "ingreso", expense: "gasto", transfer: "transferencia", adjustment: "corrección" };

/* ------------------------------------------------------------- extracción */

function extractTable(db: Db, src: TableSource, wanted?: ColumnMapping): Extracted {
  const headers = src.headers.map((h, i) => cleanText(h) || `Columna ${i + 1}`);
  const detected = detectMapping(headers, src.rows, db.finAccounts.map((a) => a.name), src.idColumns ?? []);
  const valid = wanted && wanted.length === headers.length && wanted.every((f) => f === null || (IMPORT_FIELDS as readonly string[]).includes(f));
  const mapping = valid ? wanted! : detected.mapping;
  // Con una asignación explícita (del usuario o de su perfil), lo que coincide
  // con la detección conserva su origen y lo demás es elección suya.
  const mappingSource = valid ? mapping.map((f, i) => (f && f === detected.mapping[i] && detected.source[i] !== "content" ? detected.source[i] : f ? "profile" : null)) : detected.source;

  const sig = headerSignature(headers);
  const records: RawRecord[] = [];
  src.rows.forEach((cells, i) => {
    if (!cells || cells.every(isBlank)) return; // líneas vacías: no son filas
    const values: RawRecord["values"] = {};
    mapping.forEach((f, c) => {
      if (f && isBlank(values[f]) && !isBlank(cells[c])) values[f] = cells[c];
    });
    const original = Object.fromEntries(headers.map((h, c) => [h, cells[c] === null || cells[c] === undefined ? "" : String(cells[c])]));
    const rec: RawRecord = { row: src.firstRow + i, values, issues: [], original };
    // Los ids de otro programa («1», «2»…) se aíslan por formato de fichero
    // para que no choquen con los de otro origen.
    const id = cleanText(values.id);
    if (id && !(id.length >= 16 || /^(csv|cashew|imp|ext|rec)-/.test(id))) values.id = `ext-${stableHash(`${sig}#${id}`)}`;
    if (!parseFlexibleDate(values.date).date && cells.some((c) => typeof c === "string" && /^\s*(sub)?tota(l|les)\b|^\s*saldo\b|^\s*balance\b/i.test(c))) {
      rec.defaultExcluded = "Parece una fila de totales o saldos, no un movimiento";
    }
    records.push(rec);
  });

  const fileIssues: ImportIssue[] = (src.notes ?? []).map((n) => issue(0, "file", "fixed", "", n, ""));
  for (const w of detected.warnings) fileIssues.push(issue(0, "file", "warning", "", w, "Revisa la asignación en el apartado Columnas"));
  const has = (f: ImportField) => mapping.includes(f);
  if (!has("date")) fileIssues.push(issue(0, "date", "error", "", "No se encontró la columna de fecha", "Asigna la columna «Fecha» en el apartado Columnas"));
  if (!has("amount") && !has("debit") && !has("credit")) {
    fileIssues.push(issue(0, "amount", "error", "", "No se encontró la columna de importe", "Asigna «Importe» (o «Débito» y «Crédito») en el apartado Columnas"));
  }
  return {
    records,
    accountHints: new Map(),
    categoryColors: new Map(),
    fileIssues,
    headers,
    mapping,
    mappingSource,
    preset: detected.preset && mapping.every((f, i) => f === detected.mapping[i]) ? detected.preset.name : null,
  };
}

/** Convierte una matriz (hoja, CSV) en tabla detectando la fila de cabecera. */
export function gridToTable(grid: Cell[][], format: TableSource["format"], name?: string, notes: string[] = []): TableSource {
  const h = detectHeaderRow(grid);
  const width = Math.max(0, ...grid.slice(0, 200).map((r) => r.length));
  if (h < 0) {
    return { type: "table", format, name, headers: Array.from({ length: width }, (_, i) => `Columna ${i + 1}`), rows: grid, firstRow: 1, notes: [...notes, "El fichero no tiene cabecera: las columnas se reconocieron por su contenido"] };
  }
  const skipped = h > 0 ? [`Se omitieron ${h} línea(s) de título antes de la cabecera`] : [];
  const headers = Array.from({ length: Math.max(width, grid[h].length) }, (_, i) => cleanText(grid[h][i]) || `Columna ${i + 1}`);
  return { type: "table", format, name, headers, rows: grid.slice(h + 1), firstRow: h + 2, notes: [...notes, ...skipped] };
}

/* ---------------------------------------------------------- normalización */

function issue(row: number, field: ImportIssue["field"], severity: IssueSeverity, original: unknown, message: string, suggestion: string): ImportIssue {
  return { row, field, severity, original: original === null || original === undefined ? "" : String(original).slice(0, 200), message, suggestion };
}

interface Draft {
  rec: RawRecord;
  issues: ImportIssue[];
  date: string | null;
  ts?: number;
  kind: FinTxKind | null;
  kindFromCorrection: boolean;
  amount: number | null;
  currency: string | null;
  invalidCurrency: string | null;
  accountName: string;
  toAccountName: string;
  toAmount: number | null;
  categoryName: string;
  concept: string;
  description: string | null;
  tags: string[];
  reason: string | null;
  purposes: string;
  id: string;
  mergedInto?: number;
  /** Hay que redondear a céntimos y el usuario aún no lo ha autorizado. */
  roundingPending: boolean;
  /** La fila queda fuera por decisión sobre su cuenta o categoría. */
  entityExcluded?: string;
}

interface Ctx {
  order: DateOrder;
  decimal: DecimalSep | null;
  zone: ZonePolicy;
  allowRounding: boolean;
  today: string;
}

function normalize(rec: RawRecord, edits: Partial<Record<EditableField, string>> | undefined, ctx: Ctx): Draft {
  const v: RawRecord["values"] = { ...rec.values };
  const row = rec.row;
  const out: ImportIssue[] = [...rec.issues];
  const add = (field: ImportIssue["field"], sev: IssueSeverity, original: unknown, message: string, suggestion = "") => out.push(issue(row, field, sev, original, message, suggestion));
  // Una corrección manual sustituye al valor original de ese campo (y queda anotada).
  for (const f of EDITABLE_FIELDS) {
    if (!edits || typeof edits[f] !== "string") continue;
    const target: ImportField = f === "category" && !isBlank(v.subcategory) ? "subcategory" : f;
    const before = v[target];
    v[target] = edits[f]!;
    if (cleanText(before) !== cleanText(edits[f])) {
      out.push({ ...issue(row, f, "fixed", before, `Corregido a mano: «${cleanText(edits[f]) || "(vacío)"}»`, ""), resolution: "manual" });
    }
  }

  // Fecha: nunca se inventa. Si falta, es un error corregible desde la vista previa.
  const d = parseFlexibleDate(v.date, ctx.order, ctx.zone);
  let date = d.date;
  if (!date) {
    add("date", "error", v.date, isBlank(v.date) ? "Falta la fecha" : `${d.error ?? "Fecha no válida"}: «${cleanText(v.date)}»`, rec.dateSuggestion ?? "Escribe la fecha como AAAA-MM-DD o DD/MM/AAAA");
  } else {
    const year = Number(date.slice(0, 4));
    if (year < 1900 || year > 2100) {
      add("date", "error", v.date, `Año fuera de rango (${year})`, "Revisa la fecha: se admiten años entre 1900 y 2100");
      date = null;
    } else if (date > addDays(ctx.today, 1)) add("date", "warning", v.date, `Fecha futura (${date})`, "Compruébala: los movimientos futuros afectan a los saldos desde ya");
    if (d.fixed) add("date", "fixed", v.date, d.fixed);
  }

  // Importe: con signo, o por columnas de débito/crédito.
  let amount: number | null = null;
  let currency: string | null = null;
  let sideKind: FinTxKind | null = null;
  let roundingPending = false;
  const parseAmt = (field: ImportField, value: Cell | undefined) => {
    const r = parseFlexibleAmount(value, ctx.decimal);
    if (r.cents === null && !isBlank(value)) add(field, "error", value, `Importe no válido: «${cleanText(value)}» (${r.error})`, "Escribe el importe como 1234,56 o 1234.56");
    if (r.currency) currency = r.currency;
    if (r.cents === 0 && (r.rounded || (typeof value === "number" && value !== 0))) {
      add(field, "error", value, `El importe ${cleanText(value)} se queda en 0 al redondear a 2 decimales`, "La app guarda importes con 2 decimales (p. ej. criptomonedas en otra unidad): excluye la fila o regístrala a mano");
      return null;
    }
    if (r.rounded && !ctx.allowRounding) {
      roundingPending = true;
      add(field, "warning", value, `${r.fixed}: la app guarda 2 decimales y el redondeo necesita tu autorización`, "Activa «Permitir redondeo» en Opciones o marca la fila para importarla redondeada");
    } else if (r.lossy) add(field, "warning", value, `${r.fixed}: el redondeo cambia el importe más de un 1 %`, "Comprueba el importe; la app guarda 2 decimales");
    else if (r.fixed) add(field, "fixed", value, r.fixed);
    return r.cents;
  };
  if (!isBlank(v.amount)) amount = parseAmt("amount", v.amount);
  else if (!isBlank(v.debit) || !isBlank(v.credit)) {
    const debit = isBlank(v.debit) ? 0 : parseAmt("debit", v.debit);
    const credit = isBlank(v.credit) ? 0 : parseAmt("credit", v.credit);
    if (debit !== null && credit !== null) {
      if (debit && credit) add("amount", "warning", `${v.debit} / ${v.credit}`, "La fila tiene débito y crédito a la vez: se usa la diferencia", "Revisa que no sean dos movimientos");
      amount = Math.abs(credit) - Math.abs(debit);
      sideKind = amount < 0 ? "expense" : "income";
    }
  } else add("amount", "error", "", "Falta el importe", "Asigna la columna de importe o escribe el valor");

  // Moneda explícita del movimiento (nunca se convierte).
  let invalidCurrency: string | null = null;
  if (!isBlank(v.currency)) {
    const c = parseCurrency(v.currency);
    if ("invalid" in c) invalidCurrency = c.invalid.toUpperCase();
    else if (c.code) currency = c.code;
  }

  // Tipo: columna explícita > categoría de corrección > marca ingreso > débito/crédito > signo.
  // El signo solo decide cuando el archivo no dice nada más.
  let kind: FinTxKind | null = null;
  let kindFromCorrection = false;
  let explicit = false;
  const category = cleanText(v.subcategory) || cleanText(v.category);
  if (!isBlank(v.kind)) {
    kind = parseKind(v.kind);
    explicit = !!kind;
    if (!kind && amount !== null) {
      add("kind", "warning", v.kind, `Tipo «${cleanText(v.kind)}» no reconocido: se dedujo por el signo del importe`, "Usa ingreso, gasto, transferencia o corrección");
    }
  }
  if (!kind && isBalanceCorrection(v.category)) {
    kind = "adjustment";
    kindFromCorrection = true;
  }
  const incomeFlag = isBlank(v.incomeFlag) ? null : parseBool(v.incomeFlag);
  if (!isBlank(v.incomeFlag) && incomeFlag === null) add("incomeFlag", "warning", v.incomeFlag, `No se entiende «${cleanText(v.incomeFlag)}» como sí/no`, "Usa true/false o sí/no");
  if (!kind && incomeFlag !== null) kind = incomeFlag ? "income" : "expense";
  if (!kind && sideKind) kind = sideKind;
  if (!kind && amount !== null && amount !== 0) kind = amount < 0 ? "expense" : "income";

  if (amount !== null && kind) {
    if (kind === "adjustment") {
      // El signo de una corrección lo da el importe; si viene sin signo, la marca de ingreso.
      if (incomeFlag === false && amount > 0) {
        amount = -amount;
        add("amount", "fixed", v.amount, "Corrección marcada como salida: se tomó el importe en negativo");
      }
    } else {
      if (amount < 0 && kind === "income" && explicit && !rec.kindLocked) {
        add("amount", "warning", v.amount, "Ingreso con importe negativo: se tomó el valor absoluto", "Si es un gasto, cambia el tipo");
      }
      amount = Math.abs(amount);
    }
  }
  if (amount === 0 && !out.some((i) => i.severity === "error" && (i.field === "amount" || i.field === "debit" || i.field === "credit"))) {
    add("amount", "error", v.amount ?? "0", "Importe 0", "Corrige el importe o excluye la fila");
  }
  if (!kind && !out.some((i) => i.severity === "error")) {
    add("kind", "error", v.kind, "No se pudo deducir el tipo de movimiento", "Indica ingreso, gasto, transferencia o corrección");
  }

  // Textos
  let concept = cleanText(v.concept).replace(/\s*\n\s*/g, " ");
  const description = cleanText(v.description);
  if (!concept) {
    const fallback = category || description.split("\n")[0] || (kind === "adjustment" ? "Corrección de saldo" : kind === "transfer" ? "Transferencia" : "Movimiento importado");
    concept = fallback.slice(0, 120);
    add("concept", "fixed", "", `Concepto vacío: se usó «${concept}»`);
  } else if (concept.length > 120) {
    add("concept", "fixed", concept, "Concepto recortado a 120 caracteres");
    concept = concept.slice(0, 120);
  }
  if (description.length > 2000) add("description", "fixed", "", "Descripción recortada a 2000 caracteres");
  const toAmountRaw = isBlank(v.toAmount) ? null : parseFlexibleAmount(v.toAmount, ctx.decimal);
  if (toAmountRaw && toAmountRaw.cents === null) add("toAmount", "warning", v.toAmount, "Importe de destino no válido: se ignora");

  return {
    rec,
    issues: out,
    date,
    ts: d.ts,
    kind,
    kindFromCorrection,
    amount,
    currency,
    invalidCurrency,
    accountName: cleanText(v.account).replace(/\s+/g, " "),
    toAccountName: cleanText(v.toAccount).replace(/\s+/g, " "),
    toAmount: toAmountRaw?.cents !== null && toAmountRaw?.cents !== undefined ? Math.abs(toAmountRaw.cents) : null,
    categoryName: kindFromCorrection ? "" : category.replace(/\s+/g, " "),
    concept,
    description: description ? description.slice(0, 2000) : null,
    tags: cleanText(v.tags).split(/[|,;]/).map((s) => s.trim().replace(/^#/, "")).filter(Boolean),
    reason: cleanText(v.reason) || null,
    purposes: cleanText(v.purposes),
    id: cleanText(v.id),
    mergedInto: rec.mergedInto,
    roundingPending,
  };
}

/**
 * Cashew exporta cada transferencia como dos «Corrección de Balance» con signo
 * opuesto en cuentas distintas, creadas con 1-2 s de diferencia. En el CSV no
 * hay enlace entre ellas, así que se reconstruyen por esa forma.
 */
function pairCorrections(drafts: Draft[]): void {
  const cands = drafts
    .filter((d) => d.kindFromCorrection && d.ts !== undefined && d.amount !== null && d.accountName && !d.mergedInto && !d.issues.some((i) => i.severity === "error"))
    .sort((a, b) => a.ts! - b.ts!);
  const used = new Set<Draft>();
  const WINDOW = 3000;
  cands.forEach((out, i) => {
    if (out.amount! >= 0 || used.has(out)) return;
    let mate: Draft | undefined;
    // Ventana temporal sobre la lista ordenada: se mira a ambos lados hasta ±3 s.
    for (const step of [-1, 1]) {
      for (let j = i + step; j >= 0 && j < cands.length && Math.abs(cands[j].ts! - out.ts!) <= WINDOW && !mate; j += step) {
        const p = cands[j];
        if (
          !used.has(p) &&
          p.amount! > 0 &&
          normKey(p.accountName) !== normKey(out.accountName) &&
          (p.amount === -out.amount! || (!!p.currency && !!out.currency && p.currency !== out.currency))
        ) {
          mate = p;
        }
      }
    }
    if (!mate) return;
    used.add(out).add(mate);
    out.kind = "transfer";
    out.kindFromCorrection = false;
    out.toAccountName = mate.accountName;
    out.toAmount = mate.amount;
    out.amount = Math.abs(out.amount!);
    out.issues.push(issue(out.rec.row, "kind", "fixed", "Corrección de Balance", `Transferencia reconstruida junto con la fila ${mate.rec.row} (el origen guarda las dos patas como correcciones)`, ""));
    mate.mergedInto = out.rec.row;
    mate.kind = "transfer";
  });
}

/* ----------------------------------------------------------------- plan */

interface Plan {
  preview: SmartPreview;
  transactions: FinTransactionRow[];
  accounts: FinAccountRow[];
  categories: FinCategoryRow[];
}

const ACCOUNT_STYLE: Record<string, { color: string; icon: string }> = {
  wallet: { color: "#9333ea", icon: "Wallet" },
  other: { color: "#64748b", icon: "Circle" },
};

/** Días de margen para señalar movimientos «parecidos» (mismo importe y cuenta). */
const SIMILAR_DAYS = 3;

export function planSmartImport(db: Db, rawInput: SmartImportInput): Plan {
  const input = stripDangerousKeys(rawInput);
  const given = input.options ?? {};
  const options: ImportOptions = {
    ...DEFAULT_OPTIONS,
    ...given,
    accountMap: { ...(given.accountMap ?? {}) },
    categoryMap: { ...(given.categoryMap ?? {}) },
    duplicateFields: given.duplicateFields?.length ? given.duplicateFields : DEFAULT_OPTIONS.duplicateFields,
    confirmed: given.confirmed ?? [],
  };
  const confirmed = new Set(options.confirmed);
  const ex: Extracted = input.source.type === "cashew" ? cashewRecords(input.source) : extractTable(db, input.source, input.mapping);
  const format = input.source.type === "cashew" ? "cashew" : input.source.format;
  const fileIssues = [...ex.fileIssues];
  const confirmations: Confirmation[] = [];

  if (ex.records.length > MAX_IMPORT_ROWS) {
    throw new ApiError(413, `El fichero tiene ${ex.records.length} filas; el máximo por importación es ${MAX_IMPORT_ROWS}`);
  }

  // Columnas deducidas solo por su contenido: el usuario debe revisarlas.
  const guessed = ex.mappingSource.map((s, i) => (s === "content" ? i : -1)).filter((i) => i >= 0);
  if (!input.mapping && guessed.length && !confirmed.has("mapping")) {
    confirmations.push({
      key: "mapping",
      message: `Estas columnas se asignaron por su contenido y no por su nombre: ${guessed.map((i) => `«${ex.headers[i]}» → ${FIELD_LABEL[ex.mapping[i]!]}`).join(", ")}`,
      proposal: "Revísalas en el apartado Columnas y confirma la asignación",
    });
  }

  // Convenciones de la columna entera (solo valores de texto: los números no son ambiguos).
  const dates = ex.records.map((r) => r.values.date);
  const detectedOrder = detectDateOrder(dates);
  const amountsText = ex.records.flatMap((r) => [r.values.amount, r.values.debit, r.values.credit, r.values.toAmount]);
  const detectedDecimal = detectDecimal(amountsText);
  if (options.dateOrder === "auto" && detectedOrder.ambiguous && !confirmed.has("dateOrder")) {
    const sample = dates.find((x) => typeof x === "string" && /^\d{1,2}[/.\-\s]\d{1,2}[/.\-\s]\d{2,4}/.test(x.trim()));
    confirmations.push({
      key: "dateOrder",
      message: `Las fechas son ambiguas (p. ej. «${cleanText(sample)}»): pueden ser DD/MM/AAAA o MM/DD/AAAA`,
      proposal: "Elige el formato; si confirmas sin cambiarlo se leerán como DD/MM/AAAA",
    });
  }
  if (options.decimal === "auto" && decimalAmbiguous(amountsText) && !confirmed.has("decimal")) {
    const sample = amountsText.find((x) => typeof x === "string" && /\d[.,]\d{3}\b/.test(x));
    confirmations.push({
      key: "decimal",
      message: `Los importes admiten dos lecturas (p. ej. «${cleanText(sample)}» puede ser mil o uno con decimales)`,
      proposal: "Elige el separador decimal; si confirmas sin cambiarlo, «1.234» se leerá como mil doscientos treinta y cuatro",
    });
  }
  const ctx: Ctx = {
    order: options.dateOrder === "auto" ? detectedOrder.order : options.dateOrder,
    decimal: options.decimal === "auto" ? detectedDecimal : options.decimal,
    zone: options.zone,
    allowRounding: options.allowRounding,
    today: todayKey(),
  };

  const edits = input.edits ?? {};
  const drafts = ex.records.map((r) => normalize(r, edits[String(r.row)], ctx));
  if (input.source.type === "table") pairCorrections(drafts);

  const signOnly = drafts.filter((d) => d.kind === "income" && !d.rec.kindLocked && isBlank(d.rec.values.kind) && isBlank(d.rec.values.incomeFlag) && isBlank(d.rec.values.debit) && isBlank(d.rec.values.credit));
  if (drafts.length >= 5 && signOnly.length === drafts.length) {
    fileIssues.push(issue(0, "kind", "warning", "", "No hay columna de tipo y todos los importes son positivos: todo se importaría como ingreso", "Asigna la columna de tipo, o de débito/crédito, si hay gastos"));
  }

  /* ------------------------------------------------ cuentas */
  const ts = nowIso();
  const accountsByKey = new Map<string, FinAccountRow>();
  // Las activas tienen prioridad sobre las archivadas del mismo nombre.
  for (const a of [...db.finAccounts].sort((x, y) => Number(y.archived) - Number(x.archived))) accountsByKey.set(normKey(a.name), a);
  const accountsById = new Map(db.finAccounts.map((a) => [a.id, a]));
  const plannedAccounts = new Map<string, FinAccountRow>();
  /** Cuentas del archivo que no existen: nombre, filas y moneda deducida. */
  const unknownAccounts = new Map<string, { name: string; rows: number; currency: string | null; choice: EntityChoice }>();
  /** Moneda de cuentas nuevas tomada por defecto (no del archivo): requiere confirmación. */
  const assumedCurrency = new Set<string>();
  const defaultAccount = options.defaultAccountId ? accountsById.get(options.defaultAccountId) ?? null : null;
  const fallbackCurrency = options.defaultCurrency && /^[A-Z]{3}$/.test(options.defaultCurrency) ? options.defaultCurrency : db.settings.currency;
  if (options.defaultAccountId && !defaultAccount) fileIssues.push(issue(0, "account", "warning", options.defaultAccountId, "La cuenta por defecto ya no existe", "Elige otra en Opciones"));
  if (!ex.mapping.includes("account") && input.source.type === "table" && !defaultAccount) {
    fileIssues.push(issue(0, "account", "error", "", "No hay columna de cuenta ni cuenta por defecto", "Asigna la columna «Cuenta» o elige una cuenta por defecto en Opciones"));
  }

  const resolveAccount = (d: Draft, field: "account" | "toAccount"): FinAccountRow | null => {
    const name = field === "account" ? d.accountName : d.toAccountName;
    const row = d.rec.row;
    if (!name) {
      if (field === "toAccount") {
        d.issues.push(issue(row, "toAccount", "error", "", "Transferencia sin cuenta de destino", "Asigna la cuenta destino o cambia el tipo"));
        return null;
      }
      if (defaultAccount) {
        if (ex.mapping.includes("account")) d.issues.push(issue(row, "account", "fixed", "", `Sin cuenta: se usó la cuenta por defecto «${defaultAccount.name}»`, ""));
        return defaultAccount;
      }
      d.issues.push(issue(row, "account", "error", "", "Falta la cuenta", "Escribe la cuenta o elige una cuenta por defecto en Opciones"));
      return null;
    }
    const key = normKey(name);
    const hint: AccountHint | undefined = ex.accountHints.get(key);
    const known = (hint?.id && accountsById.get(hint.id)) || accountsByKey.get(key);
    if (known) return known;

    // Cuenta que no existe: decide el usuario (o, por defecto, las opciones generales).
    const choice: EntityChoice = options.accountMap[key] ?? (options.createAccounts ? "create" : defaultAccount && field === "account" ? `id:${defaultAccount.id}` : "exclude");
    const fileCurrency = hint?.currency || (field === "account" ? d.currency ?? d.invalidCurrency : null) || null;
    const entry = unknownAccounts.get(key) ?? { name, rows: 0, currency: fileCurrency, choice };
    entry.rows++;
    unknownAccounts.set(key, entry);

    if (choice.startsWith("id:")) {
      const target = accountsById.get(choice.slice(3));
      if (target) {
        d.issues.push({ ...issue(row, field, "fixed", name, `La cuenta «${name}» no existe: se asignó a «${target.name}»`, ""), resolution: options.accountMap[key] ? "manual" : "auto" });
        return target;
      }
    }
    if (choice === "exclude" || choice === "none") {
      d.entityExcluded = `La cuenta «${name}» no existe en la app y elegiste no importarla`;
      d.issues.push(issue(row, field, "warning", name, `Cuenta «${name}» no encontrada: la fila no se importa`, "Asígnala a una cuenta existente o elige «Crear» en «Cuentas del archivo»"));
      return null;
    }
    const planned = plannedAccounts.get(key);
    if (planned) return planned;
    const cur = fileCurrency || fallbackCurrency;
    if (!/^[A-Z]{3}$/.test(cur)) {
      d.issues.push(
        issue(row, field, "error", name, `No se puede crear la cuenta «${name}»: su moneda «${cur}» no es un código ISO de 3 letras`, `Asígnala a una cuenta existente en «Cuentas del archivo», créala a mano (p. ej. en USD) o excluye la fila`)
      );
      return null;
    }
    if (!fileCurrency) assumedCurrency.add(name);
    const type = hint?.type ?? "other";
    const acc: FinAccountRow = {
      id: hint?.id ?? `imp-acc-${stableHash(key)}`,
      name: name.slice(0, 60),
      type,
      currency: cur,
      initialBalance: 0,
      description: `Creada al importar (${format})`,
      color: (ACCOUNT_STYLE[type] ?? ACCOUNT_STYLE.other).color,
      icon: (ACCOUNT_STYLE[type] ?? ACCOUNT_STYLE.other).icon,
      archived: hint?.archived ?? false,
      includeInTotal: true,
      createdAt: ts,
      updatedAt: ts,
    };
    plannedAccounts.set(key, acc);
    return acc;
  };

  /* ------------------------------------------------ categorías */
  const catsByKey = new Map<string, FinCategoryRow[]>();
  for (const c of [...db.finCategories].sort((x, y) => Number(x.archived) - Number(y.archived))) {
    const k = normKey(c.name);
    catsByKey.set(k, [...(catsByKey.get(k) ?? []), c]);
  }
  const catsById = new Map(db.finCategories.map((c) => [c.id, c]));
  const plannedCats = new Map<string, FinCategoryRow>();
  const unknownCats = new Map<string, { name: string; kind: string; rows: number; choice: EntityChoice }>();
  const fits = (c: FinCategoryRow, kind: FinTxKind) => c.kind === "both" || c.kind === kind;

  const resolveCategory = (d: Draft): string | null => {
    const name = d.categoryName;
    if (!name || (d.kind !== "income" && d.kind !== "expense")) return null;
    const kind = d.kind;
    const key = normKey(name);
    const found = catsByKey.get(key) ?? [];
    const ok = found.find((c) => fits(c, kind));
    if (ok) return ok.id;
    const label = kind === "income" ? "ingreso" : "gasto";

    const choice: EntityChoice = options.categoryMap[key] ?? (options.createCategories ? "create" : "none");
    const entry = unknownCats.get(key) ?? { name, kind, rows: 0, choice };
    if (entry.kind !== kind) entry.kind = "both";
    entry.rows++;
    unknownCats.set(key, entry);
    const manual = options.categoryMap[key] ? "manual" : "accepted";

    if (choice.startsWith("id:")) {
      const target = catsById.get(choice.slice(3));
      if (target && fits(target, kind)) {
        d.issues.push({ ...issue(d.rec.row, "category", "fixed", name, `Categoría «${name}» asignada a «${target.name}»`, ""), resolution: "manual" });
        return target.id;
      }
      d.issues.push(issue(d.rec.row, "category", "warning", name, `La categoría elegida para «${name}» no admite ${label}s: queda sin categoría`, "Elige una categoría de ese tipo o «Ambos»"));
      return null;
    }
    if (choice === "exclude") {
      d.entityExcluded = `Elegiste no importar las filas de la categoría «${name}»`;
      return null;
    }
    if (choice === "none") {
      d.issues.push({
        ...issue(
          d.rec.row,
          "category",
          "warning",
          name,
          found.length ? `La categoría «${name}» no es de ${label}: el movimiento queda sin categoría` : `La categoría «${name}» no existe: el movimiento queda sin categoría`,
          "Asígnala o créala en «Categorías del archivo»"
        ),
        resolution: manual,
      });
      return null;
    }
    // Crear. Con el nombre ocupado por una categoría del otro tipo se crea una variante.
    const finalName = found.length ? `${name.slice(0, 48)} (${label})` : name.slice(0, 60);
    const finalKey = normKey(finalName);
    const variant = (catsByKey.get(finalKey) ?? []).find((c) => fits(c, kind));
    if (variant) return variant.id;
    let planned = plannedCats.get(finalKey);
    if (planned) {
      if (!fits(planned, kind)) planned.kind = "both"; // el mismo nombre se usa para ingresos y gastos
      return planned.id;
    }
    const id = `imp-cat-${stableHash(finalKey)}`;
    const prior = catsById.get(id); // creada en una importación anterior y renombrada después
    if (prior && fits(prior, kind)) return prior.id;
    planned = {
      id: prior ? newId() : id,
      name: finalName,
      kind,
      color: ex.categoryColors.get(key) ?? "#64748b",
      icon: "Tag",
      archived: false,
      createdAt: ts,
      updatedAt: ts,
    };
    plannedCats.set(finalKey, planned);
    return planned.id;
  };

  /* ------------------------------------------------ etiquetas y finalidades */
  const tagByName = new Map(db.tags.map((t) => [normKey(t.name), t]));
  const purposeByName = new Map((db.finTags ?? []).filter((t) => tagOwnerActive(db, t)).map((t) => [normKey(t.name), t]));

  /* ------------------------------------------------ duplicados */
  // Tres niveles: exacto (mismo id, o mismo contenido incluido el concepto),
  // posible (coinciden los campos configurados) y parecido (mismo importe y
  // cuenta a pocos días: solo aviso). Nunca se descarta nada con incertidumbre
  // sin que el usuario pueda decidir.
  const existingIds = new Map(db.finTransactions.map((t) => [t.id, t]));
  const deletedIds = new Set(db.tombstones.filter((t) => t.collection === "finTransactions").map((t) => t.id));
  const catName = (id: string | null) => (id ? normKey(catsById.get(id)?.name ?? plannedCatName(id)) : "");
  const plannedCatName = (id: string) => [...plannedCats.values()].find((c) => c.id === id)?.name ?? "";
  const exactKey = (t: FinTransactionRow) => `${t.date}|${t.accountId}|${t.kind}|${t.amount}|${normKey(t.concept)}`;
  const fpKey = (t: FinTransactionRow) =>
    options.duplicateFields
      .map((f) => (f === "account" ? t.accountId : f === "concept" ? normKey(t.concept) : f === "category" ? catName(t.categoryId) : String(t[f])))
      .join("|");
  const counter = (key: (t: FinTransactionRow) => string) => {
    const m = new Map<string, number>();
    for (const t of db.finTransactions) m.set(key(t), (m.get(key(t)) ?? 0) + 1);
    return m;
  };
  const exactLeft = counter(exactKey);
  const fpLeft = counter(fpKey);
  const similarIndex = new Map<string, string[]>();
  for (const t of db.finTransactions) {
    const k = `${t.accountId}|${t.kind}|${t.amount}`;
    similarIndex.set(k, [...(similarIndex.get(k) ?? []), t.date]);
  }
  const take = (m: Map<string, number>, k: string) => {
    const n = m.get(k) ?? 0;
    if (n > 0) m.set(k, n - 1);
    return n > 0;
  };
  const occurrences = new Map<string, number>();
  const seenIds = new Set<string>();

  const rows: PreviewRow[] = [];
  const txById = new Map<string, FinTransactionRow>();
  const accountOfRow = new Map<number, string[]>();
  const categoryOfRow = new Map<number, string | null>();

  for (const d of drafts) {
    const row = d.rec.row;
    const decision = input.decisions?.[String(row)];
    let account: FinAccountRow | null = null;
    let toAccount: FinAccountRow | null = null;
    let tx: FinTransactionRow | null = null;
    let duplicate: DuplicateKind | null = null;

    if (!d.mergedInto) {
      if (d.kind === "transfer" && !d.toAccountName && !d.issues.some((i) => i.severity === "error")) {
        d.issues.push(issue(row, "toAccount", "error", "", "Transferencia sin cuenta de destino", "Asigna la cuenta destino o cambia el tipo"));
      }
      account = resolveAccount(d, "account");
      if (d.kind === "transfer" && d.toAccountName) toAccount = resolveAccount(d, "toAccount");
      if (account && d.currency && account.currency !== d.currency) {
        d.issues.push(issue(row, "currency", "error", d.currency, `El movimiento está en ${d.currency} y la cuenta «${account.name}» en ${account.currency}`, `Asigna una cuenta en ${d.currency} o corrige la moneda (no se convierten importes)`));
      } else if (account && d.invalidCurrency && !plannedAccounts.has(normKey(account.name))) {
        d.issues.push(issue(row, "currency", "warning", d.invalidCurrency, `Moneda «${d.invalidCurrency}» desconocida: se usa la de la cuenta (${account.currency})`, ""));
      }
      let toAmount: number | null = null;
      if (d.kind === "transfer" && account && toAccount) {
        if (toAccount.id === account.id) {
          d.issues.push(issue(row, "toAccount", "error", d.toAccountName, "Origen y destino son la misma cuenta", "Corrige la cuenta destino o cambia el tipo"));
        } else if (toAccount.currency !== account.currency) {
          if (!d.toAmount) d.issues.push(issue(row, "toAmount", "error", "", `Transferencia de ${account.currency} a ${toAccount.currency} sin importe recibido`, "Indica cuánto llegó a la cuenta destino"));
          else toAmount = d.toAmount;
        }
      }
      const categoryId = resolveCategory(d);

      const tagIds: string[] = [];
      for (const name of d.tags) {
        const t = tagByName.get(normKey(name));
        if (t) tagIds.push(t.id);
        else d.issues.push(issue(row, "tags", "warning", name, `La etiqueta «${name}» no existe: se ignora`, "Créala en Etiquetas y vuelve a previsualizar"));
      }

      const allocations: FinAllocation[] = [];
      if (d.purposes && d.kind && d.amount !== null) {
        for (const part of d.purposes.split("|").map((x) => x.trim()).filter(Boolean)) {
          const [rawName, rawAmount] = part.split("=");
          const tag = purposeByName.get(normKey(rawName.replace(/^#/, "")));
          const cents = rawAmount === undefined ? null : parseFlexibleAmount(rawAmount, ctx.decimal).cents;
          if (!tag || !cents || cents <= 0) {
            d.issues.push(issue(row, "purposes", "warning", part, tag ? `Importe de finalidad no válido: «${part}»` : `Finalidad desconocida o inactiva: «${rawName.trim()}»`, "Se importa sin esa finalidad"));
            continue;
          }
          allocations.push({ id: "", tagId: tag.id, amount: cents, flow: d.kind === "expense" || (d.kind === "adjustment" && d.amount < 0) ? "use" : "assign" });
        }
        const cap = d.kind === "transfer" ? toAmount ?? d.amount : Math.abs(d.amount);
        if (allocations.reduce((s, a) => s + a.amount, 0) > cap) {
          d.issues.push(issue(row, "purposes", "warning", d.purposes, "Las finalidades suman más que el importe: se ignoran", "Corrige los importes de las finalidades"));
          allocations.length = 0;
        }
      }

      if (!d.issues.some((i) => i.severity === "error") && account && d.kind && d.amount !== null && d.date) {
        // Id: explícito, del adaptador o determinista (misma fórmula que el CSV clásico).
        const p = `${d.date}|${account.id}|${d.kind}|${d.amount}|${d.concept.toLowerCase()}`;
        const n = (occurrences.get(p) ?? 0) + 1;
        occurrences.set(p, n);
        const id = /^[\w:.-]{1,128}$/.test(d.id) ? d.id : `csv-${stableHash(`${p}#${n}`)}`;
        allocations.forEach((a, k) => (a.id = `${id}-a${k}`.slice(0, 128)));
        const candidate: FinTransactionRow = {
          id,
          kind: d.kind,
          amount: d.amount,
          accountId: account.id,
          toAccountId: d.kind === "transfer" ? toAccount?.id ?? null : null,
          toAmount,
          categoryId,
          date: d.date,
          concept: d.concept,
          description: d.description,
          tagIds: [...new Set(tagIds)],
          goalId: null,
          allocations,
          recurringId: null,
          reason: d.kind === "adjustment" ? (d.reason ?? `Importado (${format})`).slice(0, 300) : null,
          createdAt: ts,
          updatedAt: ts,
        };
        // Red de seguridad: las mismas reglas que la API y la sincronización.
        const checked = FINANCE_ROW_SCHEMAS.finTransactions.safeParse(candidate);
        if (!checked.success) {
          const first = checked.error.issues[0];
          d.issues.push(issue(row, "row", "error", "", `Fila inválida (${first.path.join(".") || "fila"}): ${first.message}`, "Corrige los datos de la fila"));
        } else {
          tx = candidate;
          if (seenIds.has(id)) {
            duplicate = "id";
            d.issues.push(issue(row, "id", "warning", id, "Identificador repetido dentro del archivo", "Solo se importa la primera fila con este identificador"));
          } else if (existingIds.has(id)) {
            duplicate = "id";
            const prev = existingIds.get(id)!;
            take(exactLeft, exactKey(prev));
            take(fpLeft, fpKey(prev));
            d.issues.push(issue(row, "id", "warning", id, "Ya importado antes (mismo identificador)", "No se vuelve a importar"));
          } else if (deletedIds.has(id)) {
            duplicate = "deleted";
            d.issues.push(issue(row, "id", "warning", id, "Lo importaste antes y después lo borraste", "Márcalo para importarlo de nuevo si fue un error"));
          } else if (take(exactLeft, exactKey(tx))) {
            duplicate = "exact";
            take(fpLeft, fpKey(tx));
            d.issues.push(issue(row, "row", "warning", "", "Duplicado exacto: ya existe un movimiento con la misma fecha, cuenta, tipo, importe y concepto", "Márcalo solo si de verdad son dos movimientos"));
          } else if (take(fpLeft, fpKey(tx))) {
            duplicate = "fingerprint";
            const fields = options.duplicateFields.map((f) => ({ date: "fecha", account: "cuenta", kind: "tipo", amount: "importe", concept: "concepto", category: "categoría" })[f]).join(", ");
            d.issues.push(issue(row, "row", "warning", "", `Posible duplicado: ya hay un movimiento con la misma ${fields}`, "Márcalo para importarlo si es un movimiento distinto"));
          } else {
            const near = (similarIndex.get(`${tx.accountId}|${tx.kind}|${tx.amount}`) ?? []).find((x) => x !== tx!.date && Math.abs(diffDays(x, tx!.date)) <= SIMILAR_DAYS);
            if (near) {
              d.issues.push(issue(row, "row", "warning", "", `Parecido a un movimiento del ${near} (mismo importe y cuenta): probablemente es distinto`, "Se importa; revísalo si dudas"));
            }
          }
          seenIds.add(id);
        }
      }
    }

    const hasError = d.issues.some((i) => i.severity === "error");
    const hasWarning = d.issues.some((i) => i.severity === "warning" && !(duplicate && (i.field === "id" || i.field === "row")));
    const hasFixed = d.issues.some((i) => i.severity === "fixed");
    const canInclude = !d.mergedInto && !hasError && !!tx && duplicate !== "id" && !d.entityExcluded;
    const defaultIn = canInclude && !duplicate && !d.rec.defaultExcluded && !d.roundingPending;
    const included = canInclude && (decision === "exclude" ? false : decision === "include" ? true : defaultIn);
    if (d.rec.defaultExcluded && !d.mergedInto) d.issues.push(issue(row, "row", "warning", "", d.rec.defaultExcluded, "Se omite salvo que la marques para importar"));
    if (d.entityExcluded && !d.issues.some((i) => i.message === d.entityExcluded)) d.issues.push(issue(row, "row", "warning", "", d.entityExcluded, "Cámbialo en «Cuentas y categorías del archivo»"));

    const status: PreviewRow["status"] = d.mergedInto
      ? "merged"
      : (d.rec.defaultExcluded || d.entityExcluded) && (hasError || !canInclude)
        ? "excluded" // fila de totales o excluida por decisión: no es un error que corregir
        : hasError
          ? "error"
          : duplicate && !included
            ? "duplicate"
            : !included
              ? "excluded"
              : hasWarning
                ? "warning"
                : hasFixed
                  ? "fixed"
                  : "valid";
    if (d.mergedInto) d.issues.push(issue(row, "row", "fixed", "", `Otra pata de la transferencia de la fila ${d.mergedInto}`, ""));

    // Estado de resolución de cada incidencia, según lo que le pasa a la fila.
    for (const i of d.issues) {
      if (i.resolution === "manual") continue;
      i.resolution =
        i.severity === "fixed" ? "auto" : status === "excluded" || status === "merged" ? "excluded" : i.severity === "error" ? "pending" : included ? "accepted" : canInclude ? "pending" : "excluded";
    }

    if (tx && included) {
      txById.set(tx.id, tx);
      accountOfRow.set(row, [tx.accountId, tx.toAccountId].filter((x): x is string => !!x));
      categoryOfRow.set(row, tx.categoryId);
    }
    const amountText = d.amount !== null ? toInputValue(d.amount) : cleanText(d.rec.values.amount ?? d.rec.values.debit ?? d.rec.values.credit);
    rows.push({
      row,
      status,
      included,
      canInclude,
      duplicate,
      date: d.date,
      kind: d.kind,
      amount: d.amount,
      currency: account?.currency ?? d.currency,
      account: account?.name ?? (d.accountName || null),
      toAccount: toAccount?.name ?? (d.toAccountName || null),
      category: d.categoryName || null,
      concept: d.concept,
      issues: d.issues,
      raw: {
        date: d.date ?? cleanText(edits[String(row)]?.date ?? d.rec.values.date),
        amount: amountText,
        kind: d.kind ? KIND_ES[d.kind] : cleanText(d.rec.values.kind),
        account: d.accountName,
        toAccount: d.toAccountName,
        toAmount: d.toAmount !== null ? toInputValue(d.toAmount) : "",
        currency: d.currency ?? d.invalidCurrency ?? "",
        category: d.categoryName,
        concept: d.concept,
        description: d.description ?? "",
      },
      original: d.rec.original,
    });
  }

  // Solo se crean las cuentas y categorías que usa alguna fila que se importa.
  const usedAccounts = new Set([...accountOfRow.values()].flat());
  const usedCats = new Set([...categoryOfRow.values()].filter(Boolean));
  const accounts = [...plannedAccounts.values()].filter((a) => usedAccounts.has(a.id));
  const categories = [...plannedCats.values()].filter((c) => usedCats.has(c.id));

  // Moneda obligatoria no indicada en el archivo: no se asume sin avisar.
  const assumed = accounts.filter((a) => assumedCurrency.has(a.name));
  if (assumed.length && !options.defaultCurrency && !confirmed.has("currency")) {
    confirmations.push({
      key: "currency",
      message: `El archivo no indica la moneda de ${assumed.length === 1 ? "la cuenta nueva" : "las cuentas nuevas"} ${assumed.map((a) => `«${a.name}»`).join(", ")}`,
      proposal: `Elige la moneda; si confirmas sin cambiarla se crearán en ${fallbackCurrency}`,
    });
  }

  const count = (s: PreviewRow["status"]) => rows.filter((r) => r.status === s).length;
  const preview: SmartPreview = {
    format,
    totals: {
      total: rows.length,
      valid: count("valid"),
      fixed: count("fixed"),
      warnings: count("warning"),
      errors: count("error"),
      duplicates: count("duplicate"),
      excluded: count("excluded"),
      merged: count("merged"),
      toImport: rows.filter((r) => r.included).length,
    },
    rows,
    fileIssues,
    headers: ex.headers,
    mapping: ex.mapping,
    mappingSource: ex.mappingSource,
    preset: ex.preset,
    detected: { dateOrder: ctx.order, decimal: ctx.decimal, dateAmbiguous: detectedOrder.ambiguous },
    newAccounts: accounts.map((a) => ({ name: a.name, currency: a.currency })),
    newCategories: categories.map((c) => ({ name: c.name, kind: c.kind })),
    confirmations,
    unresolved: {
      accounts: [...unknownAccounts.entries()].map(([key, a]) => ({ key, ...a })),
      categories: [...unknownCats.entries()].map(([key, c]) => ({ key, ...c })),
    },
  };
  return { preview, transactions: [...txById.values()], accounts, categories };
}

/**
 * Aplica la importación. Debe llamarse dentro de `mutate`: si algo lanza, la
 * base queda intacta (se trabaja sobre una copia y se guarda de una vez). Las
 * filas con error nunca se importan; el resto, según las decisiones del usuario.
 */
export function applySmartImport(db: Db, input: SmartImportInput): SmartImportResult {
  const plan = planSmartImport(db, input);
  if (plan.preview.confirmations.length) {
    throw new ApiError(400, `Falta tu confirmación: ${plan.preview.confirmations.map((c) => c.message).join(" · ")}`);
  }
  if (plan.transactions.length === 0) throw new ApiError(400, "No hay movimientos válidos marcados para importar");
  const activeNames = new Set(db.finAccounts.filter((a) => !a.archived).map((a) => normKey(a.name)));
  for (const a of plan.accounts) {
    // Doble comprobación de unicidad (la API impide dos cuentas activas con el mismo nombre).
    if (!a.archived && activeNames.has(normKey(a.name))) throw new ApiError(409, `Ya existe una cuenta activa llamada «${a.name}»`);
    if (db.finAccounts.some((x) => x.id === a.id)) throw new ApiError(409, `Conflicto de identificador de cuenta (${a.id})`);
    db.finAccounts.push(a);
  }
  for (const c of plan.categories) {
    if (db.finCategories.some((x) => x.id === c.id)) throw new ApiError(409, `Conflicto de identificador de categoría (${c.id})`);
    db.finCategories.push(c);
  }
  const ids = new Set(db.finTransactions.map((t) => t.id));
  for (const t of plan.transactions) {
    if (ids.has(t.id)) throw new ApiError(409, `El movimiento ${t.id} ya existe`);
    db.finTransactions.push(t);
  }
  return { ...plan.preview, imported: plan.transactions.length };
}
