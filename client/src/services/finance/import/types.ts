import type { ColumnMapping, ImportField, MappingSource } from "./columns";
import type { Cell, DateOrder, DecimalSep } from "./normalize";

export type SourceFormat = "csv" | "tsv" | "xlsx" | "xls" | "json" | "sqlite" | "sql";

/** Tabla genérica (CSV, hoja de Excel, lista JSON o tabla SQLite). */
export interface TableSource {
  type: "table";
  format: SourceFormat;
  /** Nombre de la hoja/tabla, para mostrarlo. */
  name?: string;
  headers: string[];
  rows: Cell[][];
  /** Número de fila (1-based, como en Excel) del primer elemento de `rows`. */
  firstRow: number;
  /** Arreglos hechos al leer el fichero (p. ej. CSV reenvuelto por Excel). */
  notes?: string[];
  /** Columnas que son identificadores de otra tabla (no deben usarse como nombres). */
  idColumns?: string[];
}

/** Tablas crudas de una copia de seguridad de Cashew (SQLite). */
export interface CashewSource {
  type: "cashew";
  wallets: Record<string, Cell>[];
  categories: Record<string, Cell>[];
  transactions: Record<string, Cell>[];
  objectives: Record<string, Cell>[];
  notes?: string[];
  /** Origen: copia SQLite o volcado SQL de texto. */
  origin?: "sqlite" | "sql";
}

export type ImportSource = TableSource | CashewSource;

/** Campos que pueden formar la huella de «posible duplicado». */
export const DUPLICATE_FIELDS = ["date", "account", "kind", "amount", "concept", "category"] as const;
export type DuplicateField = (typeof DUPLICATE_FIELDS)[number];

/** Decisión para una cuenta o categoría del archivo que no existe en la app. */
export type EntityChoice = "create" | "none" | "exclude" | `id:${string}`;

export interface ImportOptions {
  /** Orden de las fechas ambiguas; `auto` lo deduce de la columna. */
  dateOrder: "auto" | DateOrder;
  decimal: "auto" | DecimalSep;
  /**
   * Política de zona horaria para instantes (ISO con zona, timestamps Unix):
   * `local` = el día del reloj de este dispositivo; `utc` = el día en UTC.
   * Las fechas sin zona («2026-09-26 23:34») se toman literalmente.
   */
  zone: "local" | "utc";
  /** Autoriza redondear a céntimos importes con más de 2 decimales. */
  allowRounding: boolean;
  /** Cuenta para filas sin cuenta (o cuya cuenta no existe y no se crea). */
  defaultAccountId: string | null;
  /** Moneda para las cuentas nuevas cuando el archivo no la indica. */
  defaultCurrency: string | null;
  createAccounts: boolean;
  createCategories: boolean;
  /** Nombre en el archivo (normalizado) -> decisión. Prevalece sobre `create*`. */
  accountMap: Record<string, EntityChoice>;
  categoryMap: Record<string, EntityChoice>;
  duplicateFields: DuplicateField[];
  /** Confirmaciones dadas por el usuario (ver `Confirmation`). */
  confirmed: ConfirmationKey[];
}

export const DEFAULT_OPTIONS: ImportOptions = {
  dateOrder: "auto",
  decimal: "auto",
  zone: "local",
  allowRounding: false,
  defaultAccountId: null,
  defaultCurrency: null,
  createAccounts: true,
  createCategories: true,
  accountMap: {},
  categoryMap: {},
  duplicateFields: ["date", "account", "kind", "amount"],
  confirmed: [],
};

export type ConfirmationKey = "dateOrder" | "decimal" | "currency" | "mapping";

/** Decisión que el sistema no toma solo: sin ella no se puede importar. */
export interface Confirmation {
  key: ConfirmationKey;
  message: string;
  /** Lo que se hará si el usuario confirma sin cambiar nada. */
  proposal: string;
}

