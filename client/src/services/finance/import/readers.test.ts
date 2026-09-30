import { describe, expect, it } from "vitest";
import { EXPORT_FORMAT } from "../io";
import { bankStatementXlsx, buildCashewDb, buildSqlite, buildZip, CASHEW_TXS, sqliteAvailable } from "@/test/cashew-fixture";
import { parseCreateTable, readSqlite, SqliteError } from "./sqlite";
import { readXlsx } from "./xlsx";
import { decodeText, parseDelimited, readImportFile, ImportFileError } from "./sources";

const hasSqlite = !!sqliteAvailable();
const enc = (s: string) => new TextEncoder().encode(s);

describe.skipIf(!hasSqlite)("lector SQLite", () => {
  it("coincide con SQLite real: tipos, NULL, negativos, alias de rowid, columnas añadidas y páginas interiores", () => {
    const bytes = buildSqlite((db) => {
      db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, amount REAL, n INTEGER, big INTEGER, b BLOB);
               CREATE TABLE "raro ""x""" ([col 1] TEXT, 'col2' INT) ;
               CREATE INDEX t_name ON t(name);`);
      const ins = db.prepare("INSERT INTO t (name, amount, n, big, b) VALUES (?, ?, ?, ?, ?)");
      for (let i = 0; i < 3000; i++) ins.run(`fila ${i} ñandú €`, i / 3, -i * 1000, 2 ** 40 + i, new Uint8Array([1, 2]));
      ins.run(null, null, null, -(2 ** 50), null);
      db.exec(`ALTER TABLE t ADD COLUMN extra TEXT DEFAULT NULL`);
      db.prepare(`INSERT INTO "raro ""x""" VALUES (?, ?)`).run("a".repeat(70000), 7); // desbordamiento largo
    });
    const tables = readSqlite(bytes);
    const t = tables.find((x) => x.name === "t")!;
    expect(t.columns).toEqual(["id", "name", "amount", "n", "big", "b", "extra"]);
    expect(t.rows).toHaveLength(3001);
    expect(t.rows[0]).toEqual([1, "fila 0 ñandú €", 0, 0, 2 ** 40, null, null]);
    expect(t.rows[2999]).toEqual([3000, "fila 2999 ñandú €", 2999 / 3, -2999000, 2 ** 40 + 2999, null, null]);
    expect(t.rows[3000]).toEqual([3001, null, null, null, -(2 ** 50), null, null]);
    const raro = tables.find((x) => x.name === 'raro "x"')!;
    expect(raro.columns).toEqual(["col 1", "col2"]);
    expect((raro.rows[0][0] as string).length).toBe(70000);
    expect(raro.rows[0][1]).toBe(7);
  });

  it("lee una copia de Cashew con su esquema real", () => {
    const tables = readSqlite(buildCashewDb());
    const names = tables.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["wallets", "categories", "transactions", "objectives", "app_settings"]));
    const tx = tables.find((t) => t.name === "transactions")!;
    expect(tx.rows).toHaveLength(CASHEW_TXS.length);
    const col = (n: string) => tx.columns.indexOf(n);
    const t3 = tx.rows.find((r) => r[col("transaction_pk")] === "t3")!;
    expect(t3[col("note")]).toHaveLength(6000);
    expect(t3[col("amount")]).toBe(-5000);
    expect(tx.rows.find((r) => r[col("transaction_pk")] === "t5")![col("amount")]).toBe(39999.99999999999);
    const settings = tables.find((t) => t.name === "app_settings")!;
    expect(settings.rows[0][0]).toBe(1); // AUTOINCREMENT: alias del rowid
    expect(String(settings.rows[0][1]).length).toBeGreaterThan(20000);
  });

  it("rechaza ficheros dañados sin colgarse", () => {
    const bytes = buildCashewDb().slice();
    bytes.fill(0xff, 4096, 8192); // página 2 destrozada
    expect(() => readSqlite(bytes)).toThrow(SqliteError);
  });
});

describe("CREATE TABLE", () => {
  it("nombres entrecomillados, restricciones y alias de rowid", () => {
    expect(parseCreateTable(`CREATE TABLE x ("a b" TEXT, [c] INT, \`d\` REAL, e, PRIMARY KEY (a), CHECK (e > 0))`)).toEqual({
      columns: ["a b", "c", "d", "e"],
      withoutRowid: false,
      rowidAlias: -1,
      foreignKeys: [],
    });
    expect(
      parseCreateTable(`CREATE TABLE t (id INTEGER PRIMARY KEY, "cat_fk" TEXT REFERENCES categories (category_pk), w TEXT, CONSTRAINT x FOREIGN KEY ([w]) REFERENCES "wallets")`).foreignKeys
    ).toEqual([
      { column: "cat_fk", table: "categories", refColumn: "category_pk" },
      { column: "w", table: "wallets", refColumn: null },
    ]);
    expect(parseCreateTable(`CREATE TABLE y (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, v TEXT)`).rowidAlias).toBe(0);
    expect(parseCreateTable(`CREATE TABLE z (k TEXT PRIMARY KEY, v) WITHOUT ROWID`).withoutRowid).toBe(true);
  });
});

