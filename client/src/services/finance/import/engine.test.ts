import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { loadDb } from "@/services/localDb";
import { call, expectStatus, makeAccount, makeTx } from "@/test/helpers";
import { bankStatementXlsx, buildCashewDb, sqliteAvailable } from "@/test/cashew-fixture";
import { accountBalances } from "../calc";
import { parseCsv } from "../io";
import { gridToTable } from "./engine";
import { findProfile, loadProfiles, profileMapping, saveProfile } from "./profiles";
import { importReportCsv } from "./report";
import { parseDelimited, readImportFile } from "./sources";
import type { PreviewRow, SmartImportInput, SmartImportResult, SmartPreview, TableSource } from "./types";

const csv = (text: string): TableSource => {
  const { rows, notes } = parseDelimited(text);
  return gridToTable(rows, "csv", undefined, notes);
};
const preview = (input: SmartImportInput): Promise<SmartPreview> => call("POST", "/finance/import/smart/preview", input);
const apply = (input: SmartImportInput): Promise<SmartImportResult> => call("POST", "/finance/import/smart", input);
const row = (p: SmartPreview, n: number) => p.rows.find((r) => r.row === n)!;
const messages = (r: PreviewRow) => r.issues.map((i) => `${i.severity}:${i.field}:${i.message}`).join(" | ");

describe("formatos de fecha e importe", () => {
  it("una misma columna con fechas y formatos de importe distintos se importa entera", async () => {
    const bank = await makeAccount({ name: "Banco" });
    const source = csv(
      [
        "Fecha;Importe;Concepto;Cuenta",
        "2026-09-01;1.234,56;ISO;Banco",
        "02/09/2026;-45,00;DD/MM;Banco",
        "2026-09-03 18:22:10;$ 2.000;Con hora;Banco",
        "2026-09-04T08:00:00.123;COP 5.000,5;Milisegundos;Banco",
        `${Math.floor(new Date(2026, 8, 5, 12).getTime() / 1000)};(300,00);Unix;Banco`,
        "6 sep 2026;+10;Mes con nombre;Banco",
        "07/09/26;20-;Año corto;Banco",
      ].join("\n")
    );
    // «02/09/2026» y «07/09/26» no deciden el orden: el usuario lo confirma (DD/MM).
    const first = await preview({ source });
    expect(first.confirmations.map((c) => c.key)).toEqual(["dateOrder"]);
    await expectStatus(400, apply({ source }));
    const options = { dateOrder: "dmy" as const };
    const p = await preview({ source, options });
    expect(p.confirmations).toEqual([]);
    expect(p.totals).toMatchObject({ total: 7, errors: 0, toImport: 7 });
    expect(p.detected.decimal).toBe(",");
    const got = p.rows.map((r) => [r.date, r.kind, r.amount]);
    expect(got).toEqual([
      ["2026-09-01", "income", 123456],
      ["2026-09-02", "expense", 4500],
      ["2026-09-03", "income", 200000],
      ["2026-09-04", "income", 500050],
      ["2026-09-05", "expense", 30000],
      ["2026-09-06", "income", 1000],
      ["2026-09-07", "expense", 2000],
    ]);
    expect(messages(row(p, 8))).toMatch(/2 cifras/); // el año corto se avisa como autocorrección
    expect(row(p, 8).status).toBe("fixed");

    const res = await apply({ source, options });
    expect(res.imported).toBe(7);
    expect(accountBalances(loadDb()).get(bank.id)).toBe(123456 - 4500 + 200000 + 500050 - 30000 + 1000 - 2000);
  });

  it("orden MM/DD detectado por la columna y decimales con punto", async () => {
    await makeAccount({ name: "Wallet" });
    const source = csv("date,amount,description,account\n09/25/2026,-1234.5,Coffee,Wallet\n09/03/2026,\"1,000.25\",Refund,Wallet\n");
    const p = await preview({ source });
    expect(p.detected.dateOrder).toBe("mdy");
    expect(p.rows.map((r) => [r.date, r.amount, r.concept])).toEqual([
      ["2026-09-25", 123450, "Coffee"],
      ["2026-09-03", 100025, "Refund"],
    ]);
  });

  it("fechas ambiguas: se pide confirmación y no se importa sin ella", async () => {
    await makeAccount({ name: "Banco" });
    const source = csv("fecha,importe,concepto,cuenta\n03/04/2026,10,a,Banco\n05/06/2026,10,b,Banco\n");
    const p = await preview({ source });
    expect(p.confirmations).toEqual([expect.objectContaining({ key: "dateOrder", message: expect.stringMatching(/03\/04\/2026/) })]);
    expect(await expectStatus(400, apply({ source }))).toMatch(/Falta tu confirmación/);
    // Confirmar la propuesta (DD/MM) o elegir el orden resuelve la duda.
    const ok = await preview({ source, options: { confirmed: ["dateOrder"] } });
    expect(ok.confirmations).toEqual([]);
    expect(ok.rows[0].date).toBe("2026-04-03");
    const mdy = await preview({ source, options: { dateOrder: "mdy" } });
    expect(mdy.rows[0].date).toBe("2026-03-04");
    expect((await apply({ source, options: { dateOrder: "mdy" } })).imported).toBe(2);
  });

  it("columnas de débito y crédito, y tipos en inglés", async () => {
    await makeAccount({ name: "Checking" });
    const p = await preview({ source: csv("Date,Payee,Debit,Credit,Account\n2026-09-01,Rent,1200,,Checking\n2026-09-02,Salary,,3000,Checking\n") });
    expect(p.mapping).toEqual(["date", "concept", "debit", "credit", "account"]);
    expect(p.rows.map((r) => [r.kind, r.amount])).toEqual([
      ["expense", 120000],
      ["income", 300000],
    ]);
    const typed = await preview({ source: csv("Date,Type,Amount,Memo,Account\n2026-09-01,withdrawal,50,ATM,Checking\n2026-09-02,Transfer,20,x,Checking\n") });
    expect(typed.rows[0].kind).toBe("expense");
    expect(messages(typed.rows[1])).toMatch(/destino/); // transferencia sin destino: error claro
  });
});

