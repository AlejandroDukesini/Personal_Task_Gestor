import { describe, expect, it } from "vitest";
import { loadDb } from "@/services/localDb";
import { call, expectStatus, makeAccount, makeTx } from "@/test/helpers";
import {
  accountBalances,
  budgetHistory,
  budgetProgress,
  budgetWindow,
  buildInsights,
  cashflowSeries,
  categoryBreakdown,
  goalProgress,
  occurrencesBetween,
  periodSummary,
  recurringStatus,
  recurringTxId,
  requiredSavings,
  simulateSavings,
  balanceSeries,
  accountFlows,
} from "./calc";

const balanceOf = (id: string) => accountBalances(loadDb()).get(id);
const month = { from: "2026-09-01", to: "2026-09-30" };

describe("cuentas", () => {
  it("crea, edita y archiva; el saldo parte del saldo inicial", async () => {
    const a = await makeAccount({ name: "Banco", initialBalance: 50000 });
    expect(balanceOf(a.id)).toBe(50000);
    const edited = await call("PUT", `/finance/accounts/${a.id}`, { name: "Banco principal", color: "#123456" });
    expect(edited.name).toBe("Banco principal");
    await call("PUT", `/finance/accounts/${a.id}`, { archived: true });
    expect(loadDb().finAccounts.find((x) => x.id === a.id)?.archived).toBe(true);
  });

  it("no permite nombres duplicados entre cuentas activas", async () => {
    await makeAccount({ name: "Efectivo" });
    await expectStatus(409, makeAccount({ name: "efectivo" }));
  });

  it("solo borra cuentas sin historial; con movimientos obliga a archivar", async () => {
    const empty = await makeAccount();
    await call("DELETE", `/finance/accounts/${empty.id}`);
    expect(loadDb().finAccounts.some((a) => a.id === empty.id)).toBe(false);
    expect(loadDb().tombstones.some((t) => t.id === empty.id)).toBe(true);

    const used = await makeAccount();
    await makeTx({ accountId: used.id });
    await expectStatus(409, call("DELETE", `/finance/accounts/${used.id}`));
  });

  it("no deja cambiar la moneda de una cuenta con movimientos", async () => {
    const a = await makeAccount();
    await makeTx({ accountId: a.id });
    await expectStatus(409, call("PUT", `/finance/accounts/${a.id}`, { currency: "USD" }));
  });

  it("una cuenta archivada no admite movimientos nuevos", async () => {
    const a = await makeAccount();
    await call("PUT", `/finance/accounts/${a.id}`, { archived: true });
    await expectStatus(409, makeTx({ accountId: a.id }));
  });
});

