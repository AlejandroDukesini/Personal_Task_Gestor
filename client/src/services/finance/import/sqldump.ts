/**
 * Lectura SEGURA de volcados SQL de texto (`sqlite3 .dump`, `mysqldump`,
 * exportaciones de otras apps).
 *
 * Nunca se ejecuta el SQL. Un analizador léxico recorre el texto y solo
 * reconoce dos formas de sentencia:
 *   - `CREATE TABLE nombre (...)`, para conocer las columnas y relaciones;
 *   - `INSERT [OR ...] INTO nombre [(cols)] VALUES (...), (...)`, cuyos
 *     valores deben ser LITERALES (texto, números, NULL, TRUE/FALSE, X'..').
 * Cualquier otra cosa (DROP, UPDATE, PRAGMA, triggers, funciones) se ignora
 * y se cuenta para informar. La única «función» admitida es la que emite
 * `sqlite3 .dump` para los saltos de línea: `replace('a\nb','\n',char(10))`,
 * que se resuelve sin evaluar nada.
 */

import { parseCreateTable, unquote, type SqliteTable, type SqliteValue } from "./sqlite";

export class SqlDumpError extends Error {}

/** ¿Parece un volcado SQL con datos? (solo mira el principio del texto). */
export function looksLikeSqlDump(text: string): boolean {
  const head = text.slice(0, 20_000).replace(/^﻿/, "");
  const stripped = head.replace(/--[^\n]*\n|\/\*[\s\S]*?\*\//g, "").trimStart();
  return /^(CREATE|INSERT|BEGIN|PRAGMA|SET|DROP|USE|LOCK|START)\b/i.test(stripped) && /\bINSERT\s+(OR\s+\w+\s+)?INTO\b/i.test(text);
}

type Token = { t: "str"; v: string } | { t: "num"; v: number } | { t: "id"; v: string } | { t: "p"; v: string };

/** Divide el texto en sentencias de tokens, respetando comillas y comentarios. */
function* statements(text: string, mysql: boolean): Generator<Token[]> {
  let i = 0;
  const n = text.length;
  let cur: Token[] = [];
  while (i < n) {
    const ch = text[i];
    if (ch === "-" && text[i + 1] === "-") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "#" && mysql) {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'") {
      let v = "";
      i++;
      for (;;) {
        if (i >= n) throw new SqlDumpError("Texto sin cerrar en el SQL (archivo incompleto)");
        const c = text[i];
        if (c === "'" && text[i + 1] === "'") {
          v += "'";
          i += 2;
        } else if (c === "'") {
          i++;
          break;
        } else if (c === "\\" && mysql && i + 1 < n) {
          const e = text[i + 1];
          v += e === "n" ? "\n" : e === "r" ? "\r" : e === "t" ? "\t" : e === "0" ? "" : e;
          i += 2;
        } else {
          v += c;
          i++;
        }
      }
      cur.push({ t: "str", v });
      continue;
    }
    if (ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      let j = i + 1;
      while (j < n && !(text[j] === close && text[j + 1] !== close)) j += text[j] === close ? 2 : 1;
      cur.push({ t: "id", v: unquote(text.slice(i, j + 1)) });
      i = j + 1;
      continue;
    }
    const num = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(text.slice(i, i + 64));
    if (num && (ch !== "-" && ch !== "+" ? true : cur.length && cur[cur.length - 1].t === "p")) {
      cur.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(text.slice(i, i + 256));
    if (word) {
      cur.push({ t: "id", v: word[0] });
      i += word[0].length;
      continue;
    }
    if (ch === ";") {
      if (cur.length) yield cur;
      cur = [];
      i++;
      continue;
    }
    cur.push({ t: "p", v: ch });
    i++;
  }
  if (cur.length) yield cur;
}

const kw = (tok: Token | undefined, word: string) => tok?.t === "id" && tok.v.toUpperCase() === word;

/** Nombre posiblemente cualificado (`main.tabla` o `db`.`tabla`): se queda la última parte. */
function readName(toks: Token[], at: number): [string, number] {
  let name = String(toks[at]?.v ?? "");
  let p = at + 1;
  while (toks[p]?.t === "p" && toks[p].v === "." && toks[p + 1]) {
    name = String(toks[p + 1].v);
    p += 2;
  }
  return [name, p];
}

/** Reconstruye el texto de un CREATE TABLE a partir de sus tokens, para `parseCreateTable`. */
function tokensToSql(toks: Token[]): string {
  return toks
    .map((t) => (t.t === "str" ? `'${t.v.replace(/'/g, "''")}'` : t.t === "id" ? (/^[\w$]+$/.test(t.v) ? t.v : `"${t.v.replace(/"/g, '""')}"`) : String(t.v)))
    .join(" ");
}

/** Valor literal en la posición `p`; devuelve [valor, siguiente posición] o null si no es literal. */
function literal(toks: Token[], p: number): [SqliteValue, number] | null {
  const t = toks[p];
  if (!t) return null;
  if (t.t === "str" || t.t === "num") return [t.v, p + 1];
  if (t.t === "p" && (t.v === "-" || t.v === "+") && toks[p + 1]?.t === "num") return [(t.v === "-" ? -1 : 1) * (toks[p + 1].v as number), p + 2];
  if (t.t === "id") {
    const u = t.v.toUpperCase();
    if (u === "NULL") return [null, p + 1];
    if (u === "TRUE") return [1, p + 1];
    if (u === "FALSE") return [0, p + 1];
    // X'0A1B': BLOB, sin utilidad para importar.
    if ((u === "X" || u === "B") && toks[p + 1]?.t === "str") return [null, p + 2];
    // replace('a\nb','\n',char(10)) de sqlite3 .dump
    if (u === "REPLACE" && toks[p + 1]?.v === "(") {
      const a = literal(toks, p + 2);
      if (a && toks[a[1]]?.v === ",") {
        const b = literal(toks, a[1] + 1);
        if (b && toks[b[1]]?.v === "," && kw(toks[b[1] + 1], "CHAR") && toks[b[1] + 2]?.v === "(" && toks[b[1] + 3]?.t === "num" && toks[b[1] + 4]?.v === ")" && toks[b[1] + 5]?.v === ")") {
          const code = toks[b[1] + 3].v as number;
          if (typeof a[0] === "string" && typeof b[0] === "string" && code > 0 && code < 0x110000) {
            return [a[0].split(b[0]).join(String.fromCodePoint(code)), b[1] + 6];
          }
        }
      }
    }
  }
  return null;
}

export interface SqlDumpResult {
  tables: SqliteTable[];
  /** Sentencias que no son CREATE TABLE ni INSERT (ignoradas, nunca ejecutadas). */
  ignored: number;
  /** Filas descartadas porque contenían expresiones en vez de valores. */
  skippedRows: number;
}

export function readSqlDump(text: string, maxRows = 200_000): SqlDumpResult {
  const mysql = /`|ENGINE\s*=|\\'/.test(text.slice(0, 50_000));
  const tables = new Map<string, SqliteTable>();
  const key = (name: string) => name.toLowerCase();
  let ignored = 0;
  let skippedRows = 0;
  let total = 0;

  for (const st of statements(text.replace(/^﻿/, ""), mysql)) {
    if (kw(st[0], "CREATE") && st.some((t, i) => i < 6 && kw(t, "TABLE"))) {
      const at = st.findIndex((t) => kw(t, "TABLE")) + 1;
      let p = at;
      if (kw(st[p], "IF") && kw(st[p + 1], "NOT") && kw(st[p + 2], "EXISTS")) p += 3;
      const [name] = readName(st, p);
      const def = parseCreateTable(tokensToSql(st));
      const prev = tables.get(key(name));
      tables.set(key(name), { name, columns: def.columns, rows: prev?.rows ?? [], foreignKeys: def.foreignKeys });
      continue;
    }
    let p = 0;
    if (kw(st[0], "INSERT") || kw(st[0], "REPLACE")) {
      p = 1;
      if (kw(st[p], "OR")) p += 2;
      if (kw(st[p], "IGNORE")) p++;
      if (!kw(st[p], "INTO")) {
        ignored++;
        continue;
      }
      const [name, afterName] = readName(st, p + 1);
      p = afterName;
      let cols: string[] | null = null;
      if (st[p]?.v === "(") {
        cols = [];
        p++;
        while (st[p] && st[p].v !== ")") {
          if (st[p].t === "id") cols.push(String(st[p].v));
          p++;
        }
        p++;
      }
      if (!kw(st[p], "VALUES")) {
        ignored++; // INSERT ... SELECT: requeriría ejecutar una consulta
        continue;
      }
      p++;
      let table = tables.get(key(name));
      if (!table) {
        table = { name, columns: cols ?? [], rows: [] };
        tables.set(key(name), table);
      }
      const order = cols ? cols.map((c) => table!.columns.findIndex((x) => x.toLowerCase() === c.toLowerCase())) : null;
      if (cols && order!.some((i) => i < 0)) {
        for (const c of cols) if (!table.columns.some((x) => x.toLowerCase() === c.toLowerCase())) table.columns.push(c);
      }
      while (st[p]?.v === "(") {
        p++;
        const values: SqliteValue[] = [];
        let ok = true;
        while (st[p] && st[p].v !== ")") {
          const lit = literal(st, p);
          if (!lit) {
            ok = false;
            // Se salta la expresión no admitida hasta el cierre de este grupo.
            let depth = 0;
            while (st[p] && !(depth === 0 && (st[p].v === "," || st[p].v === ")"))) {
              if (st[p].v === "(") depth++;
              if (st[p].v === ")") depth--;
              p++;
            }
          } else {
            values.push(lit[0]);
            p = lit[1];
          }
          if (st[p]?.v === ",") p++;
        }
        p++; // ")"
        if (st[p]?.v === ",") p++;
        if (!ok) {
          skippedRows++;
          continue;
        }
        const width = Math.max(table.columns.length, values.length);
        while (table.columns.length < width) table.columns.push(`columna${table.columns.length + 1}`);
        const row: SqliteValue[] = new Array(table.columns.length).fill(null);
        if (cols) {
          cols.forEach((c, i) => {
            const idx = table!.columns.findIndex((x) => x.toLowerCase() === c.toLowerCase());
            row[idx] = values[i] ?? null;
          });
        } else values.forEach((v, i) => (row[i] = v));
        table.rows.push(row);
        if (++total > maxRows) throw new SqlDumpError(`El volcado SQL supera ${maxRows} filas`);
      }
      continue;
    }
    ignored++;
  }
  return { tables: [...tables.values()], ignored, skippedRows };
}