describe("validación fila a fila", () => {
  it("un archivo con errores parciales importa solo lo válido y no toca lo demás", async () => {
    await makeAccount({ name: "Banco" });
    const before = loadDb().finTransactions.length;
    const source = csv(
      [
        "fecha,importe,concepto,cuenta",
        "2026-09-01,10,Bien,Banco",
        "2026-13-01,10,Mes imposible,Banco",
        "2026-09-02,abc,Importe roto,Banco",
        ",15,Sin fecha,Banco",
        "2026-09-03,0,Cero,Banco",
        "2026-09-04,25,Bien 2,Banco",
      ].join("\n")
    );
    const p = await preview({ source });
    expect(p.totals).toMatchObject({ total: 6, errors: 4, toImport: 2 });
    const report = p.rows.filter((r) => r.status === "error").map((r) => [r.row, r.issues.find((i) => i.severity === "error")!.field]);
    expect(report).toEqual([
      [3, "date"],
      [4, "amount"],
      [5, "date"],
      [6, "amount"],
    ]);
    // Cada error dice fila, campo, valor original y qué hacer.
    const bad = row(p, 4).issues.find((i) => i.severity === "error")!;
    expect(bad).toMatchObject({ row: 4, field: "amount", original: "abc" });
    expect(bad.suggestion).toBeTruthy();
    // Una fila con error no se puede marcar para importar.
    expect(row(p, 3).canInclude).toBe(false);

    const res = await apply({ source, decisions: { "3": "include" } });
    expect(res.imported).toBe(2);
    expect(loadDb().finTransactions.length).toBe(before + 2);
  });

  it("datos vacíos: concepto y cuenta se completan, y se informa", async () => {
    const acc = await makeAccount({ name: "Efectivo" });
    const p = await preview({
      source: csv("fecha,importe,concepto,cuenta,categoria\n2026-09-01,-10,,Efectivo,Comida\n2026-09-02,-20,,,\n"),
      options: { defaultAccountId: acc.id },
    });
    expect(row(p, 2)).toMatchObject({ status: "fixed", concept: "Comida" });
    expect(row(p, 3)).toMatchObject({ status: "fixed", concept: "Movimiento importado", account: "Efectivo" });
    expect(messages(row(p, 3))).toMatch(/cuenta por defecto/);
  });

  it("sin columna de cuenta ni cuenta por defecto: error claro de archivo", async () => {
    const p = await preview({ source: csv("fecha,importe,concepto\n2026-09-01,10,x\n") });
    expect(p.fileIssues.find((i) => i.field === "account")?.suggestion).toMatch(/cuenta por defecto/);
    expect(p.totals.toImport).toBe(0);
    await expectStatus(400, apply({ source: csv("fecha,importe,concepto\n2026-09-01,10,x\n") }));
  });

  it("moneda distinta a la de la cuenta: error, nunca conversión silenciosa", async () => {
    await makeAccount({ name: "Banco", currency: "COP" });
    const p = await preview({ source: csv("fecha,importe,moneda,concepto,cuenta\n2026-09-01,10,USD,x,Banco\n2026-09-01,10,cop,y,Banco\n") });
    expect(row(p, 2).status).toBe("error");
    expect(messages(row(p, 2))).toMatch(/USD.*COP/);
    expect(row(p, 3).status).toBe("valid");
  });

  it("el usuario corrige a mano una fila con error y pasa a importarse", async () => {
    await makeAccount({ name: "Banco" });
    const source = csv("fecha,importe,concepto,cuenta\n31/02/2026,10,Mal,Banco\n2026-09-01,xx,Mal 2,Banco\n");
    expect((await preview({ source })).totals.errors).toBe(2);
    const edits = { "2": { date: "2026-02-28" }, "3": { amount: "12,5", concept: "Bien" } };
    const p = await preview({ source, edits });
    expect(p.totals).toMatchObject({ errors: 0, toImport: 2 });
    expect(row(p, 3)).toMatchObject({ amount: 1250, concept: "Bien" });
    await apply({ source, edits });
    expect(loadDb().finTransactions.map((t) => t.concept).sort()).toEqual(["Bien", "Mal"]);
  });

  it("excluir filas e importar solo las elegidas", async () => {
    await makeAccount({ name: "Banco" });
    const source = csv("fecha,importe,concepto,cuenta\n2026-09-01,10,a,Banco\n2026-09-02,10,b,Banco\n2026-09-03,10,c,Banco\n");
    const p = await preview({ source, decisions: { "3": "exclude" } });
    expect(row(p, 3)).toMatchObject({ status: "excluded", included: false, canInclude: true });
    expect(p.totals.toImport).toBe(2);
    const res = await apply({ source, decisions: { "3": "exclude" } });
    expect(res.imported).toBe(2);
    expect(loadDb().finTransactions.some((t) => t.concept === "b")).toBe(false);
  });
});