describe("movimientos y saldos", () => {
  it("ingreso suma, gasto resta, corrección con signo", async () => {
    const a = await makeAccount({ initialBalance: 10000 });
    await makeTx({ accountId: a.id, kind: "income", amount: 5000 });
    await makeTx({ accountId: a.id, kind: "expense", amount: 2500 });
    await makeTx({ accountId: a.id, kind: "adjustment", amount: -300, reason: "Comisión no anotada" });
    expect(balanceOf(a.id)).toBe(10000 + 5000 - 2500 - 300);
  });

  it("una transferencia mueve saldo sin crear dinero ni contar como ingreso/gasto", async () => {
    const a = await makeAccount({ initialBalance: 100000 });
    const b = await makeAccount({ initialBalance: 0 });
    await makeTx({ accountId: a.id, kind: "transfer", toAccountId: b.id, amount: 40000 });
    expect(balanceOf(a.id)).toBe(60000);
    expect(balanceOf(b.id)).toBe(40000);
    const s = periodSummary(loadDb(), month, "COP");
    expect(s.income).toBe(0);
    expect(s.expense).toBe(0);
    expect(s.transfers).toBe(40000);
  });

  it("transferencia entre monedas exige el importe recibido", async () => {
    const cop = await makeAccount({ initialBalance: 1000000 });
    const usd = await makeAccount({ currency: "USD" });
    await expectStatus(400, makeTx({ accountId: cop.id, kind: "transfer", toAccountId: usd.id, amount: 400000 }));
    await makeTx({ accountId: cop.id, kind: "transfer", toAccountId: usd.id, amount: 400000, toAmount: 10000 });
    expect(balanceOf(cop.id)).toBe(600000);
    expect(balanceOf(usd.id)).toBe(10000);
  });

  it("valida reglas: importe positivo, destino distinto, motivo de corrección, categoría compatible", async () => {
    const a = await makeAccount();
    await expectStatus(400, makeTx({ accountId: a.id, amount: 0 }));
    await expectStatus(400, makeTx({ accountId: a.id, amount: -5 }));
    await expectStatus(400, makeTx({ accountId: a.id, amount: 1.5 }));
    await expectStatus(400, makeTx({ accountId: a.id, kind: "transfer", toAccountId: a.id }));
    await expectStatus(400, makeTx({ accountId: a.id, kind: "adjustment", amount: 100 }));
    await expectStatus(400, makeTx({ accountId: a.id, kind: "income", categoryId: "fincat-food" }));
    await expectStatus(404, makeTx({ accountId: "no-existe" }));
    await expectStatus(400, makeTx({ accountId: a.id, date: "2026-02-30" }));
  });

  it("crear con el mismo id es idempotente (reintentos, doble clic)", async () => {
    const a = await makeAccount({ initialBalance: 10000 });
    const id = "tx-fijo-1";
    await makeTx({ id, accountId: a.id, amount: 1000 });
    await makeTx({ id, accountId: a.id, amount: 1000 });
    await makeTx({ id, accountId: a.id, amount: 1000 });
    expect(loadDb().finTransactions.filter((t) => t.id === id)).toHaveLength(1);
    expect(balanceOf(a.id)).toBe(9000);
    // Mismo id con otro contenido: conflicto, no sobrescritura silenciosa.
    await expectStatus(409, makeTx({ id, accountId: a.id, amount: 2000 }));
  });

  it("editar y borrar mantienen el saldo coherente (se deriva, no se acumula)", async () => {
    const a = await makeAccount({ initialBalance: 10000 });
    const b = await makeAccount();
    const tx = await makeTx({ accountId: a.id, amount: 3000 });
    await call("PUT", `/finance/transactions/${tx.id}`, {
      kind: "transfer",
      amount: 4000,
      accountId: a.id,
      toAccountId: b.id,
      date: "2026-09-11",
      concept: "Ahora es transferencia",
    });
    expect(balanceOf(a.id)).toBe(6000);
    expect(balanceOf(b.id)).toBe(4000);
    await call("DELETE", `/finance/transactions/${tx.id}`);
    expect(balanceOf(a.id)).toBe(10000);
    expect(balanceOf(b.id)).toBe(0);
    expect(loadDb().tombstones.some((t) => t.collection === "finTransactions" && t.id === tx.id)).toBe(true);
  });

  it("la conciliación registra una corrección por la diferencia, con motivo", async () => {
    const a = await makeAccount({ initialBalance: 10000 });
    const res = await call("POST", `/finance/accounts/${a.id}/reconcile`, {
      balance: 12500,
      date: "2026-09-15",
      reason: "Extracto bancario",
    });
    expect(res.delta).toBe(2500);
    expect(balanceOf(a.id)).toBe(12500);
    const again = await call("POST", `/finance/accounts/${a.id}/reconcile`, { balance: 12500, date: "2026-09-15", reason: "x" });
    expect(again.adjusted).toBe(false);
    // Las correcciones no inflan ingresos.
    expect(periodSummary(loadDb(), month, "COP").income).toBe(0);
  });

  it("filtra etiquetas inexistentes y deduplica", async () => {
    const a = await makeAccount();
    const tag = await call("POST", "/tags", { name: "Viaje" });
    const tx = await makeTx({ accountId: a.id, tagIds: [tag.id, tag.id, "fantasma"] });
    expect(tx.tagIds).toEqual([tag.id]);
  });

  it("un fallo a mitad de operación no deja la base a medias (mutate atómico)", async () => {
    const a = await makeAccount();
    const before = JSON.stringify(loadDb().finTransactions);
    await expectStatus(404, makeTx({ accountId: a.id, goalId: "meta-inexistente" }));
    expect(JSON.stringify(loadDb().finTransactions)).toBe(before);
  });
});

