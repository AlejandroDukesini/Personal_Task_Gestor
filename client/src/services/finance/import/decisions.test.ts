import { describe, expect, it, vi } from "vitest";
import { loadDb, dropCache } from "@/services/localDb";
import { call, expectStatus, makeAccount, makeTx } from "@/test/helpers";
import { buildCashewDb, CASHEW_TXS, sqliteAvailable, T0 } from "@/test/cashew-fixture";
import { parseCsv } from "../io";
import { gridToTable } from "./engine";
import { rejectedRowsCsv } from "./report";
import { parseDelimited, readImportFile } from "./sources";
import type { SmartImportInput, SmartImportResult, SmartPreview, TableSource } from "./types";

const csv = (text: string): TableSource => gridToTable(parseDelimited(text).rows, "csv");
const preview = (input: SmartImportInput): Promise<SmartPreview> => call("POST", "/finance/import/smart/preview", input);
const apply = (input: SmartImportInput): Promise<SmartImportResult> => call("POST", "/finance/import/smart", input);

describe("confirmaciones obligatorias", () => {
  it("separador decimal ambiguo: se pregunta y la respuesta cambia la lectura", async () => {
    await makeAccount({ name: "Banco" });
    const source = csv("fecha,importe,concepto,cuenta\n2026-09-01,1.500,a,Banco\n2026-09-02,2.250,b,Banco\n");
    const p = await preview({ source });
    expect(p.confirmations.map((c) => c.key)).toEqual(["decimal"]);
    await expectStatus(400, apply({ source }));
    const comma = await preview({ source, options: { decimal: "," } });
    expect(comma.rows.map((r) => r.amount)).toEqual([150000, 225000]);
    const dot = await preview({ source, options: { decimal: "." } });
    expect(dot.rows.map((r) => r.amount)).toEqual([150, 225]);
    expect(dot.confirmations).toEqual([]);
  });

  it("moneda no indicada para cuentas nuevas: no se asume sin preguntar", async () => {
    const source = csv("fecha,importe,concepto,cuenta\n2026-09-01,10,a,Monedero\n");
    const p = await preview({ source });
    expect(p.confirmations).toEqual([expect.objectContaining({ key: "currency", message: expect.stringMatching(/Monedero/) })]);
    const eur = await preview({ source, options: { defaultCurrency: "EUR" } });
    expect(eur.confirmations).toEqual([]);
    expect(eur.newAccounts).toEqual([{ name: "Monedero", currency: "EUR" }]);
    await apply({ source, options: { confirmed: ["currency"] } });
    expect(loadDb().finAccounts.find((a) => a.name === "Monedero")!.currency).toBe(loadDb().settings.currency);
  });

  it("columnas asignadas solo por su contenido: el usuario debe revisarlas", async () => {
    await makeAccount({ name: "Banco" });
    const source = csv("2026-09-01;Panadería;-2,50;Banco\n2026-09-02;Nómina;1500;Banco\n");
    const p = await preview({ source });
    expect(p.confirmations[0]).toMatchObject({ key: "mapping" });
    expect(p.confirmations[0].message).toMatch(/Columna 1.*Fecha/);
    // Confirmar = enviar la asignación (la que se ve o una corregida).
    const ok = await preview({ source, mapping: p.mapping });
    expect(ok.confirmations).toEqual([]);
    expect(ok.mappingSource.every((s) => s !== "content")).toBe(true);
  });
});

describe("redondeo autorizado", () => {
  it("importes con más de 2 decimales no se redondean sin permiso", async () => {
    await makeAccount({ name: "Banco" });
    const source = csv("fecha,importe,concepto,cuenta\n2026-09-01,12.345,a,Banco\n2026-09-02,10.00,b,Banco\n");
    const p = await preview({ source, options: { decimal: "." } });
    expect(p.rows[0]).toMatchObject({ status: "excluded", included: false, canInclude: true, amount: 1235 });
    expect(p.rows[0].issues.find((i) => i.field === "amount")!.message).toMatch(/autorización/);
    expect(p.rows[1].included).toBe(true);
    // Autorizar: opción global o marcar la fila.
    const all = await preview({ source, options: { decimal: ".", allowRounding: true } });
    expect(all.rows[0]).toMatchObject({ status: "fixed", included: true });
    const one = await preview({ source, options: { decimal: "." }, decisions: { "2": "include" } });
    expect(one.rows[0].included).toBe(true);
  });
});