describe("categorías y cuentas desconocidas", () => {
  it("se crean las que faltan (con id determinista) o quedan sin categoría si se desactiva", async () => {
    await makeAccount({ name: "Banco" });
    const source = csv("fecha,importe,concepto,cuenta,categoria\n2026-09-01,-10,a,Banco,Mascotas\n2026-09-02,50,b,Banco,Mascotas\n2026-09-03,-5,c,Banco,Alimentación\n");
    const off = await preview({ source, options: { createCategories: false } });
    expect(off.totals).toMatchObject({ errors: 0, warnings: 2, toImport: 3 });
    expect(messages(row(off, 2))).toMatch(/no existe/);

    const on = await preview({ source });
    expect(on.newCategories).toEqual([{ name: "Mascotas", kind: "both" }]); // usada en ingreso y gasto
    await apply({ source });
    const cat = loadDb().finCategories.find((c) => c.name === "Mascotas")!;
    expect(cat.id).toMatch(/^imp-cat-/);
    expect(loadDb().finTransactions.find((t) => t.concept === "a")!.categoryId).toBe(cat.id);
    expect(loadDb().finTransactions.find((t) => t.concept === "c")!.categoryId).toBe("fincat-food"); // sin tildes ni mayúsculas
  });

  it("una categoría existente del tipo contrario no se reutiliza: se crea una variante", async () => {
    await makeAccount({ name: "Banco" });
    const p = await preview({ source: csv("fecha,importe,concepto,cuenta,categoria\n2026-09-01,100,x,Banco,Alimentación\n") });
    expect(p.newCategories).toEqual([{ name: "Alimentación (ingreso)", kind: "income" }]);
  });

  it("cuentas nuevas: se crean en la moneda del archivo; si se desactiva, error con solución", async () => {
    const source = csv("fecha,importe,moneda,concepto,cuenta\n2026-09-01,10,EUR,x,Revolut\n");
    const p = await preview({ source });
    expect(p.newAccounts).toEqual([{ name: "Revolut", currency: "EUR" }]);
    const off = await preview({ source, options: { createAccounts: false } });
    expect(off.rows[0]).toMatchObject({ status: "excluded", canInclude: false });
    expect(off.rows[0].issues.find((i) => i.field === "account")?.suggestion).toMatch(/Cuentas del archivo/);
    expect(off.unresolved.accounts).toEqual([{ key: "revolut", name: "Revolut", rows: 1, currency: "EUR", choice: "exclude" }]);
  });
});

