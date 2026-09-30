/**
 * Lectura de ficheros de importación: detecta el formato por su CONTENIDO
 * (no por la extensión, que suele mentir: Cashew guarda su SQLite como
 * `.sql`) y lo convierte en una fuente que entiende el motor.
 *
 * Cada formato es un lector independiente (`ImportReader`) que devuelve la
 * misma estructura intermedia (tablas o fuente Cashew). Admitir un formato
 * nuevo = registrar un lector; normalización y validación no cambian.
 */

import { EXPORT_FORMAT, parseCsv } from "../io";
import { cashewRecords, looksLikeCashew } from "./cashew";
import { gridToTable } from "./engine";
import { isBlank, type Cell } from "./normalize";
import { isSqlite, readSqlite, type SqliteTable } from "./sqlite";
import { looksLikeSqlDump, readSqlDump } from "./sqldump";
import type { CashewSource, TableSource } from "./types";
import { isCfb, readXls } from "./xls";
import { isZip, readXlsx } from "./xlsx";

export type DetectedFile =
  /** Copia JSON de esta misma app: va por la importación completa de siempre. */
  | { kind: "native"; payload: unknown; label: string }
  | { kind: "cashew"; source: CashewSource; label: string; summary: string }
  | { kind: "tables"; tables: TableSource[]; label: string };

export class ImportFileError extends Error {}

/* ------------------------------------------------------------------ texto */

export function decodeText(bytes: Uint8Array): { text: string; note?: string } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder().decode(bytes.subarray(3)) };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)) };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)) };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    // Excel en Windows guarda los CSV en ANSI: «Categoría» llegaría como «Categor�a».
    return { text: new TextDecoder("windows-1252").decode(bytes), note: "El archivo no estaba en UTF-8: se leyó como Windows-1252 (ANSI)" };
  }
}

const DELIMITERS = [",", ";", "\t", "|"];

function modeWidth(rows: string[][]): { width: number; share: number } {
  const freq = new Map<number, number>();
  for (const r of rows) freq.set(r.length, (freq.get(r.length) ?? 0) + 1);
  let width = 0;
  let n = 0;
  for (const [w, c] of freq) if (c > n || (c === n && w > width)) [width, n] = [w, c];
  return { width, share: rows.length ? n / rows.length : 0 };
}

/**
 * CSV/TSV con separador autodetectado. Repara además el caso frecuente de un
 * CSV abierto y guardado de nuevo con Excel en configuración regional
 * española: cada línea original acaba metida en UNA celda de un CSV con `;`
 * (`"a,b,""nota""";`), y se deshace el envoltorio.
 */
export function parseDelimited(text: string): { rows: string[][]; notes: string[]; delimiter: string } {
  const notes: string[] = [];
  let body = text.replace(/^﻿/, "");
  let forced: string | undefined;
  const sep = body.match(/^sep=(.)\r?\n/i);
  if (sep) {
    forced = sep[1];
    body = body.slice(sep[0].length);
  }

  if (!forced) {
    // Señal inequívoca: la cabecera es UNA celda con comas y termina en «;»
    // (la columna vacía que Excel añade porque alguna línea se partió).
    const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
    const semi = parseCsv(body.slice(0, 200_000), ";").slice(0, 200);
    const wrapped =
      semi.length >= 2 &&
      /;\s*$/.test(firstLine) &&
      semi[0].filter((c) => c.trim() !== "").length === 1 &&
      (semi[0][0].match(/,/g)?.length ?? 0) >= 2 &&
      semi.filter((r) => r[0].includes(",")).length >= semi.length * 0.8;
    if (wrapped) {
      // Si la línea original tenía un «;» (en un título, p. ej.), Excel la
      // partió en varias celdas: se vuelven a unir con el mismo «;». Las
      // celdas vacías del final son solo relleno de columnas.
      const all = parseCsv(body, ";");
      body = all
        .map((r) => {
          let end = r.length;
          while (end > 1 && r[end - 1] === "") end--;
          return r.slice(0, end).join(";");
        })
        .join("\n");
      forced = ",";
      notes.push("El CSV venía reenvuelto por Excel (cada línea dentro de una celda con «;»): se reconstruyó automáticamente");
    }
  }

  let delim = forced;
  if (!delim) {
    const sample = body.slice(0, 64_000);
    let best = -1;
    for (const d of DELIMITERS) {
      const rows = parseCsv(sample, d).slice(0, 50);
      const { width, share } = modeWidth(rows);
      const score = width > 1 ? share * Math.min(width, 12) : 0;
      if (score > best) [best, delim] = [score, d];
    }
  }
  return { rows: parseCsv(body, delim ?? ","), notes, delimiter: delim ?? "," };
}