describe("categorías", () => {
  it("vienen sembradas con ids fijos", () => {
    const ids = loadDb().finCategories.map((c) => c.id);
    expect(ids).toContain("fincat-food");
    expect(ids).toContain("fincat-salary");
  });

  it("no se borra una categoría en uso; sí se archiva", async () => {
    const a = await makeAccount();
    await makeTx({ accountId: a.id, categoryId: "fincat-food" });
    await expectStatus(409, call("DELETE", "/finance/categories/fincat-food"));
    await call("PUT", "/finance/categories/fincat-food", { archived: true });
    const c = await call("POST", "/finance/categories", { name: "Mascotas", kind: "expense" });
    await call("DELETE", `/finance/categories/${c.id}`);
  });
});

describe("estadísticas", () => {
  it("resumen, desglose y series excluyen transferencias", async () => {
    const a = await makeAccount({ initialBalance: 0 });
    const b = await makeAccount({ initialBalance: 0 });
    await makeTx({ accountId: a.id, kind: "income", amount: 300000, categoryId: "fincat-salary", date: "2026-09-01" });
    await makeTx({ accountId: a.id, amount: 50000, categoryId: "fincat-food", date: "2026-09-05" });
    await makeTx({ accountId: a.id, amount: 20000, categoryId: "fincat-food", date: "2026-09-06" });
    await makeTx({ accountId: a.id, amount: 30000, categoryId: "fincat-transport", date: "2026-09-06" });
    await makeTx({ accountId: a.id, kind: "transfer", toAccountId: b.id, amount: 100000, date: "2026-09-07" });
    const db = loadDb();

    const s = periodSummary(db, month, "COP");
    expect(s).toMatchObject({ income: 300000, expense: 100000, net: 200000 });
    expect(s.savingsRate).toBeCloseTo(66.67, 1);

    const cats = categoryBreakdown(db, month, "expense", "COP");
    expect(cats[0]).toMatchObject({ categoryId: "fincat-food", total: 70000, count: 2 });
    expect(cats.reduce((x, c) => x + c.total, 0)).toBe(s.expense);
    // Cada porción conoce los movimientos que la componen (drill-down).
    expect(cats[0].txIds).toHaveLength(2);

    const flow = cashflowSeries(db, month, "COP");
    expect(flow).toHaveLength(30);
    expect(flow.reduce((x, p) => x + p.income, 0)).toBe(300000);

    const bal = balanceSeries(db, month, "COP");
    expect(bal[bal.length - 1].balance).toBe(200000); // la transferencia no cambia el total
    expect(bal[bal.length - 1].savings).toBe(200000);

    const flows = accountFlows(db, month);
    expect(flows.find((f) => f.accountId === b.id)?.transferIn).toBe(100000);
  });

  it("el saldo de apertura de la serie incluye lo anterior al rango", async () => {
    const a = await makeAccount({ initialBalance: 1000 });
    await makeTx({ accountId: a.id, kind: "income", amount: 500, date: "2026-08-15" });
    const bal = balanceSeries(loadDb(), month, "COP");
    expect(bal[0].balance).toBe(1500);
  });
});

