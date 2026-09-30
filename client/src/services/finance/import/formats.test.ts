import { describe, expect, it } from "vitest";
import { buildCashewDb, buildCfb, buildSqlite, buildXls, sqliteAvailable } from "@/test/cashew-fixture";
import { readXls } from "./xls";
import { readSqlDump } from "./sqldump";
import { ImportFileError, listReaders, looksBinary, readImportFile, registerReader, withRelations } from "./sources";

const hasSqlite = !!sqliteAvailable();
const enc = (s: string) => new TextEncoder().encode(s);

describe("lector XLS (Excel 97-2003)", () => {
  it("lee cadenas del SST partidas en CONTINUE, UTF-16, fechas, RK, MULRK, fórmulas y booleanos", () => {
    const [sheet] = readXls(buildXls());
    expect(sheet.name).toBe("Movimientos");
    expect(sheet.rows).toEqual([
      ["Fecha", "Concepto", "Importe"],
      ["2026-09-26", "Supermercado del barrio", -45000.5],
      ["2026-09-27", "Nómina €", 2500000, 1],
      [46293, "Café", true], // número sin formato de fecha: se queda como número
    ]);
  });

  it("respeta el sistema de fechas 1904 (Excel para Mac)", () => {
    expect(readXls(buildXls({ date1904: true }))[0].rows[1][0]).toBe("2026-09-26");
  });

  it("detecta libros cifrados y documentos que no son hojas de cálculo", async () => {
    expect(() => readXls(buildXls({ encrypted: true }))).toThrow(/contraseña/);
    const ooxmlEncrypted = buildCfb({ EncryptionInfo: new Uint8Array(10), EncryptedPackage: new Uint8Array(10) });
    await expect(readImportFile("secreto.xlsx", ooxmlEncrypted)).rejects.toThrow(/cifrado/);
    await expect(readImportFile("carta.doc", buildCfb({ WordDocument: new Uint8Array(10) }))).rejects.toThrow(/Word/);
  });

  it("un .xls truncado no cuelga: error claro", async () => {
    await expect(readImportFile("roto.xls", buildXls().slice(0, 1100))).rejects.toThrow(ImportFileError);
  });

  it("se importa como tabla por detección de contenido", async () => {
    const file = await readImportFile("extracto.xls", buildXls());
    if (file.kind !== "tables") throw new Error("se esperaba tabla");
    expect(file.tables[0].format).toBe("xls");
    expect(file.tables[0].headers.slice(0, 3)).toEqual(["Fecha", "Concepto", "Importe"]);
  });
});

