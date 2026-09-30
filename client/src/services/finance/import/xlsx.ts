/**
 * Lector mínimo de hojas Excel `.xlsx` (Office Open XML), sin dependencias.
 *
 * Un `.xlsx` es un ZIP con XML dentro. Se lee el directorio central del ZIP,
 * se descomprime con `DecompressionStream("deflate-raw")` (nativo en los
 * navegadores y en Node 18+) y se extraen las celdas con expresiones
 * regulares acotadas: no hace falta un parser XML completo para leer valores,
 * y así no hay entidades externas ni DTD que resolver.
 *
 * Las celdas con formato de fecha se devuelven como `AAAA-MM-DD HH:MM:SS`; el
 * resto de números, como número (sin pasar por texto: no hay ambigüedad de
 * separadores).
 */

import type { Cell } from "./normalize";

export interface Sheet {
  name: string;
  rows: Cell[][];
}

/** Tope por entrada descomprimida: un ZIP de 1 MB no debe convertirse en 1 GB. */
const MAX_ENTRY = 60 * 1024 * 1024;

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Excel 97-2003 (`.xls`, contenedor OLE2). */
export function isLegacyXls(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

interface ZipEntry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

function zipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP dañado: no se encuentra el directorio central");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP dañado");
    const nameLen = view.getUint16(p + 28, true);
    const entry: ZipEntry = {
      method: view.getUint16(p + 10, true),
      compressed: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      offset: view.getUint32(p + 42, true),
      name: dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
    };
    out.set(entry.name.replace(/^\/+/, ""), entry);
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_ENTRY) {
      await reader.cancel();
      throw new Error("El Excel descomprimido es demasiado grande");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

async function readEntry(bytes: Uint8Array, entries: Map<string, ZipEntry>, name: string): Promise<string | null> {
  const e = entries.get(name);
  if (!e) return null;
  if (e.size > MAX_ENTRY) throw new Error("El Excel descomprimido es demasiado grande");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(e.offset, true) !== 0x04034b50) throw new Error("ZIP dañado");
  const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
  const raw = bytes.subarray(start, start + e.compressed);
  const data = e.method === 0 ? raw : e.method === 8 ? await inflate(raw) : null;
  if (!data) throw new Error(`Compresión ZIP no soportada (${e.method})`);
  return new TextDecoder().decode(data);
}

export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;

/** Texto de un nodo con posibles «runs» (`<r><t>a</t></r><r><t>b</t></r>`). */
function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return unescapeXml(out);
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Índices de estilo (`s="N"`) cuyas celdas son fechas. */
function dateStyles(stylesXml: string | null): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attr(m[0], "numFmtId"));
    custom.set(id, unescapeXml(attr(m[0], "formatCode") ?? ""));
  }
  const isDateFmt = (id: number) => {
    if (BUILTIN_DATE_FORMATS.has(id)) return true;
    const code = custom.get(id);
    if (!code) return false;
    // Se ignora lo entrecomillado y entre corchetes (colores, locales).
    const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    return /[dmyh]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare);
  };
  const xfs = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  let i = 0;
  for (const m of xfs.matchAll(/<xf\b[^>]*>/g)) {
    if (isDateFmt(Number(attr(m[0], "numFmtId") ?? 0))) out.add(i);
    i++;
  }
  return out;
}

function serialToText(serial: number): string {
  const whole = Math.floor(serial);
  const d = new Date(1899, 11, 30 + whole);
  d.setSeconds(Math.round((serial - whole) * 86400));
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return serial === whole ? date : `${date} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml: string, shared: string[], dates: Set<number>, maxRows: number): Cell[][] {
  const rows: Cell[][] = [];
  const data = xml.match(/<sheetData\b[^>]*>([\s\S]*)<\/sheetData>/)?.[1] ?? "";
  for (const rm of data.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const rowNum = Number(attr(rm[1] ?? "", "r")) || rows.length + 1;
    const row: Cell[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1];
      const ref = attr(a, "r");
      const idx = ref ? colIndex(ref) : next;
      next = idx + 1;
      if (idx > 1000) continue;
      const t = attr(a, "t") ?? "n";
      const inner = cm[2] ?? "";
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value: Cell = null;
      if (t === "s") value = v !== undefined ? shared[Number(v)] ?? null : null;
      else if (t === "inlineStr") value = textOf(inner);
      else if (t === "str" || t === "e") value = v !== undefined ? unescapeXml(v) : null;
      else if (t === "b") value = v === "1";
      else if (v !== undefined) {
        const n = Number(v);
        value = Number.isFinite(n) ? (dates.has(Number(attr(a, "s") ?? -1)) ? serialToText(n) : n) : unescapeXml(v);
      }
      while (row.length < idx) row.push(null);
      row[idx] = value;
    }
    // Las filas vacías intermedias se conservan para que el número de fila coincida con Excel.
    while (rows.length < rowNum - 1) rows.push([]);
    rows.push(row);
    if (rows.length > maxRows) throw new Error(`La hoja supera ${maxRows} filas`);
  }
  return rows;
}

/** Hojas de un `.xlsx` como matrices de celdas (fila 1 de Excel = índice 0). */
export async function readXlsx(bytes: Uint8Array, maxRows = 60_000): Promise<Sheet[]> {
  const entries = zipEntries(bytes);
  const workbook = await readEntry(bytes, entries, "xl/workbook.xml");
  if (!workbook) {
    if (entries.has("content.xml")) throw new Error("Es una hoja de OpenDocument (.ods): guárdala como .xlsx o .csv");
    throw new Error("El ZIP no contiene un libro de Excel");
  }
  const rels = (await readEntry(bytes, entries, "xl/_rels/workbook.xml.rels")) ?? "";
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }
  const sharedXml = await readEntry(bytes, entries, "xl/sharedStrings.xml");
  const shared = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const dates = dateStyles(await readEntry(bytes, entries, "xl/styles.xml"));

  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescapeXml(attr(m[0], "name") ?? `Hoja ${sheets.length + 1}`);
    const rid = attr(m[0], "r:id");
    const path = (rid && targets.get(rid)) || `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const xml = await readEntry(bytes, entries, path);
    if (xml) sheets.push({ name, rows: parseSheet(xml, shared, dates, maxRows) });
  }
  return sheets;
}
