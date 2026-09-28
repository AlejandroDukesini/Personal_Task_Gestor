import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { loadDb, resetDb } from "@/services/localDb";
import { call, expectStatus, makeAccount, makeTx } from "@/test/helpers";
import { accountBalances } from "./calc";
import { parseCsv, transactionsToCsv } from "./io";
import { FINANCE_MIGRATIONS, financeSqlDump } from "./sql";

async function seedFinance() {
  const bank = await makeAccount({ name: "Banco", initialBalance: 100000 });
  const cash = await makeAccount({ name: "Efectivo", type: "cash", initialBalance: 5000 });
  const tag = await call("POST", "/tags", { name: "Viaje" });
  await makeTx({ accountId: bank.id, kind: "income", amount: 250000, categoryId: "fincat-salary", concept: "Nómina" });
  await makeTx({ accountId: bank.id, amount: 12345, categoryId: "fincat-food", concept: "Súper, \"oferta\"", tagIds: [tag.id] });
  await makeTx({ accountId: bank.id, kind: "transfer", toAccountId: cash.id, amount: 20000, concept: "Retiro" });
  await makeTx({ accountId: cash.id, kind: "adjustment", amount: -150, reason: "Redondeo", concept: "Corrección" });
  const goal = await call("POST", "/finance/goals", { name: "Viaje", targetAmount: 500000, currency: "COP", startDate: "2026-09-01", accountIds: [cash.id] });
  await call("POST", "/finance/budgets", { name: "Comida", kind: "spending", amount: 90000, currency: "COP", categoryIds: ["fincat-food"], accountIds: [bank.id], period: "monthly", startDate: "2026-09-01" });
  const rec = await call("POST", "/finance/recurring", { name: "Netflix", kind: "expense", amount: 26900, accountId: bank.id, categoryId: "fincat-subscriptions", frequency: "monthly", startDate: "2026-09-03", goalId: null });
  await call("POST", `/finance/recurring/${rec.id}/confirm`, { date: "2026-09-03" });
  await call("POST", `/finance/recurring/${rec.id}/skip`, { date: "2026-10-03" });
  return { bank, cash, goal, rec };
}

describe("exportar / importar JSON", () => {
  it("ida y vuelta a una base vacía reproduce saldos idénticos", async () => {
    await seedFinance();
    const exported = await call("GET", "/finance/export");
    const balances = [...accountBalances(loadDb()).entries()];

    resetDb();
    localStorage.clear();
    const preview = await call("POST", "/finance/import/preview", { data: exported, mode: "newer" });
    expect(preview.valid).toBe(true);
    expect(preview.counts.finTransactions.insert).toBe(5);
    await call("POST", "/finance/import", { data: exported, mode: "newer" });
    expect([...accountBalances(loadDb()).entries()].sort()).toEqual(balances.sort());
    // Etiqueta recreada y referenciada
    expect(loadDb().tags.some((t) => t.name === "Viaje")).toBe(true);
  });

  it("reimportar el mismo fichero no duplica", async () => {
    await seedFinance();
    const exported = await call("GET", "/finance/export");
    const res = await call("POST", "/finance/import", { data: exported, mode: "newer" });
    expect(res.counts.finTransactions).toMatchObject({ insert: 0, update: 0, unchanged: 5 });
    expect(loadDb().finTransactions).toHaveLength(5);
  });

  it("modo 'newer' no pisa una edición local más reciente", async () => {
    const { bank } = await seedFinance();
    const exported = await call("GET", "/finance/export");
    await call("PUT", `/finance/accounts/${bank.id}`, { name: "Banco editado" });
    const res = await call("POST", "/finance/import", { data: exported, mode: "newer" });
    expect(res.counts.finAccounts.skipped).toBe(1);
    expect(loadDb().finAccounts.find((a) => a.id === bank.id)?.name).toBe("Banco editado");
  });

  it("no resucita lo borrado localmente después de exportar", async () => {
    await seedFinance();
    const exported = await call("GET", "/finance/export");
    const victim = loadDb().finTransactions.find((t) => t.kind === "adjustment")!;
    await call("DELETE", `/finance/transactions/${victim.id}`);
    await call("POST", "/finance/import", { data: exported, mode: "newer" });
    expect(loadDb().finTransactions.some((t) => t.id === victim.id)).toBe(false);
  });

  it("referencias rotas o filas inválidas cancelan TODA la importación", async () => {
    await seedFinance();
    const exported = await call("GET", "/finance/export");
    const before = JSON.stringify(loadDb());
    const broken = structuredClone(exported);
    broken.data.finTransactions.push({ ...broken.data.finTransactions[0], id: "nuevo", accountId: "no-existe" });
    const preview = await call("POST", "/finance/import/preview", { data: broken, mode: "merge" });
    expect(preview.valid).toBe(false);
    expect(preview.errors[0].message).toMatch(/inexistente/);
    await expectStatus(400, call("POST", "/finance/import", { data: broken, mode: "merge" }));

    const bad = structuredClone(exported);
    bad.data.finTransactions[0].amount = 10.5;
    await expectStatus(400, call("POST", "/finance/import", { data: bad, mode: "merge" }));
    expect(JSON.stringify(loadDb())).toBe(before);
  });

  it("rechaza ficheros que no son exportaciones de finanzas", async () => {
    const p = await call("POST", "/finance/import/preview", { data: { hola: 1 }, mode: "merge" });
    expect(p.valid).toBe(false);
  });
});