/* ------------------------------------------------------------------- JSON */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const PREFERRED_KEY = /trans|mov|record|registro|items|rows|entries|operac|data/i;

function findRecords(v: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(v)) return v.some((x) => isObj(x) || Array.isArray(x)) ? v : null;
  if (!isObj(v) || depth > 3) return null;
  const keys = Object.keys(v).sort((a, b) => Number(PREFERRED_KEY.test(b)) - Number(PREFERRED_KEY.test(a)));
  for (const k of keys) {
    const found = findRecords(v[k], depth + 1);
    if (found) return found;
  }
  return null;
}

function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v) && v.every((x) => typeof x !== "object")) return v.join("|");
  return JSON.stringify(v).slice(0, 2000);
}

export function jsonToTable(records: unknown[]): TableSource {
  if (records.every((r) => Array.isArray(r))) return gridToTable((records as unknown[][]).map((r) => r.map(toCell)), "json");
  const headers: string[] = [];
  const seen = new Set<string>();
  const flat = records.filter(isObj).map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      // Un nivel de anidación (`{ account: { name } }` -> `account.name`).
      if (isObj(v)) for (const [k2, v2] of Object.entries(v)) out[`${k}.${k2}`] = v2;
      else out[k] = v;
    }
    for (const k of Object.keys(out)) {
      if (seen.has(k)) continue;
      seen.add(k);
      headers.push(k);
    }
    return out;
  });
  return { type: "table", format: "json", headers, rows: flat.map((r) => headers.map((h) => toCell(r[h]))), firstRow: 1 };
}

/** Todas las listas de objetos de un JSON (hasta 2 niveles), como tablas con nombre. */
function jsonLists(payload: unknown): SqliteTable[] {
  const out: SqliteTable[] = [];
  const visit = (v: unknown, name: string, depth: number) => {
    if (Array.isArray(v) && v.length && v.every(isObj)) {
      const t = jsonToTable(v);
      out.push({ name, columns: t.headers, rows: t.rows as SqliteTable["rows"] });
    } else if (isObj(v) && depth < 2) for (const [k, x] of Object.entries(v)) visit(x, k, depth + 1);
  };
  visit(payload, "datos", 0);
  return out;
}

/* ------------------------------------------------ bases de datos relacionales */

const TX_TABLE = /trans|mov|operac|gasto|expense|record|registro|entries|payment|pago/i;
const NAME_COLUMN = /^(name|nombre|title|titulo|label|etiqueta|display_?name)$/i;

function tableFor(tables: SqliteTable[], base: string, self: SqliteTable): SqliteTable | undefined {
  const b = base.toLowerCase().replace(/[_\s]+$/, "");
  const variants = new Set([b, `${b}s`, `${b}es`, b.replace(/y$/, "ies")]);
  return tables.find((t) => t !== self && variants.has(t.name.toLowerCase()));
}

/** Columna de nombres de una tabla de referencia (`name`, `nombre`, `title`… o `*_name`). */
function nameColumn(t: SqliteTable): number {
  const exact = t.columns.findIndex((c) => NAME_COLUMN.test(c));
  return exact >= 0 ? exact : t.columns.findIndex((c) => /(name|nombre)$/i.test(c));
}

/** Clave primaria probable de una tabla de referencia. */
function keyColumn(t: SqliteTable, declared: string | null): number {
  if (declared) return t.columns.findIndex((c) => c.toLowerCase() === declared.toLowerCase());
  const exact = t.columns.findIndex((c) => /^(id|uuid|pk|key)$/i.test(c));
  if (exact >= 0) return exact;
  // `wallet_pk` en `wallets`, `categoryId` en `categories`…
  return t.columns.findIndex((c) => {
    const m = c.match(/^(.+?)[_\s]?(id|pk|key)$/i);
    return !!m && t.name.toLowerCase().startsWith(m[1].toLowerCase());
  });
}

/**
 * Sustituye las columnas que son identificadores de otra tabla (claves
 * foráneas declaradas o columnas `categoria_id`, `wallet_fk`, `categoryId`…)
 * por el NOMBRE correspondiente de la tabla relacionada. Así nunca se toma un
 * identificador por un nombre de categoría o cuenta.
 */