describe("cuentas y categorías desconocidas: decide el usuario", () => {
  it("asignar a una existente, crear, dejar sin categoría o excluir", async () => {
    const bank = await makeAccount({ name: "Banco" });
    const source = csv(
      "fecha,importe,concepto,cuenta,categoria\n2026-09-01,-10,a,Nequi,Mascotas\n2026-09-02,-20,b,Nequi,Juegos\n2026-09-03,-30,c,Daviplata,Mascotas\n2026-09-04,-40,d,Banco,Varios\n"
    );
    const p = await preview({ source, options: { confirmed: ["currency"] } });
    expect(p.unresolved.accounts.map((a) => [a.key, a.rows, a.choice])).toEqual([
      ["nequi", 2, "create"],
      ["daviplata", 1, "create"],
    ]);
    expect(p.unresolved.categories.map((c) => c.key)).toEqual(["mascotas", "juegos", "varios"]);

    const options = {
      confirmed: ["currency" as const],
      accountMap: { nequi: `id:${bank.id}` as const, daviplata: "exclude" as const },
      categoryMap: { mascotas: "id:fincat-food" as const, juegos: "none" as const, varios: "exclude" as const },
    };
    const d = await preview({ source, options });
    const byRow = (n: number) => d.rows.find((r) => r.row === n)!;
    expect(byRow(2)).toMatchObject({ account: "Banco", included: true });
    expect(byRow(2).issues.find((i) => i.field === "account")!.resolution).toBe("manual");
    expect(byRow(3).issues.some((i) => /queda sin categoría/.test(i.message))).toBe(true);
    expect(byRow(4)).toMatchObject({ status: "excluded", canInclude: false });
    expect(byRow(5)).toMatchObject({ status: "excluded", canInclude: false });
    expect(d.newAccounts).toEqual([]);
    const res = await apply({ source, options });
    expect(res.imported).toBe(2);
    const imported = loadDb().finTransactions;
    expect(imported.every((t) => t.accountId === bank.id)).toBe(true);
    expect(imported.find((t) => t.concept === "a")!.categoryId).toBe("fincat-food");
    expect(imported.find((t) => t.concept === "b")!.categoryId).toBeNull();
  });

  it("una columna de identificadores nunca se toma como nombre de cuenta o categoría", async () => {
    const acc = await makeAccount({ name: "Banco" });
    const source = csv(
      "fecha,importe,concepto,category_fk,wallet_fk\n2026-09-01,-10,a,3941f8aa-af4d-491b-a6e9-a9499ef0ab6a,0\n2026-09-02,-10,b,c003c101-5e3c-4bb5-bd65-fa2e0a08ecdc,0\n"
    );
    const p = await preview({ source, options: { defaultAccountId: acc.id } });
    expect(p.mapping).toEqual(["date", "amount", "concept", null, null]);
    expect(p.fileIssues.filter((i) => /identificadores/.test(i.message))).toHaveLength(2);
    expect(p.newCategories).toEqual([]);
  });
});

describe("duplicados en tres niveles", () => {
  it("exacto, posible (campos configurables) y parecido", async () => {
    const bank = await makeAccount({ name: "Banco" });
    await makeTx({ accountId: bank.id, amount: 4500, date: "2026-09-10", concept: "Mercado" });
    await makeTx({ accountId: bank.id, amount: 9900, date: "2026-09-10", concept: "Farmacia" });
    await makeTx({ accountId: bank.id, amount: 1200, date: "2026-09-08", concept: "Café" });
    const source = csv(
      [
        "fecha,importe,concepto,cuenta",
        "2026-09-10,-45,Mercado,Banco", // mismo contenido, otro id: exacto
        "2026-09-10,-99,Otra cosa,Banco", // misma fecha/cuenta/tipo/importe: posible
        "2026-09-10,-12,Café,Banco", // mismo importe dos días después: parecido (se importa)
        "2026-09-11,-1,Nuevo,Banco",
      ].join("\n")
    );
    const p = await preview({ source });
    expect(p.rows.map((r) => [r.duplicate, r.included])).toEqual([
      ["exact", false],
      ["fingerprint", false],
      [null, true],
      [null, true],
    ]);
    expect(p.rows[2].status).toBe("warning");
    expect(p.rows[2].issues.some((i) => /Parecido a un movimiento del 2026-09-08/.test(i.message))).toBe(true);

    // Con «concepto» en la huella, el segundo deja de ser posible duplicado.
    const strict = await preview({ source, options: { duplicateFields: ["date", "account", "kind", "amount", "concept"] } });
    expect(strict.rows[1].duplicate).toBeNull();
    // El usuario puede importar un duplicado dudoso marcándolo.
    const forced = await preview({ source, decisions: { "2": "include", "3": "include" } });
    expect(forced.rows.slice(0, 2).map((r) => r.included)).toEqual([true, true]);
  });
});

describe("zona horaria", () => {
  it("instantes con zona: la política decide el día", async () => {
    await makeAccount({ name: "Banco" });
    const source = csv("fecha,importe,concepto,cuenta\n2026-09-26T23:30:00-05:00,10,a,Banco\n1790465671,10,b,Banco\n");
    const utc = await preview({ source, options: { zone: "utc" } });
    expect(utc.rows.map((r) => r.date)).toEqual(["2026-09-27", new Date(1790465671 * 1000).toISOString().slice(0, 10)]);
    const local = await preview({ source, options: { zone: "local" } });
    const d = new Date("2026-09-27T04:30:00Z");
    expect(local.rows[0].date).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  });
});

