/**
 * Lector de Excel 97-2003 (`.xls`, BIFF8), de solo lectura y sin dependencias.
 *
 * Un `.xls` es un «Compound File» (CFB/OLE2): un mini sistema de ficheros con
 * sectores encadenados por una tabla FAT. Dentro, el flujo `Workbook` es una
 * secuencia de registros BIFF (tipo, longitud, datos). Aquí solo se leen los
 * registros de celdas (texto, números, RK, fórmulas con su último resultado,
 * booleanos) y los formatos, para devolver las fechas como fecha.
 * Referencia: [MS-CFB] y [MS-XLS] de Microsoft.
 *
 * Nada se ejecuta: las fórmulas no se evalúan (se usa el valor que Excel dejó
 * guardado) y las macros ni se leen.
 */

import type { Cell } from "./normalize";
import { isDateFormatCode, serialToText } from "./xlsx";

export class XlsError extends Error {}

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;

export function isCfb(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && CFB_MAGIC.every((b, i) => bytes[i] === b);
}

/* --------------------------------------------------------------- CFB (OLE2) */

interface DirEntry {
  name: string;
  type: number;
  start: number;
  size: number;
}

export class Cfb {
  private readonly view: DataView;
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly miniCutoff: number;
  private readonly fat: number[] = [];
  private readonly miniFat: number[] = [];
  readonly entries: DirEntry[] = [];
  private miniStream: Uint8Array | null = null;

  constructor(private readonly bytes: Uint8Array) {
    if (!isCfb(bytes)) throw new XlsError("No es un archivo de Office 97-2003");
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const shift = this.view.getUint16(0x1e, true);
    if (shift !== 9 && shift !== 12) throw new XlsError("Archivo de Office dañado (tamaño de sector)");
    this.sectorSize = 1 << shift;
    this.miniSectorSize = 1 << this.view.getUint16(0x20, true);
    this.miniCutoff = this.view.getUint32(0x38, true);

    // FAT: sus sectores se listan en la DIFAT (109 en la cabecera + cadena).
    const fatSectors: number[] = [];
    for (let i = 0; i < 109; i++) {
      const s = this.view.getUint32(0x4c + i * 4, true);
      if (s !== FREE && s !== END_OF_CHAIN) fatSectors.push(s);
    }
    let difat = this.view.getUint32(0x44, true);
    const perDifat = this.sectorSize / 4 - 1;
    for (let guard = 0; difat !== END_OF_CHAIN && difat !== FREE && guard < 10_000; guard++) {
      const off = this.offset(difat);
      for (let i = 0; i < perDifat; i++) {
        const s = this.view.getUint32(off + i * 4, true);
        if (s !== FREE && s !== END_OF_CHAIN) fatSectors.push(s);
      }
      difat = this.view.getUint32(off + perDifat * 4, true);
    }
    for (const s of fatSectors) {
      const off = this.offset(s);
      for (let i = 0; i < this.sectorSize / 4; i++) this.fat.push(this.view.getUint32(off + i * 4, true));
    }

    const miniFatStart = this.view.getUint32(0x3c, true);
    if (miniFatStart !== END_OF_CHAIN && miniFatStart !== FREE) {
      const mf = this.chain(miniFatStart);
      const v = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
      for (let i = 0; i + 4 <= mf.length; i += 4) this.miniFat.push(v.getUint32(i, true));
    }

    const dir = this.chain(this.view.getUint32(0x30, true));
    const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
    for (let p = 0; p + 128 <= dir.length; p += 128) {
      const nameLen = Math.min(64, dv.getUint16(p + 0x40, true));
      const name = new TextDecoder("utf-16le").decode(dir.subarray(p, p + Math.max(0, nameLen - 2)));
      this.entries.push({ name, type: dir[p + 0x42], start: dv.getUint32(p + 0x74, true), size: dv.getUint32(p + 0x78, true) });
    }
  }

  private offset(sector: number): number {
    const off = (sector + 1) * this.sectorSize;
    if (off + this.sectorSize > this.bytes.length) throw new XlsError("Archivo de Office dañado o incompleto");
    return off;
  }

  /** Concatena una cadena de sectores de la FAT. */
  private chain(start: number, limit = Infinity): Uint8Array {
    const parts: Uint8Array[] = [];
    let s = start;
    let total = 0;
    const seen = new Set<number>();
    while (s !== END_OF_CHAIN && s !== FREE && total < limit) {
      if (seen.has(s) || s >= this.fat.length + 1_000_000) throw new XlsError("Archivo de Office dañado (cadena de sectores en bucle)");
      seen.add(s);
      const off = this.offset(s);
      parts.push(this.bytes.subarray(off, off + this.sectorSize));
      total += this.sectorSize;
      s = this.fat[s] ?? END_OF_CHAIN;
    }
    return concat(parts);
  }