/** Campos que el usuario puede corregir a mano en la vista previa. */
export const EDITABLE_FIELDS = ["date", "amount", "kind", "account", "toAccount", "toAmount", "currency", "category", "concept", "description"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export interface SmartImportInput {
  source: ImportSource;
  /** Solo tablas. Sin ella se detecta automáticamente. */
  mapping?: ColumnMapping;
  options?: Partial<ImportOptions>;
  /** Correcciones manuales: fila -> campo -> texto nuevo. */
  edits?: Record<string, Partial<Record<EditableField, string>>>;
  /** Decisiones explícitas del usuario por fila. */
  decisions?: Record<string, "include" | "exclude">;
}

/**
 * - `error`: crítico, la fila no se puede importar tal cual.
 * - `warning`: se puede importar, pero conviene revisarla.
 * - `fixed`: se corrigió sola (se informa para que no sea una sorpresa).
 */
export type IssueSeverity = "error" | "warning" | "fixed";

/**
 * - `auto`: corregida automáticamente.
 * - `pending`: requiere acción; la fila no se importa así.
 * - `accepted`: advertencia revisable; la fila se importa igualmente.
 * - `manual`: el usuario corrigió el valor a mano.
 * - `excluded`: la fila queda fuera de la importación.
 */
export type IssueResolution = "auto" | "pending" | "accepted" | "manual" | "excluded";

export interface ImportIssue {
  /** 0 = el fichero entero. */
  row: number;
  field: ImportField | "file" | "row";
  severity: IssueSeverity;
  original: string;
  message: string;
  suggestion: string;
  resolution?: IssueResolution;
}

export type RowStatus = "valid" | "fixed" | "warning" | "error" | "duplicate" | "excluded" | "merged";
/**
 * - `id`: mismo identificador que un movimiento existente (ya importado).
 * - `exact`: mismo contenido (fecha, cuenta, tipo, importe y concepto) con otro id.
 * - `fingerprint`: posible duplicado según los campos configurados.
 * - `deleted`: se importó antes y el usuario lo borró.
 */
export type DuplicateKind = "id" | "exact" | "deleted" | "fingerprint";

export interface PreviewRow {
  row: number;
  status: RowStatus;
  included: boolean;
  /** Si el usuario puede cambiar `included` (un error o un id repetido, no). */
  canInclude: boolean;
  duplicate: DuplicateKind | null;
  date: string | null;
  kind: string | null;
  amount: number | null;
  currency: string | null;
  account: string | null;
  toAccount: string | null;
  category: string | null;
  concept: string;
  issues: ImportIssue[];
  /** Valores actuales en texto, para precargar el editor. */
  raw: Partial<Record<EditableField, string>>;
  /** Valores originales de la fila en el archivo (para el informe de filas no importadas). */
  original: Record<string, string>;
}

export interface ImportTotals {
  total: number;
  valid: number;
  fixed: number;
  warnings: number;
  errors: number;
  duplicates: number;
  excluded: number;
  merged: number;
  toImport: number;
}

export interface SmartPreview {
  format: SourceFormat | "cashew";
  totals: ImportTotals;
  rows: PreviewRow[];
  fileIssues: ImportIssue[];
  headers: string[];
  mapping: ColumnMapping;
  mappingSource: MappingSource[];
  preset: string | null;
  detected: { dateOrder: DateOrder; decimal: DecimalSep | null; dateAmbiguous: boolean };
  newAccounts: { name: string; currency: string }[];
  newCategories: { name: string; kind: string }[];
  /** Decisiones pendientes: mientras haya alguna, no se puede importar. */
  confirmations: Confirmation[];
  /** Cuentas y categorías del archivo que no existen en la app. */
  unresolved: {
    accounts: { key: string; name: string; rows: number; currency: string | null; choice: EntityChoice }[];
    categories: { key: string; name: string; kind: string; rows: number; choice: EntityChoice }[];
  };
}

export interface SmartImportResult extends SmartPreview {
  imported: number;
}

/* ------------------------------------------------ interno (motor/adaptadores) */

export interface AccountHint {
  name: string;
  /** Id determinista para la cuenta que se cree (dos dispositivos, misma cuenta). */
  id?: string;
  currency?: string;
  archived?: boolean;
  type?: "cash" | "bank" | "savings" | "credit_card" | "wallet" | "investment" | "other";
}

/** Fila del origen ya separada por campos, antes de normalizar. */
export interface RawRecord {
  row: number;
  values: Partial<Record<ImportField, Cell>>;
  /** La fila no se importa salvo que el usuario la incluya (p. ej. pendiente de pago). */
  defaultExcluded?: string;
  /** Otra pata de una transferencia ya representada por la fila indicada. */
  mergedInto?: number;
  /** El tipo lo fijó el adaptador (no hay que deducirlo). */
  kindLocked?: boolean;
  issues: ImportIssue[];
  /** Valores originales tal como venían (para el informe de filas no importadas). */
  original: Record<string, string>;
  /** Pista para una fecha ausente (nunca se usa sola: solo se sugiere). */
  dateSuggestion?: string;
}

export interface Extracted {
  records: RawRecord[];
  accountHints: Map<string, AccountHint>;
  categoryColors: Map<string, string>;
  fileIssues: ImportIssue[];
  headers: string[];
  mapping: ColumnMapping;
  mappingSource: MappingSource[];
  preset: string | null;
}
