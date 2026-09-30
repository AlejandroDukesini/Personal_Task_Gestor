/**
 * Lectura de ficheros de importación: detecta el formato por su CONTENIDO
 * (no por la extensión, que suele mentir: Cashew guarda su SQLite como
 * `.sql`) y lo convierte en una fuente que entiende el motor.
 */

import { EXPORT_FORMAT, parseCsv } from "../io";
import { cashewRecords, looksLikeCashew } from "./cashew";
import { gridToTable } from "./engine";
import { isBlank, type Cell } from "./normalize";
import { isSqlite, readSqlite, type SqliteTable } from "./sqlite";
import type { CashewSource, TableSource } from "./types";
import { isLegacyXls, isZip, readXlsx } from "./xlsx";

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
 * CSV con separador autodetectado. Repara además el caso frecuente de un CSV
 * abierto y guardado de nuevo con Excel en configuración regional española:
 * cada línea original acaba metida en UNA celda de un CSV con `;`
 * (`"a,b,""nota""";`). Se detecta porque todas las filas tienen una sola
 * celda con comas dentro, y se deshace el envoltorio.
 */
export function parseDelimited(text: string): { rows: string[][]; notes: string[] } {
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
  return { rows: parseCsv(body, delim ?? ","), notes };
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

/* ----------------------------------------------------------------- SQLite */

const TX_TABLE = /trans|mov|operac|gasto|expense|record|registro|entries/i;

function sqliteToTables(tables: SqliteTable[]): TableSource[] {
  return tables
    .filter((t) => t.rows.length > 0 && t.columns.length > 1)
    .sort((a, b) => Number(TX_TABLE.test(b.name)) - Number(TX_TABLE.test(a.name)) || b.rows.length - a.rows.length)
    .map((t) => ({ type: "table", format: "sqlite", name: t.name, headers: t.columns, rows: t.rows, firstRow: 1 }));
}

function rowsAsObjects(t: SqliteTable | undefined): Record<string, Cell>[] {
  if (!t) return [];
  return t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])));
}

/* ---------------------------------------------------------------- entrada */

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

export async function readImportFile(name: string, bytes: Uint8Array): Promise<DetectedFile> {
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportFileError("El archivo supera 25 MB");
  if (bytes.length === 0) throw new ImportFileError("El archivo está vacío");

  if (isSqlite(bytes)) {
    let tables: SqliteTable[];
    try {
      tables = readSqlite(bytes);
    } catch (e) {
      throw new ImportFileError(`No se pudo leer la base de datos SQLite: ${(e as Error).message}`);
    }
    if (looksLikeCashew(tables)) {
      const get = (n: string) => rowsAsObjects(tables.find((t) => t.name === n));
      const source: CashewSource = {
        type: "cashew",
        wallets: get("wallets"),
        categories: get("categories"),
        transactions: get("transactions"),
        objectives: get("objectives"),
      };
      const ex = cashewRecords(source);
      return {
        kind: "cashew",
        source,
        label: `${name} · Cashew (SQLite)`,
        summary: `${source.transactions.length} transacciones, ${source.wallets.length} billeteras y ${source.categories.length} categorías (${ex.records.filter((r) => r.mergedInto).length} transferencias emparejadas)`,
      };
    }
    const out = sqliteToTables(tables);
    if (!out.length) throw new ImportFileError("La base de datos no tiene tablas con datos");
    return { kind: "tables", tables: out, label: `${name} · SQLite` };
  }

  if (isZip(bytes)) {
    let sheets;
    try {
      sheets = await readXlsx(bytes);
    } catch (e) {
      throw new ImportFileError((e as Error).message);
    }
    const tables = sheets.filter((s) => s.rows.some((r) => r.some((c) => !isBlank(c)))).map((s) => gridToTable(s.rows, "xlsx", s.name));
    if (!tables.length) throw new ImportFileError("El Excel no tiene hojas con datos");
    return { kind: "tables", tables, label: `${name} · Excel` };
  }

  if (isLegacyXls(bytes)) throw new ImportFileError("Formato Excel 97-2003 (.xls): ábrelo y guárdalo como .xlsx o .csv");

  const { text, note } = decodeText(bytes);
  const notes = note ? [note] : [];
  const trimmed = text.trim();
  if (/^(CREATE|INSERT|BEGIN|PRAGMA)\b/i.test(trimmed)) {
    throw new ImportFileError("Es un script SQL de texto: por seguridad no se ejecuta. Exporta los datos como CSV, Excel o copia SQLite");
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let payload: unknown;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      payload = undefined;
    }
    if (payload !== undefined) {
      if (isObj(payload) && payload.format === EXPORT_FORMAT) return { kind: "native", payload, label: `${name} · copia de esta app` };
      const records = findRecords(payload);
      if (!records?.length) throw new ImportFileError("El JSON no contiene ninguna lista de movimientos");
      const table = jsonToTable(records);
      return { kind: "tables", tables: [{ ...table, notes: [...notes, ...(table.notes ?? [])] }], label: `${name} · JSON` };
    }
  }

  const { rows, notes: csvNotes } = parseDelimited(text);
  if (rows.length < 1) throw new ImportFileError("El archivo no contiene filas");
  return { kind: "tables", tables: [gridToTable(rows, "csv", undefined, [...notes, ...csvNotes])], label: `${name} · CSV` };
}