describe("lector XLSX", () => {
  it("cadenas compartidas y en línea, números, fechas con formato y booleanos", async () => {
    const sheets = await readXlsx(await bankStatementXlsx());
    expect(sheets.map((s) => s.name)).toEqual(["Movimientos", "Vacía"]);
    const rows = sheets[0].rows;
    expect(rows[0]).toEqual(["Extracto Banco Ejemplo"]);
    expect(rows[1]).toEqual([]); // la fila 2 de Excel no existe: se conserva el hueco
    expect(rows[2]).toEqual(["Fecha", "Descripción", "Débito", "Crédito", "Saldo"]);
    expect(rows[3]).toEqual(["2026-09-26", "Supermercado", 45000.5, null, 954999.5]);
    expect(rows[4]).toEqual(["2026-09-27 12:00:00", "Nómina", null, 2500000]);
    expect(rows[5]).toEqual(["27/09/2026", "Café & pan", "3500"]);
    expect(rows[7]).toEqual([true]);
  });

  it("un ZIP que no es un libro de Excel da un mensaje claro", async () => {
    await expect(readImportFile("hoja.ods", await buildZip({ "content.xml": "<office/>" }))).rejects.toThrow(/OpenDocument/);
    await expect(readImportFile("a.zip", await buildZip({ "hola.txt": "x" }))).rejects.toThrow(/no contiene un libro/);
  });
});