describe("presupuestos", () => {
  it("gasto: SOLO cuenta lo vinculado a su etiqueta (y que cumple criterios), nunca por categoría sola", async () => {
    const a = await makeAccount();
    const b = await call("POST", "/finance/budgets", {
      name: "Comida",
      kind: "spending",
      amount: 100000,
      currency: "COP",
      categoryIds: ["fincat-food"],
      period: "monthly",
      startDate: "2026-01-01",
      alertPercent: 80,
    });
    const tagId = b.tag.id;
    const alloc = (amount: number) => [{ tagId, amount }];
    await makeTx({ accountId: a.id, amount: 85000, categoryId: "fincat-food", date: "2026-09-10", allocations: alloc(85000) });
    // Misma categoría pero SIN etiqueta: no consume el presupuesto.
    await makeTx({ accountId: a.id, amount: 40000, categoryId: "fincat-food", date: "2026-09-11" });
    // Con etiqueta pero fuera de los criterios (otra categoría): tampoco.
    await makeTx({ accountId: a.id, amount: 99999, categoryId: "fincat-transport", date: "2026-09-10", allocations: alloc(99999) });
    await makeTx({ accountId: a.id, amount: 5000, categoryId: "fincat-food", date: "2026-08-31", allocations: alloc(5000) }); // mes anterior
    const db = loadDb();
    const w = budgetWindow(b, "2026-09-15")!;
    expect(w).toEqual(month);
    const p = budgetProgress(db, b, w, "2026-09-15");
    expect(p.used).toBe(85000);
    expect(p.remaining).toBe(15000);
    expect(p.state).toBe("warning");
    expect(p.txIds).toHaveLength(1);
    const hist = budgetHistory(b, "2026-09-15", 3);
    expect(hist[0]).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(budgetProgress(db, b, hist[0], "2026-09-15").used).toBe(5000);
  });

  it("ahorro: solo cuentan las asignaciones explícitas, no el ingreso entero ni las correcciones", async () => {
    const main = await makeAccount({ initialBalance: 1000000 });
    const b = await call("POST", "/finance/budgets", {
      name: "Ahorro mensual",
      kind: "saving",
      amount: 200000,
      currency: "COP",
      period: "monthly",
      startDate: "2026-09-01",
    });
    // Salario de 2.000.000: solo 150.000 destinados al ahorro.
    await makeTx({ accountId: main.id, kind: "income", amount: 2000000, date: "2026-09-05", allocations: [{ tagId: b.tag.id, amount: 150000 }] });
    await makeTx({ accountId: main.id, kind: "adjustment", amount: 999999, reason: "Ajuste", date: "2026-09-06" });
    const p = budgetProgress(loadDb(), b, month, "2026-09-10");
    expect(p.used).toBe(150000);
    expect(p.assigned).toBe(150000);
    expect(p.pct).toBe(75);
  });

  it("un presupuesto personalizado exige fecha final", async () => {
    await expectStatus(
      400,
      call("POST", "/finance/budgets", {
        name: "Viaje",
        kind: "spending",
        amount: 1000,
        currency: "COP",
        period: "custom",
        startDate: "2026-09-01",
      })
    );
  });
});

describe("metas de ahorro", () => {
  it("aportar y retirar con transferencias reales, sin doble conteo", async () => {
    const main = await makeAccount({ initialBalance: 500000 });
    const piggy = await makeAccount({ type: "savings" });
    const goal = await call("POST", "/finance/goals", {
      name: "Moto",
      targetAmount: 300000,
      currency: "COP",
      startDate: "2026-09-01",
      deadline: "2027-03-01",
    });
    await call("POST", `/finance/goals/${goal.id}/contribute`, {
      id: "aporte-1",
      amount: 100000,
      date: "2026-09-02",
      fromAccountId: main.id,
      toAccountId: piggy.id,
    });
    // Reintento idempotente
    await call("POST", `/finance/goals/${goal.id}/contribute`, {
      id: "aporte-1",
      amount: 100000,
      date: "2026-09-02",
      fromAccountId: main.id,
      toAccountId: piggy.id,
    });
    await call("POST", `/finance/goals/${goal.id}/contribute`, {
      amount: 30000,
      date: "2026-09-03",
      fromAccountId: main.id,
      toAccountId: piggy.id,
      withdraw: true,
    });
    const db = loadDb();
    const g = db.finGoals.find((x) => x.id === goal.id)!;
    const p = goalProgress(db, g, "2026-09-10");
    expect(p.saved).toBe(70000);
    expect(p.remaining).toBe(230000);
    expect(balanceOf(main.id)).toBe(430000);
    expect(balanceOf(piggy.id)).toBe(70000);
    expect(p.requiredPerMonth).toBeGreaterThan(0);
    // Ni ingresos ni gastos ficticios.
    expect(periodSummary(db, month, "COP")).toMatchObject({ income: 0, expense: 0 });
  });

  it("se completa sola al llegar al objetivo y no se borra si tiene aportaciones", async () => {
    const main = await makeAccount({ initialBalance: 500000 });
    const piggy = await makeAccount({ type: "savings" });
    const goal = await call("POST", "/finance/goals", { name: "Fondo", targetAmount: 1000, currency: "COP", startDate: "2026-09-01" });
    await call("POST", `/finance/goals/${goal.id}/contribute`, { amount: 1000, date: "2026-09-02", fromAccountId: main.id, toAccountId: piggy.id });
    expect(loadDb().finGoals[0].status).toBe("completed");
    await expectStatus(409, call("DELETE", `/finance/goals/${goal.id}`));
  });
});