describe("duplicados e integridad", () => {
  it("reimportar el mismo archivo no duplica, ni siquiera forzándolo", async () => {
    await makeAccount({ name: "Banco" });
    const source = csv("fecha,importe,concepto,cuenta\n2026-09-01,10,a,Banco\n2026-09-01,10,a,Banco\n");
    const first = await apply({ source });
    expect(first.imported).toBe(2); // dos cafés iguales el mismo día son dos movimientos
    const again = await preview({ source, decisions: { "2": "include", "3": "include" } });
    expect(again.totals).toMatchObject({ duplicates: 2, toImport: 0 });
    expect(again.rows.every((r) => r.duplicate === "id" && !r.canInclude)).toBe(true);
    await expectStatus(400, apply({ source, decisions: { "2": "include" } }));
    expect(loadDb().finTransactions).toHaveLength(2);
  });

  it("los ids coinciden con los del importador CSV clásico", async () => {
    await makeAccount({ name: "Banco" });
    const text = "fecha,importe,concepto,cuenta\n2026-09-01,-10,a,Banco\n";
    await call("POST", "/finance/import/csv", { text });
    const p = await preview({ source: csv(text) });
    expect(p.rows[0].duplicate).toBe("id");
  });

  it("posible duplicado de un movimiento anotado a mano: se omite salvo que el usuario lo marque", async () => {
    const bank = await makeAccount({ name: "Banco" });
    await makeTx({ accountId: bank.id, amount: 4500, date: "2026-09-10", concept: "Mercado" });
    const source = csv("fecha,importe,concepto,cuenta\n2026-09-10,-45,Compra súper,Banco\n2026-09-10,-45,Otra compra,Banco\n");
    const p = await preview({ source });
    // Uno solo casa con el movimiento existente; el segundo es distinto.
    expect(p.rows.map((r) => r.duplicate)).toEqual(["fingerprint", null]);
    expect(row(p, 2)).toMatchObject({ status: "duplicate", included: false, canInclude: true });
    const forced = await apply({ source, decisions: { "2": "include" } });
    expect(forced.imported).toBe(2);
  });

  it("lo importado y luego borrado no vuelve solo", async () => {
    await makeAccount({ name: "Banco" });
    const source = csv("fecha,importe,concepto,cuenta\n2026-09-01,10,a,Banco\n");
    await apply({ source });
    await call("DELETE", `/finance/transactions/${loadDb().finTransactions[0].id}`);
    const p = await preview({ source });
    expect(p.rows[0]).toMatchObject({ duplicate: "deleted", included: false, canInclude: true });
  });

  it("ids externos cortos no chocan entre archivos de origen distinto", async () => {
    await makeAccount({ name: "Banco" });
    await apply({ source: csv("id,fecha,importe,concepto,cuenta\n1,2026-09-01,10,a,Banco\n") });
    const other = await preview({ source: csv("ID,Fecha,Monto,Detalle,Cuenta,Categoría\n1,2026-09-02,20,b,Banco,\n") });
    expect(other.rows[0].duplicate).toBeNull();
  });
});

