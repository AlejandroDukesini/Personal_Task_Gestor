/**
 * Lector de bases de datos SQLite de SOLO LECTURA, sin dependencias.
 *
 * Por qué no `sql.js`: necesita WebAssembly, que la CSP de producción
 * (`script-src 'self'`) bloquea, y añade ~1 MB al bundle. Además un motor SQL
 * completo es superficie de ataque innecesaria: para importar basta con
 * recorrer los árboles B de las tablas y decodificar sus registros según el
 * formato documentado en https://www.sqlite.org/fileformat.html. Aquí no se
 * ejecuta ninguna sentencia SQL del fichero: el `CREATE TABLE` de
 * `sqlite_master` solo se lee para conocer los nombres de las columnas.
 */

export type SqliteValue = string | number | null;

export interface SqliteTable {
  name: string;
  columns: string[];
  rows: SqliteValue[][];
}

const MAGIC = "SQLite format 3\u0000";

export function isSqlite(bytes: Uint8Array): boolean {
  if (bytes.length < 100) return false;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
  return true;
}

export class SqliteError extends Error {}

export class SqliteReader {
  private readonly view: DataView;
  private readonly pageSize: number;
  private readonly usable: number;
  private readonly decoder: TextDecoder;
  private readonly pageCount: number;

  constructor(private readonly bytes: Uint8Array) {
    if (!isSqlite(bytes)) throw new SqliteError("No es una base de datos SQLite");
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const raw = this.view.getUint16(16);
    this.pageSize = raw === 1 ? 65536 : raw;
    if (this.pageSize < 512 || (this.pageSize & (this.pageSize - 1)) !== 0) throw new SqliteError("Tamaño de página no válido");
    this.usable = this.pageSize - bytes[20];
    this.pageCount = Math.floor(bytes.length / this.pageSize);
    const enc = this.view.getUint32(56);
    this.decoder = new TextDecoder(enc === 2 ? "utf-16le" : enc === 3 ? "utf-16be" : "utf-8");
  }

  /** Tablas de usuario con sus columnas (sin leer todavía las filas). */
  tables(): { name: string; columns: string[]; rootPage: number; withoutRowid: boolean; rowidAlias: number }[] {
    const out: ReturnType<SqliteReader["tables"]> = [];
    for (const row of this.scan(1)) {
      const [type, name, , rootPage, sql] = row.values;
      if (type !== "table" || typeof name !== "string" || typeof rootPage !== "number") continue;
      if (name.startsWith("sqlite_")) continue;
      const def = parseCreateTable(typeof sql === "string" ? sql : "");
      out.push({ name, rootPage, ...def });
    }
    return out;
  }

  /** Lee una tabla completa. `maxRows` protege de ficheros desmesurados. */
  readTable(name: string, maxRows = 200_000): SqliteTable {
    const t = this.tables().find((x) => x.name === name);
    if (!t) throw new SqliteError(`No existe la tabla «${name}»`);
    if (t.withoutRowid) throw new SqliteError(`La tabla «${name}» es WITHOUT ROWID y no se puede leer`);
    const rows: SqliteValue[][] = [];
    for (const { rowid, values } of this.scan(t.rootPage)) {
      const row = t.columns.map((_, i) => (i < values.length ? values[i] : null));
      // Una columna INTEGER PRIMARY KEY se guarda como NULL: su valor es el rowid.
      if (t.rowidAlias >= 0) row[t.rowidAlias] = rowid;
      rows.push(row);
      if (rows.length > maxRows) throw new SqliteError(`La tabla «${name}» supera ${maxRows} filas`);
    }
    return { name, columns: t.columns, rows };
  }

  /** Recorre en orden un árbol B de tabla (hojas 0x0D, interiores 0x05). */
  private *scan(rootPage: number): Generator<{ rowid: number; values: SqliteValue[] }> {
    const stack = [rootPage];
    const seen = new Set<number>();
    while (stack.length) {
      const page = stack.pop()!;
      if (page < 1 || page > this.pageCount || seen.has(page)) throw new SqliteError("Base de datos dañada (página fuera de rango o en bucle)");
      seen.add(page);
      const base = (page - 1) * this.pageSize;
      const hdr = page === 1 ? base + 100 : base;
      const type = this.bytes[hdr];
      const cells = this.view.getUint16(hdr + 3);
      if (type === 0x05) {
        const children: number[] = [];
        for (let i = 0; i < cells; i++) children.push(this.view.getUint32(base + this.view.getUint16(hdr + 12 + i * 2)));
        children.push(this.view.getUint32(hdr + 8)); // hijo más a la derecha
        // Pila LIFO: se apilan al revés para recorrer en orden de rowid.
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      } else if (type === 0x0d) {
        for (let i = 0; i < cells; i++) {
          let p = base + this.view.getUint16(hdr + 8 + i * 2);
          const [payload, n1] = this.varint(p);
          p += n1;
          const [rowid, n2] = this.varint(p);
          p += n2;
          yield { rowid, values: this.record(this.payload(p, payload)) };
        }
      } else {
        throw new SqliteError(`Tipo de página desconocido (${type})`);
      }
    }
  }