describe("volcados SQL de texto (sin ejecutar nada)", () => {
  it("sqlite3 .dump: comillas, saltos de línea con replace(), negativos, NULL y columnas explícitas", () => {
    const dump = [
      "PRAGMA foreign_keys=OFF;",
      "BEGIN TRANSACTION;",
      'CREATE TABLE IF NOT EXISTS "movs" ("id" INTEGER PRIMARY KEY, "fecha" TEXT, "importe" REAL, "nota" TEXT);',
      "INSERT INTO movs VALUES(1,'2026-09-01',-12.5,'Pan; y ''leche''');",
      "INSERT INTO \"movs\" (\"fecha\", \"importe\", \"id\") VALUES ('2026-09-02', 1e3, 2), ('2026-09-03', +7, 3);",
      "INSERT INTO movs VALUES(4,'2026-09-04',NULL,replace('línea 1\\nlínea 2','\\n',char(10)));",
      "INSERT INTO movs VALUES(5,'2026-09-05',1,lower('X'));",
      "-- comentario; con punto y coma",
      "/* bloque; */ DROP TABLE movs;",
      "COMMIT;",
    ].join("\n");
    const r = readSqlDump(dump);
    expect(r.tables).toHaveLength(1);
    expect(r.tables[0].columns).toEqual(["id", "fecha", "importe", "nota"]);
    expect(r.tables[0].rows).toEqual([
      [1, "2026-09-01", -12.5, "Pan; y 'leche'"],
      [2, "2026-09-02", 1000, null],
      [3, "2026-09-03", 7, null],
      [4, "2026-09-04", null, "línea 1\nlínea 2"],
    ]);
    expect(r.skippedRows).toBe(1); // lower('X') es una expresión: no se evalúa
    expect(r.ignored).toBe(4); // PRAGMA, BEGIN, DROP y COMMIT: se ignoran, no se ejecutan
  });

  it("mysqldump: acentos graves, escapes con barra y tablas cualificadas", () => {
    const dump = "CREATE TABLE `db`.`gastos` (`id` int, `concepto` varchar(50), `monto` decimal(10,2)) ENGINE=InnoDB;\nINSERT INTO `db`.`gastos` VALUES (1,'Caf\\'e \\\\ bar',-3.50),(2,'Dos\\nlíneas',10);";
    const r = readSqlDump(dump);
    expect(r.tables[0].name).toBe("gastos");
    expect(r.tables[0].columns).toEqual(["id", "concepto", "monto"]);
    expect(r.tables[0].rows).toEqual([
      [1, "Caf'e \\ bar", -3.5],
      [2, "Dos\nlíneas", 10],
    ]);
  });

  it("texto sin cerrar: error de archivo incompleto", () => {
    expect(() => readSqlDump("INSERT INTO t VALUES ('sin cerrar);")).toThrow(/incompleto/);
  });

  it("un volcado de Cashew de otra versión se reconoce e informa de las columnas que faltan", async () => {
    const lines = [
      `CREATE TABLE "wallets" ("name" TEXT NOT NULL, "wallet_pk" TEXT NOT NULL, "currency" TEXT NULL, "archived" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("wallet_pk"));`,
      `CREATE TABLE "categories" ("name" TEXT NOT NULL, "category_pk" TEXT NOT NULL, "income" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("category_pk"));`,
      `CREATE TABLE "transactions" ("date_created" INTEGER NOT NULL, "name" TEXT NOT NULL, "transaction_pk" TEXT NOT NULL, "amount" REAL NOT NULL, "note" TEXT NOT NULL, "category_fk" TEXT NOT NULL, "wallet_fk" TEXT NOT NULL DEFAULT '0', "income" INTEGER NOT NULL DEFAULT 0, "paid" INTEGER NOT NULL DEFAULT 0);`,
      `INSERT INTO wallets VALUES('Principal','0','cop',0);`,
      `INSERT INTO categories VALUES('Comida','c1',0);`,
      `INSERT INTO transactions VALUES(1790000000,'Pan','t1',-5000.0,replace('a\\nb','\\n',char(10)),'c1','0',0,1);`,
    ];
    const file = await readImportFile("cashew.sql", enc(lines.join("\n")));
    if (file.kind !== "cashew") throw new Error("se esperaba Cashew");
    expect(file.source.origin).toBe("sql");
    expect(file.label).toMatch(/volcado SQL/);
    expect(file.source.transactions[0]).toMatchObject({ amount: -5000, note: "a\nb" });
    expect(file.source.notes!.some((n) => /paired_transaction_fk/.test(n))).toBe(true);
  });
});

describe("relaciones entre tablas (ids -> nombres)", () => {
  it("claves foráneas declaradas y por convención de nombre", () => {
    const { tables, notes } = withRelations([
      { name: "categories", columns: ["id", "name"], rows: [["c1", "Comida"], ["c2", "Sueldo"]] },
      { name: "wallets", columns: ["wallet_pk", "nombre"], rows: [["w1", "Banco"]] },
      {
        name: "movimientos",
        columns: ["fecha", "importe", "category_id", "cuenta"],
        rows: [
          ["2026-09-01", -10, "c1", "w1"],
          ["2026-09-02", 20, "zz", "w1"],
        ],
        foreignKeys: [{ column: "cuenta", table: "wallets", refColumn: null }],
      },
    ]);
    const t = tables[0];
    expect(t.name).toBe("movimientos");
    expect(t.headers).toEqual(["fecha", "importe", "category_id", "cuenta", "category (nombre)", "cuenta (nombre)"]);
    expect(t.rows.map((r) => r.slice(4))).toEqual([
      ["Comida", "Banco"],
      [null, "Banco"],
    ]);
    expect(t.idColumns).toEqual(["category_id", "cuenta"]);
    expect(notes.some((n) => /1 valor\(es\) no existen/.test(n))).toBe(true);
  });

  it.skipIf(!hasSqlite)("SQLite genérica con varias tablas relacionadas", async () => {
    const file = await readImportFile(
      "finanzas.db",
      buildSqlite((db) => {
        db.exec(`CREATE TABLE cuentas (id INTEGER PRIMARY KEY, nombre TEXT);
                 CREATE TABLE categorias (id INTEGER PRIMARY KEY, nombre TEXT);
                 CREATE TABLE movimientos (id INTEGER PRIMARY KEY, fecha TEXT, importe REAL, concepto TEXT,
                   cuenta_id INTEGER REFERENCES cuentas(id), categoria_id INTEGER REFERENCES categorias(id));
                 INSERT INTO cuentas VALUES (1,'Banco'),(2,'Efectivo');
                 INSERT INTO categorias VALUES (1,'Comida'),(2,'Sueldo');
                 INSERT INTO movimientos VALUES (1,'2026-09-01',-12.5,'Pan',1,1),(2,'2026-09-02',1000,'Nómina',2,2);`);
      })
    );
    if (file.kind !== "tables") throw new Error();
    const t = file.tables[0];
    expect(t.name).toBe("movimientos");
    expect(t.headers).toEqual(["id", "fecha", "importe", "concepto", "cuenta_id", "categoria_id", "cuenta (nombre)", "categoria (nombre)"]);
    expect(t.rows[0].slice(6)).toEqual(["Banco", "Comida"]);
    expect(t.notes!.some((n) => /identificadores de «cuentas»/.test(n))).toBe(true);
  });

  it("JSON con varias listas relacionadas", async () => {
    const payload = {
      accounts: [{ id: "a1", name: "Banco" }],
      categories: [{ id: "k1", name: "Ocio" }],
      transactions: [{ date: "2026-09-01", amount: -9.99, title: "Cine", accountId: "a1", categoryId: "k1" }],
    };
    const file = await readImportFile("export.json", enc(JSON.stringify(payload)));
    if (file.kind !== "tables") throw new Error();
    const t = file.tables[0];
    expect(t.name).toBe("transactions");
    expect(t.headers).toEqual(["date", "amount", "title", "accountId", "categoryId", "account (nombre)", "category (nombre)"]);
    expect(t.rows[0].slice(5)).toEqual(["Banco", "Ocio"]);
  });
});