describe("tablas de origen diverso", () => {
  it("Excel: título previo, fechas con formato, débito/crédito y fila de totales", async () => {
    const acc = await makeAccount({ name: "Banco" });
    const file = await readImportFile("extracto.xlsx", await bankStatementXlsx());
    if (file.kind !== "tables") throw new Error("se esperaba tabla");
    expect(file.tables).toHaveLength(1); // la hoja vacía se descarta
    const source = file.tables[0];
    expect(source.firstRow).toBe(4);
    const p = await preview({ source, options: { defaultAccountId: acc.id } });
    expect(p.mapping).toEqual(["date", "concept", "debit", "credit", null]);
    expect(p.rows.map((r) => [r.row, r.status, r.date, r.kind, r.amount])).toEqual([
      [4, "valid", "2026-09-26", "expense", 4500050],
      [5, "valid", "2026-09-27", "income", 250000000],
      [6, "valid", "2026-09-27", "expense", 350000],
      [7, "excluded", null, "income", 250000000 - 4850050], // «Total»: se omite sola
      [8, "error", null, null, null],
    ]);
    expect(messages(row(p, 7))).toMatch(/totales/);
  });

  it("archivo sin cabecera: columnas reconocidas por su contenido", async () => {
    await makeAccount({ name: "Banco" });
    const p = await preview({ source: csv("2026-09-01;Panadería;-2,50;Banco\n2026-09-02;Nómina;1500;Banco\n") });
    expect(p.fileIssues.some((i) => /sin cabecera|no tiene cabecera/.test(i.message))).toBe(true);
    expect(p.mapping).toEqual(["date", "concept", "amount", "account"]);
    expect(p.totals.toImport).toBe(2);
  });

  it("JSON genérico", async () => {
    await makeAccount({ name: "Banco" });
    const file = await readImportFile("x.json", new TextEncoder().encode(JSON.stringify([{ fecha: "2026-09-01", monto: -12.5, nombre: "Café", cuenta: "Banco" }])));
    if (file.kind !== "tables") throw new Error();
    const p = await preview({ source: file.tables[0] });
    expect(p.rows[0]).toMatchObject({ date: "2026-09-01", kind: "expense", amount: 1250, concept: "Café" });
  });
});

describe("perfiles de columnas", () => {
  it("se guardan, se reconocen por las cabeceras y reproducen la asignación", async () => {
    const headers = ["F. Operación", "Importe (€)", "Texto", "Cta"];
    const mapping = ["date", "amount", "concept", "account"] as const;
    saveProfile("Mi banco", headers, [...mapping], { decimal: ",", createCategories: false });
    expect(loadProfiles()).toHaveLength(1);
    const p = findProfile(["cta", "texto", "f operacion", "importe"])!; // orden y signos distintos
    expect(p.name).toBe("Mi banco");
    expect(profileMapping(p, headers)).toEqual(mapping);
    expect(p.options).toMatchObject({ decimal: ",", createCategories: false });
    expect(findProfile(["otra", "cosa"])).toBeNull();
    // Guardar con las mismas cabeceras sustituye, no duplica.
    saveProfile("Mi banco v2", headers, [...mapping], {});
    expect(loadProfiles().map((x) => x.name)).toEqual(["Mi banco v2"]);
  });

  it("almacenamiento corrupto o manipulado no rompe nada", () => {
    localStorage.setItem("gestion-tareas:import-profiles", '[{"id":1},{"__proto__":{}}, "x"]');
    expect(loadProfiles()).toEqual([]);
    localStorage.setItem("gestion-tareas:import-profiles", "no es json");
    expect(loadProfiles()).toEqual([]);
  });
});