export function withRelations(tables: SqliteTable[]): { tables: TableSource[]; notes: string[] } {
  const notes: string[] = [];
  const out = tables
    .filter((t) => t.rows.length > 0 && t.columns.length > 1)
    .sort((a, b) => Number(TX_TABLE.test(b.name)) - Number(TX_TABLE.test(a.name)) || b.rows.length - a.rows.length)
    .map((t): TableSource => {
      const headers = [...t.columns];
      const rows = t.rows.map((r) => [...r] as Cell[]);
      const idColumns: string[] = [];
      t.columns.forEach((col, ci) => {
        const declared = t.foreignKeys?.find((f) => f.column.toLowerCase() === col.toLowerCase());
        const m = col.match(/^(.+?)[_\s]?(id|fk|pk|key)$/i);
        const ref = declared ? tables.find((x) => x.name.toLowerCase() === declared.table.toLowerCase()) : m ? tableFor(tables, m[1], t) : undefined;
        if (!ref || ref === t) return;
        const nameIdx = nameColumn(ref);
        const refIdx = keyColumn(ref, declared?.refColumn ?? null);
        if (nameIdx < 0 || refIdx < 0) return;
        const names = new Map(ref.rows.map((r) => [String(r[refIdx]), r[nameIdx]]));
        const base = (m?.[1] ?? col).replace(/[_\s]+$/, "");
        headers.push(`${base} (nombre)`);
        let missing = 0;
        t.rows.forEach((r, i) => {
          const v = r[ci];
          const name = v === null || v === undefined || v === "" ? null : names.get(String(v)) ?? null;
          if (v !== null && v !== undefined && v !== "" && name === null) missing++;
          rows[i].push(name === null ? null : String(name));
        });
        idColumns.push(col);
        notes.push(`«${t.name}.${col}» son identificadores de «${ref.name}»: se usan sus nombres (columna «${base} (nombre)»)`);
        if (missing) notes.push(`«${t.name}.${col}»: ${missing} valor(es) no existen en «${ref.name}»`);
      });
      return { type: "table", format: "sqlite", name: t.name, headers, rows, firstRow: 1, idColumns };
    });
  return { tables: out, notes };
}

function rowsAsObjects(t: SqliteTable | undefined): Record<string, Cell>[] {
  if (!t) return [];
  return t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])));
}

/** Columnas de Cashew que usa el adaptador; si faltan, se informa de lo que se pierde. */
const CASHEW_OPTIONAL: Record<string, string> = {
  paired_transaction_fk: "las transferencias no se podrán emparejar",
  sub_category_fk: "no se usarán subcategorías",
  paid: "no se distinguirán las transacciones pendientes",
  objective_fk: "no se anotarán los objetivos",
  income: "el tipo se deducirá del signo del importe",
  note: "no se importarán las notas",
};

function databaseToFile(tables: SqliteTable[], label: string, origin: "sqlite" | "sql", notes: string[]): DetectedFile {
  if (looksLikeCashew(tables)) {
    const get = (n: string) => rowsAsObjects(tables.find((t) => t.name.toLowerCase() === n));
    const txCols = tables.find((t) => t.name.toLowerCase() === "transactions")!.columns;
    const missing = Object.entries(CASHEW_OPTIONAL).filter(([c]) => !txCols.includes(c));
    const source: CashewSource = {
      type: "cashew",
      origin,
      wallets: get("wallets"),
      categories: get("categories"),
      transactions: get("transactions"),
      objectives: get("objectives"),
      notes: [...notes, ...missing.map(([c, what]) => `Esta versión de Cashew no tiene la columna «${c}»: ${what}`)],
    };
    const ex = cashewRecords(source);
    return {
      kind: "cashew",
      source,
      label: `${label} · Cashew (${origin === "sqlite" ? "SQLite" : "volcado SQL"})`,
      summary: `${source.transactions.length} transacciones, ${source.wallets.length} billeteras y ${source.categories.length} categorías (${ex.records.filter((r) => r.mergedInto).length} transferencias emparejadas)`,
    };
  }
  const rel = withRelations(tables);
  if (!rel.tables.length) throw new ImportFileError("La base de datos no tiene tablas con datos");
  return {
    kind: "tables",
    tables: rel.tables.map((t) => ({ ...t, format: origin, notes: [...notes, ...rel.notes.filter((n) => n.startsWith(`«${t.name}.`))] })),
    label: `${label} · ${origin === "sqlite" ? "SQLite" : "SQL"}`,
  };
}