describe("recurrentes", () => {
  it("genera ocurrencias mensuales respetando fin de mes", () => {
    const r = { startDate: "2026-01-31", frequency: "monthly", endDate: null } as any;
    expect(occurrencesBetween(r, "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("previsto ≠ pagado; confirmar es idempotente y usa id determinista", async () => {
    const a = await makeAccount({ initialBalance: 0 });
    const r = await call("POST", "/finance/recurring", {
      name: "Salario",
      kind: "income",
      amount: 3000000,
      accountId: a.id,
      categoryId: "fincat-salary",
      frequency: "monthly",
      startDate: "2026-07-30",
    });
    let db = loadDb();
    let st = recurringStatus(db, db.finRecurring[0], "2026-09-15");
    expect(st.overdue.map((o) => o.date)).toEqual(["2026-07-30", "2026-08-30"]);
    expect(st.upcoming[0].date).toBe("2026-09-30");
    // Nada se ha dado por cobrado automáticamente.
    expect(balanceOf(a.id)).toBe(0);

    const first = await call("POST", `/finance/recurring/${r.id}/confirm`, { date: "2026-08-30" });
    const second = await call("POST", `/finance/recurring/${r.id}/confirm`, { date: "2026-08-30" });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.transaction.id).toBe(recurringTxId(r.id, "2026-08-30"));
    expect(balanceOf(a.id)).toBe(3000000);

    await call("POST", `/finance/recurring/${r.id}/skip`, { date: "2026-07-30" });
    db = loadDb();
    st = recurringStatus(db, db.finRecurring[0], "2026-09-15");
    expect(st.overdue).toHaveLength(0);

    await expectStatus(400, call("POST", `/finance/recurring/${r.id}/confirm`, { date: "2026-08-29" }));
  });

  it("confirmar con importe distinto al previsto registra el real", async () => {
    const a = await makeAccount();
    const r = await call("POST", "/finance/recurring", {
      name: "Luz",
      kind: "expense",
      amount: 80000,
      accountId: a.id,
      frequency: "monthly",
      startDate: "2026-09-05",
    });
    await call("POST", `/finance/recurring/${r.id}/confirm`, { date: "2026-09-05", amount: 91234, paidDate: "2026-09-07" });
    const tx = loadDb().finTransactions[0];
    expect(tx).toMatchObject({ amount: 91234, date: "2026-09-07", recurringId: r.id });
  });
});

describe("análisis", () => {
  it("sin datos lo dice en vez de inventar", () => {
    const ins = buildInsights(loadDb(), "2026-09-15", "COP", String);
    expect(ins[0].id).toBe("no-data");
  });

  it("con poco historial avisa de que no hay base suficiente", async () => {
    const a = await makeAccount();
    await makeTx({ accountId: a.id, date: "2026-09-10" });
    const ins = buildInsights(loadDb(), "2026-09-15", "COP", String);
    expect(ins.some((i) => i.id === "insufficient-history")).toBe(true);
    for (const i of ins) expect(i.basis.length).toBeGreaterThan(0);
  });

  it("detecta gasto por encima de lo habitual con base declarada", async () => {
    const a = await makeAccount({ initialBalance: 10_000_000 });
    for (const m of ["06", "07", "08"]) {
      await makeTx({ accountId: a.id, kind: "income", amount: 1_000_000, date: `2026-${m}-01`, categoryId: "fincat-salary" });
      await makeTx({ accountId: a.id, amount: 100_000, date: `2026-${m}-10`, categoryId: "fincat-food" });
    }
    await makeTx({ accountId: a.id, amount: 200_000, date: "2026-09-05", categoryId: "fincat-food" });
    const ins = buildInsights(loadDb(), "2026-09-15", "COP", String);
    const food = ins.find((i) => i.id === "cat-up-fincat-food");
    expect(food?.level).toBe("warning");
    expect(ins.find((i) => i.id === "savings-rate")?.level).toBe("success");
  });

  it("simulador y ahorro necesario", () => {
    const sim = simulateSavings({
      monthlyIncome: 1_000_000,
      monthlyExpense: 900_000,
      cuts: [{ base: 200_000, pct: 50 }],
      extraSavings: 0,
      target: 1_200_000,
    });
    expect(sim.monthlySavings).toBe(200_000);
    expect(sim.monthsToTarget).toBe(6);
    const req = requiredSavings(300_000, "2026-09-01", "2026-12-01");
    expect(req.perMonth).toBeGreaterThanOrEqual(100_000);
  });
});