describe("detección de formato", () => {
  it("CSV reenvuelto por Excel: se reconstruye, incluido un «;» dentro de un título y notas multilínea", () => {
    const original = [
      "concepto,importe,titulo,nota,fecha",
      "Billetera,20000,Pago,,2026-09-26 10:00:00.000",
      'Billetera,-5000,Pagué; sin factura,"Saldo total actualizado',
      'Billetera: $0",2026-09-25 09:00:00.000',
    ];
    // Lo que produce Excel al abrirlo con «;» y volver a guardarlo.
    const wrapped = [
      "concepto,importe,titulo,nota,fecha;",
      "Billetera,20000,Pago,,2026-09-26 10:00:00.000;",
      'Billetera,-5000,Pagué;" sin factura,""Saldo total actualizado"',
      '"Billetera: $0"",2026-09-25 09:00:00.000";',
    ].join("\r\n");
    const { rows, notes } = parseDelimited(wrapped);
    expect(notes[0]).toMatch(/reenvuelto/);
    expect(rows).toEqual([
      ["concepto", "importe", "titulo", "nota", "fecha"],
      ["Billetera", "20000", "Pago", "", "2026-09-26 10:00:00.000"],
      ["Billetera", "-5000", "Pagué; sin factura", "Saldo total actualizado\nBilletera: $0", "2026-09-25 09:00:00.000"],
    ]);
    expect(original).toHaveLength(4);
  });

  it("separador: coma, punto y coma, tabulador, barra y directiva sep=", () => {
    expect(parseDelimited("a,b,c\n1,2,3").rows[1]).toEqual(["1", "2", "3"]);
    expect(parseDelimited("fecha;importe;concepto\n2026-01-01;1.234,5;x").rows[1]).toEqual(["2026-01-01", "1.234,5", "x"]);
    expect(parseDelimited("a\tb\n1\t2").rows[1]).toEqual(["1", "2"]);
    expect(parseDelimited("a|b|c\n1|2,5|3").rows[1]).toEqual(["1", "2,5", "3"]);
    expect(parseDelimited("sep=;\na;b\n1,5;2").rows).toEqual([["a", "b"], ["1,5", "2"]]);
  });

  it("codificaciones: UTF-8 con BOM, UTF-16 y Windows-1252", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc("Categoría")])).text).toBe("Categoría");
    const u16 = new Uint8Array([0xff, 0xfe, ...[..."Año"].flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(decodeText(u16).text).toBe("Año");
    const ansi = new Uint8Array([...enc("Caf"), 0xe9]); // «é» en Windows-1252
    const r = decodeText(ansi);
    expect(r.text).toBe("Café");
    expect(r.note).toMatch(/Windows-1252/);
  });

  it("JSON: copia propia, listas anidadas y objetos de un nivel", async () => {
    const native = await readImportFile("a.json", enc(JSON.stringify({ format: EXPORT_FORMAT, version: 1, data: {} })));
    expect(native.kind).toBe("native");
    const other = await readImportFile(
      "b.json",
      enc(JSON.stringify({ meta: { v: 2 }, result: { transactions: [{ date: "2026-09-01", amount: -12.5, payee: "Café", account: { name: "Banco" }, tags: ["a", "b"] }] } }))
    );
    expect(other.kind).toBe("tables");
    if (other.kind !== "tables") return;
    expect(other.tables[0].headers).toEqual(["date", "amount", "payee", "account.name", "tags"]);
    expect(other.tables[0].rows[0]).toEqual(["2026-09-01", -12.5, "Café", "Banco", "a|b"]);
    await expect(readImportFile("c.json", enc('{"a":1}'))).rejects.toThrow(ImportFileError);
  });

  it.skipIf(!hasSqlite)("SQLite: Cashew se reconoce; otra base ofrece sus tablas", async () => {
    const cashew = await readImportFile("cashew.sql", buildCashewDb());
    expect(cashew.kind).toBe("cashew");
    if (cashew.kind === "cashew") expect(cashew.summary).toMatch(/12 transacciones, 4 billeteras/);

    const other = await readImportFile(
      "otra.db",
      buildSqlite((db) => {
        db.exec("CREATE TABLE config (k TEXT, v TEXT); CREATE TABLE movimientos (fecha TEXT, importe REAL, concepto TEXT)");
        db.exec("INSERT INTO config VALUES ('a','b'),('c','d'),('e','f'); INSERT INTO movimientos VALUES ('2026-09-01', -10.5, 'Pan')");
      })
    );
    expect(other.kind).toBe("tables");
    if (other.kind === "tables") expect(other.tables.map((t) => t.name)).toEqual(["movimientos", "config"]);
  });

  it("un SQL sin datos o con solo sentencias peligrosas se rechaza sin ejecutarse", async () => {
    await expect(readImportFile("dump.sql", enc("DROP TABLE users; DELETE FROM x;"))).rejects.toThrow(/INSERT/);
    await expect(readImportFile("dump.sql", enc("CREATE TABLE x (a, b);\nINSERT INTO x SELECT * FROM y;"))).rejects.toThrow(/INSERT con datos/);
  });
});