/* ------------------------------------------------------------------ lectores */

export interface ReaderInput {
  name: string;
  /** Extensión en minúsculas, sin punto. */
  ext: string;
  bytes: Uint8Array;
  /** Texto decodificado (perezoso: solo lo piden los lectores de texto). */
  text(): { text: string; note?: string };
}

/**
 * Lector de un formato. Para admitir uno nuevo basta con registrar otro
 * (`registerReader`): el motor de normalización y validación no cambia.
 */
export interface ImportReader {
  id: string;
  label: string;
  /** Extensiones habituales (solo para avisar si no coinciden con el contenido). */
  extensions: string[];
  /** ¿El CONTENIDO es de este formato? */
  sniff(input: ReaderInput): boolean;
  read(input: ReaderInput): DetectedFile | Promise<DetectedFile>;
}

/** Binario = bytes de control abundantes al principio (y no es UTF-16 con BOM). */
export function looksBinary(bytes: Uint8Array): boolean {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return false;
  const n = Math.min(bytes.length, 4096);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 12 && b !== 13)) bad++;
  }
  return bad > n * 0.02;
}

const textual = (input: ReaderInput) => !looksBinary(input.bytes);

function sheetsToFile(sheets: { name: string; rows: Cell[][] }[], format: "xls" | "xlsx", label: string): DetectedFile {
  const tables = sheets.filter((s) => s.rows.some((r) => r.some((c) => !isBlank(c)))).map((s) => gridToTable(s.rows, format, s.name));
  if (!tables.length) throw new ImportFileError("El Excel no tiene hojas con datos");
  return { kind: "tables", tables, label };
}