  /** Carga útil de una celda de hoja, siguiendo las páginas de desbordamiento. */
  private payload(start: number, size: number): Uint8Array {
    const U = this.usable;
    const X = U - 35;
    if (size <= X) return this.bytes.subarray(start, start + size);
    const M = Math.floor(((U - 12) * 32) / 255) - 23;
    const K = M + ((size - M) % (U - 4));
    const local = K <= X ? K : M;
    const out = new Uint8Array(size);
    out.set(this.bytes.subarray(start, start + local), 0);
    let written = local;
    let next = this.view.getUint32(start + local);
    let guard = 0;
    while (written < size) {
      if (next < 1 || next > this.pageCount || guard++ > this.pageCount) throw new SqliteError("Cadena de desbordamiento dañada");
      const base = (next - 1) * this.pageSize;
      const take = Math.min(size - written, U - 4);
      out.set(this.bytes.subarray(base + 4, base + 4 + take), written);
      written += take;
      next = this.view.getUint32(base);
    }
    return out;
  }

  private varint(p: number, buf: Uint8Array = this.bytes): [number, number] {
    let v = 0;
    for (let i = 0; i < 8; i++) {
      const b = buf[p + i];
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return [v, i + 1];
    }
    return [v * 256 + buf[p + 8], 9];
  }

  private record(buf: Uint8Array): SqliteValue[] {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const [headerSize, n] = this.varint(0, buf);
    const types: number[] = [];
    let p = n;
    while (p < headerSize) {
      const [t, k] = this.varint(p, buf);
      types.push(t);
      p += k;
    }
    let body = headerSize;
    const out: SqliteValue[] = [];
    const int = (len: number): number => {
      let v = 0;
      for (let i = 0; i < len; i++) v = v * 256 + buf[body + i];
      // Complemento a dos.
      if (len > 0 && buf[body] & 0x80) v -= 2 ** (8 * len);
      return v;
    };
    for (const t of types) {
      let len = 0;
      if (t === 0 || t === 8 || t === 9) out.push(t === 0 ? null : t === 8 ? 0 : 1);
      else if (t >= 1 && t <= 6) {
        len = [0, 1, 2, 3, 4, 6, 8][t];
        out.push(t === 6 ? Number(view.getBigInt64(body)) : int(len));
      } else if (t === 7) {
        len = 8;
        out.push(view.getFloat64(body));
      } else if (t >= 12) {
        len = Math.floor((t - (t % 2 ? 13 : 12)) / 2);
        // Los BLOB no tienen equivalente útil en una importación: se descartan.
        out.push(t % 2 ? this.decoder.decode(buf.subarray(body, body + len)) : null);
      } else throw new SqliteError(`Tipo de dato reservado (${t})`);
      body += len;
    }
    return out;
  }
}

/** Nombres de columna de un `CREATE TABLE`, sin evaluar nada. */
export function parseCreateTable(sql: string): { columns: string[]; withoutRowid: boolean; rowidAlias: number } {
  const open = sql.indexOf("(");
  const close = sql.lastIndexOf(")");
  if (open < 0 || close < open) return { columns: [], withoutRowid: false, rowidAlias: -1 };
  const body = sql.slice(open + 1, close);
  const withoutRowid = /\)\s*WITHOUT\s+ROWID/i.test(sql.slice(close - 1));
  const defs: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`" || ch === "[") {
      quote = ch === "[" ? "]" : ch;
      cur += ch;
    } else if (ch === "(") {
      depth++;
      cur += ch;
    } else if (ch === ")") {
      depth--;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      defs.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) defs.push(cur.trim());

  const columns: string[] = [];
  let rowidAlias = -1;
  for (const def of defs) {
    if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.test(def)) continue;
    const m = def.match(/^(?:"((?:[^"]|"")*)"|`([^`]*)`|\[([^\]]*)\]|'((?:[^']|'')*)'|(\S+))/);
    if (!m) continue;
    const name = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]).replace(/""/g, '"').replace(/''/g, "'");
    // `x INTEGER [NOT NULL] PRIMARY KEY` es un alias del rowid (salvo DESC).
    if (/^\s*INTEGER\b(?![^,]*\bDESC\b)[^,]*\bPRIMARY\s+KEY\b/i.test(def.slice(m[0].length))) {
      rowidAlias = columns.length;
    }
    columns.push(name);
  }
  return { columns, withoutRowid, rowidAlias };
}

/** Todas las tablas de usuario de un fichero SQLite. */
export function readSqlite(bytes: Uint8Array, maxRows?: number): SqliteTable[] {
  const reader = new SqliteReader(bytes);
  return reader
    .tables()
    .filter((t) => !t.withoutRowid)
    .map((t) => reader.readTable(t.name, maxRows));
}