describe("estado de resolución e historial de correcciones", () => {
  it("cada incidencia indica si se corrigió sola, a mano, está pendiente o se excluyó", async () => {
    await makeAccount({ name: "Banco" });
    const source = csv("fecha,importe,concepto,cuenta\n2026-09-01,10,,Banco\n2026-13-01,10,x,Banco\n2026-09-03,abc,y,Banco\n");
    const p = await preview({ source, edits: { "4": { amount: "30" } }, decisions: { "2": "exclude" } });
    const res = (n: number, field: string) => p.rows.find((r) => r.row === n)!.issues.find((i) => i.field === field)!.resolution;
    expect(res(2, "concept")).toBe("auto");
    expect(p.rows[0].status).toBe("excluded");
    expect(res(3, "date")).toBe("pending");
    expect(res(4, "amount")).toBe("manual");
    const manual = p.rows[2].issues.find((i) => i.resolution === "manual")!;
    expect(manual).toMatchObject({ original: "abc", message: "Corregido a mano: «30»" });
    expect(p.rows[2].included).toBe(true);
  });
});

describe("filas no importadas", () => {
  it("se pueden descargar con sus datos originales y el motivo", async () => {
    await makeAccount({ name: "Banco" });
    const source = csv("fecha,importe,concepto,cuenta\n2026-09-01,10,ok,Banco\n2026-09-02,abc,roto,Banco\n2026-09-03,5,fuera,Banco\n");
    const res = await apply({ source, decisions: { "4": "exclude" } });
    const lines = parseCsv(rejectedRowsCsv(res).replace(/^﻿/, ""));
    expect(lines[0]).toEqual(["fila", "estado", "motivo", "fecha", "importe", "concepto", "cuenta"]);
    expect(lines.slice(1).map((l) => [l[0], l[1], l[4], l[5]])).toEqual([
      ["3", "Error", "abc", "roto"],
      ["4", "Excluida", "5", "fuera"],
    ]);
    expect(lines[1][2]).toMatch(/Importe.*no válido/);
  });
});

describe("integridad ante fallos durante el guardado", () => {
  it("si el almacenamiento falla, no queda nada a medias ni en memoria ni en disco", async () => {
    await makeAccount({ name: "Banco" });
    const before = JSON.stringify(loadDb());
    const source = csv("fecha,importe,concepto,cuenta\n2026-09-01,10,a,Banco\n2026-09-02,20,b,Banco\n");
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    try {
      await expectStatus(507, apply({ source }));
    } finally {
      spy.mockRestore();
    }
    expect(JSON.stringify(loadDb())).toBe(before); // la memoria no se quedó con el borrador
    dropCache();
    expect(JSON.stringify(loadDb())).toBe(before); // y el disco tampoco cambió
    // Reintentar después funciona y sigue sin duplicar.
    expect((await apply({ source })).imported).toBe(2);
    expect((await preview({ source })).totals.toImport).toBe(0);
  });
});

describe.skipIf(!sqliteAvailable())("Cashew: datos incompletos", () => {
  it("fecha vacía: error con pista, nunca una fecha inventada", async () => {
    const file = await readImportFile(
      "cashew.sql",
      buildCashewDb([...CASHEW_TXS.slice(0, 2), { pk: "sin-fecha", at: 0, name: "Misterio", amount: -100, cat: "c-out" }])
    );
    if (file.kind !== "cashew") throw new Error();
    // `date_time_modified` como pista.
    file.source.transactions.find((t) => t.transaction_pk === "sin-fecha")!.date_time_modified = T0 + 86400 * 3;
    const p = await preview({ source: file.source });
    const r = p.rows.find((x) => x.concept === "Misterio")!;
    expect(r).toMatchObject({ status: "error", date: null });
    const iss = r.issues.find((i) => i.field === "date")!;
    expect(iss.message).toBe("Falta la fecha");
    expect(iss.suggestion).toMatch(/2026-09-24/);
  });
});

describe("rendimiento", () => {
  it("5.000 filas se previsualizan en poco tiempo", async () => {
    await makeAccount({ name: "Banco" });
    const lines = ["fecha,importe,concepto,cuenta,categoria"];
    for (let i = 0; i < 5000; i++) lines.push(`2026-0${(i % 9) + 1}-${String((i % 28) + 1).padStart(2, "0")},${(i % 97) - 48}.5,Mov ${i},Banco,Cat ${i % 7}`);
    const t0 = performance.now();
    const p = await preview({ source: csv(lines.join("\n")), options: { decimal: "." } });
    expect(p.totals.total).toBe(5000);
    expect(performance.now() - t0).toBeLessThan(8000);
  });
});
