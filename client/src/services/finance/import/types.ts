import type { ColumnMapping, ImportField, MappingSource } from "./columns";
import type { Cell, DateOrder, DecimalSep } from "./normalize";

export type SourceFormat = "csv" | "xlsx" | "json" | "sqlite";

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
}

/** Tablas crudas de una copia de seguridad de Cashew (SQLite). */
export interface CashewSource {
  type: "cashew";
  wallets: Record<string, Cell>[];
  categories: Record<string, Cell>[];
  transactions: Record<string, Cell>[];
  objectives: Record<string, Cell>[];
  notes?: string[];
}

export type ImportSource = TableSource | CashewSource;

export interface ImportOptions {
  /** Orden de las fechas ambiguas; `auto` lo deduce de la columna. */
  dateOrder: "auto" | DateOrder;
  decimal: "auto" | DecimalSep;
  /** Cuenta para filas sin cuenta (o cuya cuenta no existe y no se crea). */
  defaultAccountId: string | null;
  createAccounts: boolean;
  createCategories: boolean;
}

export const DEFAULT_OPTIONS: ImportOptions = {
  dateOrder: "auto",
  decimal: "auto",
  defaultAccountId: null,
  createAccounts: true,
  createCategories: true,
};

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

export interface ImportIssue {
  /** 0 = el fichero entero. */
  row: number;
  field: ImportField | "file" | "row";
  severity: IssueSeverity;
  original: string;
  message: string;
  suggestion: string;
}

export type RowStatus = "valid" | "fixed" | "warning" | "error" | "duplicate" | "excluded" | "merged";
export type DuplicateKind = "id" | "deleted" | "fingerprint";

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