describe("CSV", () => {
  it("parser: comillas, separador ; y saltos de línea en campos", () => {
    expect(parseCsv('a;b\n"x;1";"di ""hola""\nadiós"\n')).toEqual([
      ["a", "b"],
      ["x;1", 'di "hola"\nadiós'],
    ]);
  });

  it("exportar e importar CSV: ids deterministas, sin duplicados al repetir", async () => {
    const { bank } = await seedFinance();
    const csv = `fecha;tipo;importe;cuenta;categoria;concepto;etiquetas
2026-09-20;gasto;1.234,50;Banco;Alimentación;Mercado;Viaje
21/09/2026;ingreso;50000;Banco;Ingresos adicionales;Freelance;
2026-09-22;gasto;1.234,50;Banco;Alimentación;Mercado;
`;
    const preview = await call("POST", "/finance/import/csv/preview", { text: csv });
    expect(preview.valid).toBe(true);
    expect(preview.toImport).toBe(3);
    await call("POST", "/finance/import/csv", { text: csv });
    const again = await call("POST", "/finance/import/csv/preview", { text: csv });
    expect(again.toImport).toBe(0);
    expect(again.duplicates).toBe(3);
    const t = loadDb().finTransactions.find((x) => x.concept === "Mercado")!;
    expect(t.amount).toBe(123450);
    expect(accountBalances(loadDb()).get(bank.id)).toBeDefined();
  });

  it("CSV exportado se puede reimportar y se reconoce como duplicado", async () => {
    await seedFinance();
    const db = loadDb();
    const csv = transactionsToCsv(db, db.finTransactions);
    expect(csv.startsWith("﻿id,fecha")).toBe(true);
    const p = await call("POST", "/finance/import/csv/preview", { text: csv });
    expect(p.valid).toBe(true);
    expect(p.duplicates).toBe(db.finTransactions.length);
  });

  it("neutraliza fórmulas (inyección CSV) al exportar", async () => {
    const a = await makeAccount({ name: "Banco" });
    await makeTx({ accountId: a.id, concept: "=HYPERLINK(\"http://x\")" });
    const db = loadDb();
    expect(transactionsToCsv(db, db.finTransactions)).toContain("'=HYPERLINK");
  });

  it("errores por línea cancelan la importación", async () => {
    await makeAccount({ name: "Banco" });
    const csv = "fecha,importe,cuenta,concepto\n2026-13-01,10,Banco,X\n2026-09-01,abc,Banco,Y\n2026-09-01,10,Nadie,Z\n";
    const p = await call("POST", "/finance/import/csv/preview", { text: csv });
    expect(p.valid).toBe(false);
    expect(p.errors.map((e: any) => e.line)).toEqual([2, 3, 4]);
    await expectStatus(400, call("POST", "/finance/import/csv", { text: csv }));
    expect(loadDb().finTransactions).toHaveLength(0);
  });
});

describe("SQL", () => {
  it("la migración versionada del servidor es idéntica a la que usa la app", () => {
    const file = readFileSync(
      path.resolve(__dirname, "../../../../server/prisma/migrations/finance/V1__finance.sql"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    expect(file).toBe(FINANCE_MIGRATIONS[0].sql);
  });

  it("esquema + volcado se ejecutan en SQLite real y cuadran los saldos", async () => {
    let DatabaseSync: any;
    try {
      ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite"));
    } catch {
      console.warn("node:sqlite no disponible: prueba SQL omitida");
      return;
    }
    const { bank, cash } = await seedFinance();
    const db = loadDb();
    const sqlite = new DatabaseSync(":memory:");
    // Idempotentes: aplicar las migraciones dos veces no falla.
    for (let pass = 0; pass < 2; pass++) for (const m of FINANCE_MIGRATIONS) sqlite.exec(m.sql);
    sqlite.exec(financeSqlDump(db));
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const balance = (id: string) =>
      sqlite
        .prepare(
          `SELECT a.initial_balance
             + COALESCE((SELECT SUM(CASE kind WHEN 'income' THEN amount WHEN 'expense' THEN -amount WHEN 'adjustment' THEN amount ELSE -amount END)
                         FROM fin_transactions WHERE account_id = a.id), 0)
             + COALESCE((SELECT SUM(COALESCE(to_amount, amount)) FROM fin_transactions WHERE to_account_id = a.id), 0) AS b
           FROM fin_accounts a WHERE a.id = ?`
        )
        .get(id).b;
    const local = accountBalances(db);
    expect(balance(bank.id)).toBe(local.get(bank.id));
    expect(balance(cash.id)).toBe(local.get(cash.id));
    expect(sqlite.prepare("SELECT version FROM fin_schema_version").get().version).toBe(1);

    // Las restricciones protegen de verdad: un gasto negativo no entra.
    expect(() =>
      sqlite.exec(
        `INSERT INTO fin_transactions (id, kind, amount, account_id, date, concept, created_at, updated_at)
         VALUES ('neg', 'expense', -5, '${bank.id}', '2026-09-01', 'x', 'a', 'a')`
      )
    ).toThrow();
    // Y comillas en textos no rompen el SQL (inyección).
    expect(sqlite.prepare("SELECT concept FROM fin_transactions WHERE concept LIKE 'Súper%'").get().concept).toBe(
      'Súper, "oferta"'
    );
  });

  it("el volcado escapa comillas simples", async () => {
    const a = await makeAccount({ name: "O'Brien" });
    await makeTx({ accountId: a.id, concept: "x'); DROP TABLE fin_accounts; --" });
    const dump = financeSqlDump(loadDb());
    expect(dump).toContain("'x''); DROP TABLE fin_accounts; --'");
  });
});