const READERS: ImportReader[] = [
  {
    id: "sqlite",
    label: "Base de datos SQLite",
    extensions: ["db", "sqlite", "sqlite3", "sql"],
    sniff: (i) => isSqlite(i.bytes),
    read: (i) => {
      let tables: SqliteTable[];
      try {
        tables = readSqlite(i.bytes);
      } catch (e) {
        throw new ImportFileError(`No se pudo leer la base de datos SQLite (¿dañada o incompleta?): ${(e as Error).message}`);
      }
      return databaseToFile(tables, i.name, "sqlite", []);
    },
  },
  {
    id: "xls",
    label: "Excel 97-2003",
    extensions: ["xls"],
    sniff: (i) => isCfb(i.bytes),
    read: (i) => {
      try {
        return sheetsToFile(readXls(i.bytes), "xls", `${i.name} · Excel 97-2003`);
      } catch (e) {
        if (e instanceof ImportFileError) throw e;
        throw new ImportFileError((e as Error).message);
      }
    },
  },
  {
    id: "xlsx",
    label: "Excel",
    extensions: ["xlsx", "xlsm"],
    sniff: (i) => isZip(i.bytes),
    read: async (i) => {
      let sheets;
      try {
        sheets = await readXlsx(i.bytes);
      } catch (e) {
        throw new ImportFileError((e as Error).message);
      }
      return sheetsToFile(sheets, "xlsx", `${i.name} · Excel`);
    },
  },
  {
    id: "json",
    label: "JSON",
    extensions: ["json"],
    sniff: (i) => textual(i) && /^\s*[[{]/.test(i.text().text.slice(0, 200)),
    read: (i) => {
      const { text, note } = i.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch (e) {
        throw new ImportFileError(`El JSON está dañado o incompleto: ${(e as Error).message}`);
      }
      if (isObj(payload) && payload.format === EXPORT_FORMAT) return { kind: "native", payload, label: `${i.name} · copia de esta app` };
      const pre = note ? [note] : [];
      const lists = jsonLists(payload);
      if (lists.length > 1) {
        // Varias listas (movimientos, cuentas, categorías…): tablas relacionadas.
        const rel = withRelations(lists);
        if (rel.tables.length) {
          return {
            kind: "tables",
            tables: rel.tables.map((t) => ({ ...t, format: "json", notes: [...pre, ...rel.notes.filter((n) => n.startsWith(`«${t.name}.`))] })),
            label: `${i.name} · JSON`,
          };
        }
      }
      const records = findRecords(payload);
      if (!records?.length) throw new ImportFileError("El JSON no contiene ninguna lista de movimientos");
      const table = jsonToTable(records);
      return { kind: "tables", tables: [{ ...table, notes: [...pre, ...(table.notes ?? [])] }], label: `${i.name} · JSON` };
    },
  },
  {
    id: "sql",
    label: "Volcado SQL",
    extensions: ["sql"],
    sniff: (i) => textual(i) && looksLikeSqlDump(i.text().text),
    read: (i) => {
      let dump;
      try {
        dump = readSqlDump(i.text().text);
      } catch (e) {
        throw new ImportFileError((e as Error).message);
      }
      const notes = ["El SQL se analizó como texto: no se ejecutó ninguna sentencia"];
      if (dump.ignored) notes.push(`Se ignoraron ${dump.ignored} sentencia(s) que no son CREATE TABLE ni INSERT`);
      if (dump.skippedRows) notes.push(`Se descartaron ${dump.skippedRows} fila(s) con expresiones en lugar de valores`);
      if (!dump.tables.some((t) => t.rows.length)) throw new ImportFileError("El SQL no contiene sentencias INSERT con datos");
      return databaseToFile(dump.tables, i.name, "sql", notes);
    },
  },
  {
    // Comodín para cualquier texto: debe ser siempre el último.
    id: "delimited",
    label: "CSV / TSV",
    extensions: ["csv", "tsv", "txt", "tab"],
    sniff: textual,
    read: (i) => {
      const { text, note } = i.text();
      if (/^\s*<(!doctype|html|table|\?xml)/i.test(text)) {
        throw new ImportFileError("Es una página HTML/XML (algunos bancos la guardan como .xls): ábrela en Excel y guárdala como .xlsx o CSV");
      }
      if (/^\s*(CREATE|INSERT|BEGIN|PRAGMA|DROP)\b/i.test(text)) throw new ImportFileError("El SQL no contiene sentencias INSERT con datos");
      const { rows, notes, delimiter } = parseDelimited(text);
      if (rows.length < 1) throw new ImportFileError("El archivo no contiene filas");
      const format = delimiter === "\t" ? "tsv" : "csv";
      return { kind: "tables", tables: [gridToTable(rows, format, undefined, [...(note ? [note] : []), ...notes])], label: `${i.name} · ${format.toUpperCase()}` };
    },
  },
];

/** Añade un lector (p. ej. OFX, QIF). Con `first` tiene prioridad sobre los existentes. */
export function registerReader(reader: ImportReader, first = false): void {
  const i = READERS.findIndex((r) => r.id === reader.id);
  if (i >= 0) READERS.splice(i, 1);
  if (first) READERS.unshift(reader);
  else READERS.splice(READERS.length - 1, 0, reader); // siempre antes del CSV, que es el comodín
}

export function listReaders(): readonly ImportReader[] {
  return READERS;
}

/* ---------------------------------------------------------------- entrada */

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

const FORMAT_NAME: Record<string, string> = { sqlite: "SQLite", xls: "Excel 97-2003", xlsx: "Excel", json: "JSON", sql: "SQL de texto", delimited: "CSV/TSV" };

export async function readImportFile(name: string, bytes: Uint8Array): Promise<DetectedFile> {
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportFileError("El archivo supera 25 MB");
  if (bytes.length === 0) throw new ImportFileError("El archivo está vacío");
  // Solo el nombre, sin rutas: nunca se usa para acceder al disco.
  const base = (name.split(/[\\/]/).pop() ?? "archivo").slice(0, 200);
  const ext = (base.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? "").toLowerCase();
  let decoded: { text: string; note?: string } | null = null;
  const input: ReaderInput = { name: base, ext, bytes, text: () => (decoded ??= decodeText(bytes)) };

  const reader = READERS.find((r) => r.sniff(input));
  if (!reader) {
    throw new ImportFileError("Formato no reconocido: el archivo es binario y no es SQLite, Excel ni JSON (¿dañado o cifrado?)");
  }
  const file = await reader.read(input);
  // La extensión no manda, pero si no cuadra con el contenido se avisa.
  const expected = READERS.filter((r) => r.extensions.includes(ext));
  if (ext && expected.length && !expected.includes(reader)) {
    const note = `El archivo tiene extensión .${ext}, pero su contenido es ${FORMAT_NAME[reader.id] ?? reader.label}: se leyó según el contenido`;
    if (file.kind === "tables") file.tables.forEach((t) => (t.notes = [note, ...(t.notes ?? [])]));
    if (file.kind === "cashew") file.source.notes = [note, ...(file.source.notes ?? [])];
  }
  return file;
}