describe("archivos vacíos, dañados o incompatibles", () => {
  it("mensajes concretos para cada caso", async () => {
    await expect(readImportFile("vacio.csv", new Uint8Array())).rejects.toThrow(/vacío/);
    await expect(readImportFile("roto.json", enc('{"a": [1, 2'))).rejects.toThrow(/JSON está dañado/);
    await expect(readImportFile("x.bin", new Uint8Array(2000).map((_, i) => (i * 7) % 256))).rejects.toThrow(/Formato no reconocido/);
    await expect(readImportFile("banco.xls", enc("<html><table><tr><td>1</td></tr></table></html>"))).rejects.toThrow(/HTML/);
    expect(looksBinary(enc("fecha,importe\n2026-01-01,5"))).toBe(false);
  });

  it.skipIf(!hasSqlite)("SQLite truncada", async () => {
    await expect(readImportFile("cashew.sql", buildCashewDb().slice(0, 5000))).rejects.toThrow(/dañada o incompleta/);
  });

  it("avisa cuando la extensión no coincide con el contenido", async () => {
    const file = await readImportFile("movimientos.xlsx", enc("fecha;importe;concepto\n2026-09-01;10;x"));
    if (file.kind !== "tables") throw new Error();
    expect(file.tables[0].notes![0]).toMatch(/extensión \.xlsx.*CSV/);
  });

  it("TSV se detecta como tal", async () => {
    const file = await readImportFile("datos.tsv", enc("fecha\timporte\tconcepto\n2026-09-01\t10,5\tx"));
    if (file.kind !== "tables") throw new Error();
    expect(file.tables[0].format).toBe("tsv");
    expect(file.label).toMatch(/TSV/);
  });

  it("el nombre del archivo nunca se usa como ruta", async () => {
    const file = await readImportFile("../../etc/passwd.csv", enc("fecha,importe,concepto\n2026-09-01,1,x"));
    expect(file.label.startsWith("passwd.csv")).toBe(true);
  });
});

describe("lectores enchufables", () => {
  it("se puede registrar un formato nuevo sin tocar el núcleo", async () => {
    registerReader({
      id: "qif",
      label: "QIF",
      extensions: ["qif"],
      sniff: (i) => i.text().text.startsWith("!Type:"),
      read: (i) => ({
        kind: "tables",
        label: `${i.name} · QIF`,
        tables: [{ type: "table", format: "csv", headers: ["fecha", "importe", "concepto"], rows: [["2026-09-01", "-5", "Café"]], firstRow: 1 }],
      }),
    });
    expect(listReaders().map((r) => r.id).slice(-2)).toEqual(["qif", "delimited"]);
    const file = await readImportFile("banco.qif", enc("!Type:Bank\nD01/09/2026\nT-5\n^"));
    expect(file.label).toMatch(/QIF/);
  });
});