  private miniChain(start: number, size: number): Uint8Array {
    if (!this.miniStream) {
      const root = this.entries.find((e) => e.type === 5);
      this.miniStream = root ? this.chain(root.start) : new Uint8Array();
    }
    const parts: Uint8Array[] = [];
    let s = start;
    let total = 0;
    const seen = new Set<number>();
    while (s !== END_OF_CHAIN && s !== FREE && total < size) {
      if (seen.has(s)) throw new XlsError("Archivo de Office dañado (mini cadena en bucle)");
      seen.add(s);
      const off = s * this.miniSectorSize;
      parts.push(this.miniStream.subarray(off, off + this.miniSectorSize));
      total += this.miniSectorSize;
      s = this.miniFat[s] ?? END_OF_CHAIN;
    }
    return concat(parts);
  }

  has(name: string): boolean {
    return this.entries.some((e) => e.type === 2 && e.name.toLowerCase() === name.toLowerCase());
  }

  stream(name: string): Uint8Array | null {
    const e = this.entries.find((x) => x.type === 2 && x.name.toLowerCase() === name.toLowerCase());
    if (!e) return null;
    const data = e.size < this.miniCutoff ? this.miniChain(e.start, e.size) : this.chain(e.start, e.size);
    return data.subarray(0, e.size);
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/* -------------------------------------------------------------------- BIFF8 */

interface BiffRecord {
  type: number;
  data: Uint8Array;
  /** Datos de los registros CONTINUE que siguen (cadenas largas del SST). */
  continues: Uint8Array[];
}

function records(stream: Uint8Array, from: number): BiffRecord[] {
  const out: BiffRecord[] = [];
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  let p = from;
  while (p + 4 <= stream.length) {
    const type = view.getUint16(p, true);
    const len = view.getUint16(p + 2, true);
    const data = stream.subarray(p + 4, p + 4 + len);
    p += 4 + len;
    if (type === 0x003c && out.length) out[out.length - 1].continues.push(data);
    else out.push({ type, data, continues: [] });
    if (type === 0x000a) break; // EOF de este subflujo
  }
  return out;
}

/** Lector secuencial que cruza registros CONTINUE (necesario para el SST). */
class Segments {
  private seg = 0;
  private pos = 0;
  constructor(private readonly segs: Uint8Array[]) {}
  private get cur() {
    return this.segs[this.seg];
  }
  private ensure() {
    while (this.cur && this.pos >= this.cur.length) {
      this.seg++;
      this.pos = 0;
    }
    if (!this.cur) throw new XlsError("Tabla de textos del Excel incompleta");
  }
  u8() {
    this.ensure();
    return this.cur[this.pos++];
  }
  u16() {
    return this.u8() | (this.u8() << 8);
  }
  u32() {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  skip(n: number) {
    for (let i = 0; i < n; i++) this.u8();
  }
  /** Caracteres de una cadena: al saltar a un CONTINUE llega un nuevo byte de opciones. */
  chars(count: number, high: boolean): string {
    let out = "";
    let wide = high;
    for (let i = 0; i < count; i++) {
      if (this.cur && this.pos >= this.cur.length) {
        this.seg++;
        this.pos = 0;
        if (!this.cur) throw new XlsError("Tabla de textos del Excel incompleta");
        wide = (this.u8() & 0x01) === 1;
      }
      out += String.fromCharCode(wide ? this.u16() : this.u8());
    }
    return out;
  }
}

function readSst(rec: BiffRecord): string[] {
  const r = new Segments([rec.data, ...rec.continues]);
  r.u32(); // total de referencias
  const unique = r.u32();
  const out: string[] = [];
  for (let i = 0; i < unique && i < 2_000_000; i++) {
    const cch = r.u16();
    const flags = r.u8();
    const runs = flags & 0x08 ? r.u16() : 0;
    const ext = flags & 0x04 ? r.u32() : 0;
    out.push(r.chars(cch, (flags & 0x01) === 1));
    r.skip(runs * 4 + ext);
  }
  return out;
}

/** XLUnicodeString (celdas LABEL, STRING, FORMAT): longitud de 16 bits. */
function unicodeString(data: Uint8Array, at: number, lenBytes: 1 | 2 = 2): string {
  const cch = lenBytes === 2 ? data[at] | (data[at + 1] << 8) : data[at];
  const flags = data[at + lenBytes];
  let p = at + lenBytes + 1;
  let out = "";
  const wide = (flags & 0x01) === 1;
  for (let i = 0; i < cch && p < data.length; i++) {
    out += String.fromCharCode(wide ? data[p] | (data[p + 1] << 8) : data[p]);
    p += wide ? 2 : 1;
  }
  return out;
}

function rk(v: number): number {
  let n: number;
  if (v & 0x02) n = v >> 2; // entero con signo de 30 bits
  else {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setUint32(0, v & 0xfffffffc, false);
    buf.setUint32(4, 0, false);
    n = buf.getFloat64(0, false);
  }
  return v & 0x01 ? n / 100 : n;
}

const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

export interface XlsSheet {
  name: string;
  rows: Cell[][];
}

export function readXls(bytes: Uint8Array, maxRows = 60_000): XlsSheet[] {
  const cfb = new Cfb(bytes);
  if (cfb.has("EncryptedPackage") || cfb.has("EncryptionInfo")) {
    throw new XlsError("El archivo está protegido con contraseña (cifrado): ábrelo en Excel, quita la contraseña y guárdalo de nuevo");
  }
  const stream = cfb.stream("Workbook") ?? cfb.stream("Book");
  if (!stream) {
    if (cfb.has("WordDocument")) throw new XlsError("Es un documento de Word, no una hoja de cálculo");
    throw new XlsError("El archivo de Office no contiene un libro de Excel");
  }
  const globals = records(stream, 0);
  const bof = globals[0];
  if (!bof || bof.type !== 0x0809) throw new XlsError("Libro de Excel dañado (falta el encabezado BIFF)");
  const version = bof.data[0] | (bof.data[1] << 8);
  if (version !== 0x0600) throw new XlsError("Versión de Excel anterior a 97 (BIFF5 o menos): guárdalo como .xlsx");
  if (globals.some((r) => r.type === 0x002f)) {
    throw new XlsError("El libro está protegido con contraseña (cifrado): quítala en Excel y guárdalo de nuevo");
  }

  let sst: string[] = [];
  let date1904 = false;
  const formats = new Map<number, string>();
  const xfFormat: number[] = [];
  const sheets: { name: string; pos: number }[] = [];
  for (const r of globals) {
    const d = r.data;
    const u16 = (o: number) => d[o] | (d[o + 1] << 8);
    if (r.type === 0x00fc) sst = readSst(r);
    else if (r.type === 0x0022) date1904 = u16(0) === 1;
    else if (r.type === 0x041e) formats.set(u16(0), unicodeString(d, 2));
    else if (r.type === 0x00e0) xfFormat.push(u16(2));
    else if (r.type === 0x0085 && d[5] === 0) {
      // BOUNDSHEET: solo hojas de cálculo (no gráficos ni macros).
      sheets.push({ pos: (u16(0) | (u16(2) << 16)) >>> 0, name: unicodeString(d, 6, 1) });
    }
  }
  const isDate = (ixfe: number) => {
    const f = xfFormat[ixfe];
    if (f === undefined) return false;
    return BUILTIN_DATES.has(f) || (formats.has(f) && isDateFormatCode(formats.get(f)!));
  };
  const num = (value: number, ixfe: number): Cell => (isDate(ixfe) ? serialToText(date1904 ? value + 1462 : value) : value);

  return sheets.map(({ name, pos }) => {
    if (pos >= stream.length) throw new XlsError(`Hoja «${name}» dañada`);
    const rows: Cell[][] = [];
    const set = (r: number, c: number, v: Cell) => {
      if (r >= maxRows) throw new XlsError(`La hoja «${name}» supera ${maxRows} filas`);
      if (c > 1000) return;
      while (rows.length <= r) rows.push([]);
      const row = rows[r];
      while (row.length < c) row.push(null);
      row[c] = v;
    };
    let pendingFormula: { r: number; c: number } | null = null;
    for (const rec of records(stream, pos)) {
      const d = rec.data;
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      if (d.length < 6 && rec.type !== 0x0207) continue;
      const row = d.length >= 2 ? dv.getUint16(0, true) : 0;
      const col = d.length >= 4 ? dv.getUint16(2, true) : 0;
      const ixfe = d.length >= 6 ? dv.getUint16(4, true) : 0;
      switch (rec.type) {
        case 0x00fd: // LABELSST
          set(row, col, sst[dv.getUint32(6, true)] ?? null);
          break;
        case 0x0204: // LABEL
          set(row, col, unicodeString(d, 6));
          break;
        case 0x0203: // NUMBER
          set(row, col, num(dv.getFloat64(6, true), ixfe));
          break;
        case 0x027e: // RK
          set(row, col, num(rk(dv.getUint32(6, true)), ixfe));
          break;
        case 0x00bd: {
          // MULRK: varias celdas RK seguidas
          const last = dv.getUint16(d.length - 2, true);
          for (let c = col, p = 4; c <= last && p + 6 <= d.length - 2; c++, p += 6) set(row, c, num(rk(dv.getUint32(p + 2, true)), dv.getUint16(p, true)));
          break;
        }
        case 0x0205: // BOOLERR
          set(row, col, d[7] ? null : d[6] === 1);
          break;
        case 0x0006: {
          // FORMULA: se usa el resultado guardado, nunca se evalúa.
          if (dv.getUint16(12, true) === 0xffff) {
            const kind = d[6];
            if (kind === 0) pendingFormula = { r: row, c: col }; // el texto llega en el registro STRING
            else if (kind === 1) set(row, col, d[8] === 1);
            else set(row, col, null);
          } else set(row, col, num(dv.getFloat64(6, true), ixfe));
          break;
        }
        case 0x0207: // STRING (resultado de la fórmula anterior)
          if (pendingFormula) set(pendingFormula.r, pendingFormula.c, unicodeString(d, 0));
          pendingFormula = null;
          break;
      }
    }
    return { name, rows };
  });
}