describe("informe", () => {
  it("una línea por incidencia con fila, campo, valor original y solución", async () => {
    await makeAccount({ name: "Banco" });
    const p = await preview({ source: csv("fecha,importe,concepto,cuenta\n2026-09-01,=1+1,x,Banco\n") });
    const lines = parseCsv(importReportCsv(p).replace(/^﻿/, ""));
    expect(lines[0]).toEqual(["fila", "estado", "se_importa", "campo", "gravedad", "valor_original", "problema", "solucion_sugerida", "resolucion"]);
    const err = lines.find((l) => l[4] === "Error crítico")!;
    expect(err.slice(0, 6)).toEqual(["2", "Error", "no", "Importe (con signo)", "Error crítico", "'=1+1"]); // fórmula neutralizada
    expect(err[7]).toMatch(/1234/);
    expect(err[8]).toBe("Pendiente");
  });
});

describe.skipIf(!sqliteAvailable())("Cashew", () => {
  it("copia SQLite: transferencias, correcciones, subcategorías, pendientes y criptomonedas", async () => {
    const file = await readImportFile("cashew.sql", buildCashewDb());
    if (file.kind !== "cashew") throw new Error("se esperaba Cashew");
    const source = file.source;
    const p = await preview({ source });
    const by = (pk: string) => p.rows.find((r) => r.issues.length >= 0 && r.row === Number(pk.slice(1)))!;

    expect(by("t1")).toMatchObject({ kind: "adjustment", amount: 13140000, status: "valid" });
    expect(by("t2")).toMatchObject({ kind: "income", concept: "Salario Almacén", status: "fixed" }); // subcategoría como concepto
    expect(by("t4")).toMatchObject({ kind: "transfer", amount: 4000000, account: "Billetera Principal", toAccount: "Nequi" });
    expect(by("t5").status).toBe("merged");
    expect(messages(by("t6"))).toMatch(/sin su contrapartida/);
    expect(by("t6")).toMatchObject({ kind: "adjustment", amount: -100000, status: "warning", included: true });
    expect(by("t7")).toMatchObject({ status: "excluded", canInclude: true });
    expect(messages(by("t8"))).toMatch(/USDT/);
    expect(by("t8").status).toBe("error");
    expect(messages(by("t9"))).toMatch(/se queda en 0/);
    expect(p.newCategories).toEqual(
      expect.arrayContaining([
        { name: "Regalos", kind: "both" },
        { name: "Comida", kind: "expense" },
      ])
    );
    expect(p.newAccounts.map((a) => a.name).sort()).toEqual(["Billetera Principal", "Nequi"]); // la de BTC no la usa ninguna fila válida
    expect(p.totals).toMatchObject({ total: 12, merged: 1, errors: 2, excluded: 1, toImport: 8 });

    const res = await apply({ source });
    expect(res.imported).toBe(8);
    const db = loadDb();
    const principal = db.finAccounts.find((a) => a.name === "Billetera Principal")!;
    const nequi = db.finAccounts.find((a) => a.name === "Nequi")!;
    expect(principal).toMatchObject({ id: "cashew-w-0", currency: "COP", type: "wallet" });
    // Saldos iguales a la suma de Cashew (sin la pendiente ni las cripto).
    const bal = accountBalances(db);
    expect(bal.get(principal.id)).toBe((131400 + 68000 - 5000 - 40000 + 10000 - 3000 + 2000) * 100);
    expect(bal.get(nequi.id)).toBe((40000 - 1000) * 100);
    const t12 = db.finTransactions.find((t) => t.id === "cashew-t12")!;
    expect(t12.description).toMatch(/Objetivo en Cashew: Patineta Eléctrica/);
    expect(db.finTransactions.find((t) => t.id === "cashew-t3")!.description).toHaveLength(2000);

    // Idempotente: una segunda importación no añade nada.
    const again = await preview({ source });
    expect(again.totals).toMatchObject({ toImport: 0, duplicates: 8 });

    // Incluir la pendiente después, a propósito.
    const pending = await apply({ source, decisions: { "7": "include" } });
    expect(pending.imported).toBe(1);
  });

  it("si el usuario crea a mano la cuenta de una moneda no ISO, sus filas pasan a importarse", async () => {
    const file = await readImportFile("cashew.sql", buildCashewDb());
    if (file.kind !== "cashew") throw new Error();
    await makeAccount({ name: "BNC - USDT", currency: "USD" });
    const p = await preview({ source: file.source });
    expect(p.rows.find((r) => r.row === 8)).toMatchObject({ status: "valid", amount: 500, account: "BNC - USDT" });
  });

  it("CSV de Cashew en español reenvuelto por Excel: perfil predefinido y transferencias reconstruidas", async () => {
    const lines = [
      "concepto,importe,importe sin pagar,concurrencia,titulo,nota,fecha,ingreso,tipo,categoria,subcategoria,color,icono,emoji,cuenta,objectivo,extra;",
      "Billetera de Campeones,20000,,COP,,,2026-09-26 23:34:31.000,true,default,Ingresos,Ahorros,0XFF66BB6A,increase,,,Intercomunicador,repeat every 1 month;",
      '"Billetera Secundaria,20000,,COP,,""Saldo total actualizado";',
      '"Billetera Secundaria: 0 $"",2026-09-26 23:32:31.000,true,default,Corrección de Balance,,0XFF607D8B,charts,,,,repeat every 1 month";',
      "Billetera Principal,-5000,,COP,Mast,,2026-09-18 11:47:16.000,false,default,Gastos,,0XFFEF5350,decrease,,,,repeat every 1 month;",
      "Billetera Principal,-40000,,COP,Ahorros Transferir de,,2026-09-10 10:00:00.000,false,default,Corrección de Balance,,0XFF607D8B,charts,,,,;",
      "Billetera Secundaria,40000,,COP,Ahorros Transferir a,,2026-09-10 10:00:02.000,true,default,Corrección de Balance,,0XFF607D8B,charts,,,,;",
      'Billetera Principal,93000,,COP,He ganado dinero pero no lo he contabilizado;" sin embargo conté los gastos,""Saldo total actualizado"',
      '"Billetera Principal: $0"",2026-09-11 19:34:31.000,true,default,Corrección de Balance,,0XFF607D8B,charts,,,,repeat every 1 month";',
    ];
    const file = await readImportFile("cashew.csv", new TextEncoder().encode(lines.join("\r\n")));
    if (file.kind !== "tables") throw new Error();
    const p = await preview({ source: file.tables[0] });
    expect(p.preset).toBe("Cashew (CSV en español)");
    expect(p.fileIssues[0].message).toMatch(/reenvuelto/);
    expect(p.rows.map((r) => [r.row, r.kind, r.amount, r.account, r.toAccount, r.status])).toEqual([
      [2, "income", 2000000, "Billetera de Campeones", null, "fixed"],
      [3, "adjustment", 2000000, "Billetera Secundaria", null, "fixed"],
      [4, "expense", 500000, "Billetera Principal", null, "valid"],
      [5, "transfer", 4000000, "Billetera Principal", "Billetera Secundaria", "fixed"],
      [6, "transfer", 4000000, "Billetera Secundaria", null, "merged"],
      [7, "adjustment", 9300000, "Billetera Principal", null, "valid"],
    ]);
    expect(row(p, 7).concept).toBe("He ganado dinero pero no lo he contabilizado; sin embargo conté los gastos");
    expect((await apply({ source: file.tables[0] })).imported).toBe(5);
  });

  // Prueba con un archivo real, si se indica: CASHEW_FIXTURE=/ruta/cashew.sql npx vitest run
  const real = process.env.CASHEW_FIXTURE;
  it.skipIf(!real || !existsSync(real))("archivo real de Cashew (opcional)", async () => {
    const file = await readImportFile(real!, new Uint8Array(readFileSync(real!)));
    if (file.kind === "native") throw new Error();
    const source = file.kind === "cashew" ? file.source : file.tables[0];
    const p = await preview({ source });
    expect(p.totals.toImport).toBeGreaterThan(0);
    const res = await apply({ source });
    expect(res.imported).toBe(p.totals.toImport);
    expect((await preview({ source })).totals.toImport).toBe(0);
  });
});
