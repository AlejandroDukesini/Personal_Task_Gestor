import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { dropCache, loadDb, migrate, saveDb, slugTag, type Db } from "@/services/localDb";
import { call, expectStatus, makeAccount, makeTx } from "@/test/helpers";
import { applyAnswer, buildOffer, planOffer, resolvePlan, validateOffer, type Offer, type Plan, type Resolution } from "@/services/manualsync/engine";
import {
  accountBalances,
  allocationsOf,
  goalProgress,
  periodSummary,
  purposeDistribution,
  tagOf,
  tagSeries,
  tagStats,
  unallocatedOf,
} from "./calc";
import { transactionsToCsv } from "./io";
import { FINANCE_MIGRATIONS, financeSqlDump } from "./sql";

const month = { from: "2026-09-01", to: "2026-09-30" };

async function goal(name: string, over: Record<string, unknown> = {}) {
  return call("POST", "/finance/goals", { name, targetAmount: 1_000_000, currency: "COP", startDate: "2026-01-01", ...over });
}

async function budget(name: string, over: Record<string, unknown> = {}) {
  return call("POST", "/finance/budgets", {
    name,
    kind: "spending",
    amount: 500_000,
    currency: "COP",
    period: "monthly",
    startDate: "2026-01-01",
    ...over,
  });
}

describe("etiquetas obligatorias", () => {
  it("se generan del nombre o se personalizan, sin tildes ni símbolos", async () => {
    expect(slugTag("Viaje a Japón")).toBe("ViajeJapon");
    expect(slugTag("#Fondo de emergencia")).toBe("FondoEmergencia");
    const g = await goal("Comprar un ordenador");
    expect(g.tag.name).toBe("ComprarOrdenador");
    const g2 = await goal("Viaje a Japón", { tag: "#ViajeJapon" });
    expect(g2.tag).toMatchObject({ name: "ViajeJapon", ownerType: "goal", ownerId: g2.id, id: `tag-${g2.id}` });
    const b = await budget("Alimentación mensual", { tag: "Alimentacion" });
    expect(b.tag.name).toBe("Alimentacion");
    expect(loadDb().finTags).toHaveLength(3);
  });

  it("dos finalidades activas no pueden compartir nombre; una archivada libera el nombre", async () => {
    const g = await goal("Ordenador", { tag: "Ordenador" });
    await expectStatus(409, goal("Otro ordenador", { tag: "#ordenador" }));
    // Sin nombre explícito, se desambigua solo.
    const auto = await goal("Ordenador");
    expect(auto.tag.name).toBe("Ordenador2");
    await call("PATCH", `/finance/goals/${g.id}/status`, { status: "archived" });
    const reused = await goal("Ordenador nuevo", { tag: "Ordenador" });
    expect(reused.tag.name).toBe("Ordenador");
    // Mismo nombre, pero ids distintos: los movimientos no son ambiguos.
    expect(reused.tag.id).not.toBe(g.tag?.id ?? `tag-${g.id}`);
  });

  it("renombrar conserva el historial (los movimientos referencian el id)", async () => {
    const a = await makeAccount({ initialBalance: 0 });
    const g = await goal("Moto");
    await makeTx({ accountId: a.id, kind: "income", amount: 100_000, allocations: [{ tagId: g.tag.id, amount: 40_000 }] });
    await call("PUT", `/finance/tags/${g.tag.id}`, { name: "#MotoNueva" });
    const db = loadDb();
    expect(tagOf(db, g.id)?.name).toBe("MotoNueva");
    expect(goalProgress(db, db.finGoals[0], "2026-09-15").saved).toBe(40_000);
  });

  it("la etiqueta de una finalidad existente no se puede borrar suelta", async () => {
    const g = await goal("Casa");
    await expectStatus(409, call("DELETE", `/finance/tags/${g.tag.id}`));
  });
});

describe("asignación y reparto", () => {
  it("salario de 2.000 repartido: 500 / 300 / 200 y 1.000 sin asignar, sin duplicar saldo", async () => {
    const bank = await makeAccount({ initialBalance: 0 });
    const pc = await goal("Ordenador", { tag: "Ordenador" });
    const jp = await goal("Viaje Japón", { tag: "ViajeJapon" });
    const em = await goal("Emergencias", { tag: "Emergencias" });
    const tx = await makeTx({
      accountId: bank.id,
      kind: "income",
      amount: 2_000_00,
      date: "2026-09-01",
      concept: "Salario",
      allocations: [
        { tagId: pc.tag.id, amount: 500_00 },
        { tagId: jp.tag.id, amount: 300_00 },
        { tagId: em.tag.id, amount: 200_00 },
      ],
    });
    const db = loadDb();
    // El saldo refleja el ingreso UNA vez.
    expect(accountBalances(db).get(bank.id)).toBe(2_000_00);
    expect(periodSummary(db, month, "COP").income).toBe(2_000_00);
    expect(unallocatedOf(db, db.finTransactions[0])).toBe(1_000_00);
    expect(goalProgress(db, db.finGoals.find((g) => g.id === pc.id)!, "2026-09-15").saved).toBe(500_00);
    expect(goalProgress(db, db.finGoals.find((g) => g.id === jp.id)!, "2026-09-15").saved).toBe(300_00);
    // La distribución suma exactamente los ingresos.
    const dist = purposeDistribution(db, month, "COP");
    expect(dist.reduce((s, x) => s + x.amount, 0)).toBe(2_000_00);
    expect(dist.find((x) => x.tagId === null)?.amount).toBe(1_000_00);
    expect(tx.allocations.every((a: any) => a.flow === "assign" && a.id)).toBe(true);
  });

  it("no se puede asignar más que el importe; si falla no se guarda nada", async () => {
    const bank = await makeAccount();
    const g = await goal("Tope");
    const before = loadDb().finTransactions.length;
    await expectStatus(400, makeTx({ accountId: bank.id, kind: "income", amount: 1000, allocations: [{ tagId: g.tag.id, amount: 1001 }] }));
    await expectStatus(
      400,
      makeTx({ accountId: bank.id, kind: "income", amount: 1000, allocations: [{ tagId: g.tag.id, amount: 600 }, { tagId: g.tag.id, amount: 600 }] })
    );
    await expectStatus(404, makeTx({ accountId: bank.id, kind: "income", amount: 1000, allocations: [{ tagId: "tag-fantasma", amount: 1 }] }));
    expect(loadDb().finTransactions).toHaveLength(before);
  });

  it("un gasto se reparte entre presupuestos y metas (flujo 'usado')", async () => {
    const bank = await makeAccount({ initialBalance: 1_000_000 });
    const pc = await goal("Ordenador", { tag: "Ordenador" });
    const tech = await budget("Tecnología", { tag: "Tecnologia" });
    await makeTx({ accountId: bank.id, kind: "income", amount: 600_000, date: "2026-09-01", allocations: [{ tagId: pc.tag.id, amount: 600_000 }] });
    // Compra de 150 en tienda: categoría Compras, etiqueta #Ordenador, cuenta Banco.
    await makeTx({
      accountId: bank.id,
      amount: 250_000,
      date: "2026-09-10",
      categoryId: "fincat-shopping",
      allocations: [
        { tagId: pc.tag.id, amount: 150_000 },
        { tagId: tech.tag.id, amount: 100_000 },
      ],
    });
    const db = loadDb();
    const pcStats = tagStats(db, pc.tag.id);
    expect(pcStats).toMatchObject({ assigned: 600_000, used: 150_000, net: 450_000, incomeLinked: 600_000, expenseLinked: 150_000 });
    expect(goalProgress(db, db.finGoals[0], "2026-09-15").saved).toBe(450_000);
    expect(tagStats(db, tech.tag.id, month).used).toBe(100_000);
    // La categoría sigue siendo independiente de la finalidad.
    expect(db.finTransactions.find((t) => t.kind === "expense")?.categoryId).toBe("fincat-shopping");
  });

  it("editar, cambiar o retirar la etiqueta recalcula; editar sin enviar asignaciones las conserva", async () => {
    const bank = await makeAccount({ initialBalance: 0 });
    const a = await goal("A", { tag: "MetaA" });
    const b = await goal("B", { tag: "MetaB" });
    const tx = await makeTx({ accountId: bank.id, kind: "income", amount: 1000, allocations: [{ tagId: a.tag.id, amount: 1000 }] });
    const base = { kind: "income", amount: 1000, accountId: bank.id, date: "2026-09-10", concept: "Ingreso" };
    await call("PUT", `/finance/transactions/${tx.id}`, { ...base, allocations: [{ tagId: b.tag.id, amount: 700 }] });
    let db = loadDb();
    expect(goalProgress(db, db.finGoals.find((g) => g.id === a.id)!, "2026-09-15").saved).toBe(0);
    expect(goalProgress(db, db.finGoals.find((g) => g.id === b.id)!, "2026-09-15").saved).toBe(700);
    // PUT sin el campo: no se pierde el destino del dinero.
    await call("PUT", `/finance/transactions/${tx.id}`, { ...base, concept: "Renombrado" });
    expect(loadDb().finTransactions[0].allocations).toHaveLength(1);
    // Bajar el importe por debajo de lo asignado sin corregir: rechazado.
    await expectStatus(400, call("PUT", `/finance/transactions/${tx.id}`, { ...base, amount: 500 }));
    // Retirar la etiqueta explícitamente.
    await call("PUT", `/finance/transactions/${tx.id}`, { ...base, allocations: [] });
    db = loadDb();
    expect(goalProgress(db, db.finGoals.find((g) => g.id === b.id)!, "2026-09-15").saved).toBe(0);
  });

  it("nada se asigna automáticamente por categoría, importe o cuenta", async () => {
    const bank = await makeAccount();
    await budget("Comida", { categoryIds: ["fincat-food"], accountIds: [bank.id], tag: "Comida" });
    const tx = await makeTx({ accountId: bank.id, amount: 5000, categoryId: "fincat-food" });
    expect(tx.allocations).toEqual([]);
    expect(allocationsOf(loadDb(), loadDb().finTransactions[0])).toEqual([]);
  });

  it("archivada o completada: conserva historial, no admite asignaciones nuevas", async () => {
    const bank = await makeAccount({ initialBalance: 0 });
    const g = await goal("Viejo", { tag: "Viejo" });
    const tx = await makeTx({ accountId: bank.id, kind: "income", amount: 1000, allocations: [{ tagId: g.tag.id, amount: 400 }] });
    await call("PATCH", `/finance/goals/${g.id}/status`, { status: "archived" });
    await expectStatus(409, makeTx({ accountId: bank.id, kind: "income", amount: 1000, allocations: [{ tagId: g.tag.id, amount: 1 }] }));
    // Editar el movimiento antiguo sigue permitido (corrección de historial).
    await call("PUT", `/finance/transactions/${tx.id}`, {
      kind: "income",
      amount: 1000,
      accountId: bank.id,
      date: "2026-09-10",
      concept: "Corregido",
      allocations: [{ tagId: g.tag.id, amount: 450 }],
    });
    const db = loadDb();
    expect(tagOf(db, g.id)).toBeDefined();
    expect(tagStats(db, g.tag.id).assigned).toBe(450);
  });

  it("no se borra un presupuesto con movimientos vinculados; sin ellos se borra con su etiqueta", async () => {
    const bank = await makeAccount();
    const used = await budget("Usado", { tag: "Usado" });
    await makeTx({ accountId: bank.id, amount: 100, allocations: [{ tagId: used.tag.id, amount: 100 }] });
    await expectStatus(409, call("DELETE", `/finance/budgets/${used.id}`));
    const empty = await budget("Vacío", { tag: "Vacio" });
    await call("DELETE", `/finance/budgets/${empty.id}`);
    const db = loadDb();
    expect(db.finTags.some((t) => t.id === empty.tag.id)).toBe(false);
    expect(db.tombstones.some((t) => t.collection === "finTags" && t.id === empty.tag.id)).toBe(true);
  });

  it("aportar y retirar de una meta genera asignaciones sobre la transferencia real", async () => {
    const main = await makeAccount({ initialBalance: 500_000 });
    const sav = await makeAccount({ type: "savings" });
    const g = await goal("Colchón");
    await call("POST", `/finance/goals/${g.id}/contribute`, { amount: 100_000, date: "2026-09-02", fromAccountId: main.id, toAccountId: sav.id });
    await call("POST", `/finance/goals/${g.id}/contribute`, { amount: 30_000, date: "2026-09-03", fromAccountId: main.id, toAccountId: sav.id, withdraw: true });
    const db = loadDb();
    expect(db.finTransactions.map((t) => t.allocations?.[0]?.flow)).toEqual(["assign", "use"]);
    expect(goalProgress(db, db.finGoals[0], "2026-09-10").saved).toBe(70_000);
  });

  it("las filas antiguas con goalId se leen como asignaciones", async () => {
    const bank = await makeAccount({ initialBalance: 0 });
    const g = await goal("Legado");
    const db = loadDb();
    db.finTransactions.push({
      id: "legacy-1",
      kind: "income",
      amount: 7000,
      accountId: bank.id,
      toAccountId: null,
      toAmount: null,
      categoryId: null,
      date: "2026-09-01",
      concept: "Antiguo",
      description: null,
      tagIds: [],
      goalId: g.id,
      recurringId: null,
      reason: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    saveDb(db);
    expect(goalProgress(loadDb(), loadDb().finGoals[0], "2026-09-10").saved).toBe(7000);
    await expectStatus(409, call("DELETE", `/finance/goals/${g.id}`));
  });

  it("serie de evolución de una etiqueta", async () => {
    const bank = await makeAccount({ initialBalance: 0 });
    const g = await goal("Serie");
    await makeTx({ accountId: bank.id, kind: "income", amount: 1000, date: "2026-08-20", allocations: [{ tagId: g.tag.id, amount: 100 }] });
    await makeTx({ accountId: bank.id, kind: "income", amount: 1000, date: "2026-09-05", allocations: [{ tagId: g.tag.id, amount: 200 }] });
    const s = tagSeries(loadDb(), g.tag.id, month);
    expect(s[0].balance).toBe(100); // saldo de apertura
    expect(s[s.length - 1].balance).toBe(300);
  });
});

describe("recurrentes con plantilla de asignaciones", () => {
  it("confirmar aplica la plantilla con ids deterministas y no asigna más de lo cobrado", async () => {
    const bank = await makeAccount({ initialBalance: 0 });
    const a = await goal("A", { tag: "RecA" });
    const b = await goal("B", { tag: "RecB" });
    const r = await call("POST", "/finance/recurring", {
      name: "Salario",
      kind: "income",
      amount: 2000,
      accountId: bank.id,
      frequency: "monthly",
      startDate: "2026-09-01",
      allocations: [
        { tagId: a.tag.id, amount: 500 },
        { tagId: b.tag.id, amount: 300 },
      ],
    });
    const res = await call("POST", `/finance/recurring/${r.id}/confirm`, { date: "2026-09-01", amount: 600 });
    expect(res.transaction.allocations.map((x: any) => [x.tagId, x.amount])).toEqual([
      [a.tag.id, 500],
      [b.tag.id, 100],
    ]);
    expect(res.transaction.allocations[0].id).toBe(`${res.transaction.id}-a0`);
  });
});

describe("sincronización manual de etiquetas y asignaciones", () => {
  /** Dispositivo con almacenamiento propio (se activa con `use`). */
  class Device {
    store = new Map<string, string>();
    use() {
      const s = this.store;
      (globalThis as any).localStorage = {
        get length() {
          return s.size;
        },
        clear: () => s.clear(),
        getItem: (k: string) => (s.has(k) ? s.get(k)! : null),
        key: (i: number) => [...s.keys()][i] ?? null,
        removeItem: (k: string) => s.delete(k),
        setItem: (k: string, v: string) => s.set(k, String(v)),
      };
      dropCache();
      return this;
    }
    db(): Db {
      this.use();
      return loadDb();
    }
  }

  /** Sincronización completa con el motor real: `b` ofrece, `a` resuelve, `b` aplica la respuesta. */
  function sync(a: Device, b: Device, resolve: (p: Plan) => Record<string, Resolution> = () => ({})) {
    const offer = JSON.parse(JSON.stringify(buildOffer(b.db(), { deviceId: "B", name: "B" }, "A", null, true))) as Offer;
    const plan = planOffer(a.db(), offer, null);
    const { db: merged, answer } = resolvePlan(a.db(), plan, resolve(plan), { deviceId: "A", name: "A" });
    a.use();
    saveDb(merged);
    const { db: bNew } = applyAnswer(b.db(), JSON.parse(JSON.stringify(answer)));
    b.use();
    saveDb(bNew);
    return plan;
  }

  it("las asignaciones viajan con el movimiento, sin duplicar etiquetas ni dinero", async () => {
    const pc = new Device().use();
    const acc = await makeAccount({ initialBalance: 0 });
    const g = await goal("Sync", { tag: "Sync" });
    await makeTx({ accountId: acc.id, kind: "income", amount: 1000, allocations: [{ tagId: g.tag.id, amount: 600 }] });
    const phone = new Device().use();
    loadDb();
    sync(phone, pc);
    sync(phone, pc);
    const db = phone.db();
    expect(db.finTags.filter((t) => t.ownerId === g.id)).toHaveLength(1);
    expect(goalProgress(db, db.finGoals.find((x) => x.id === g.id)!, "2026-09-15").saved).toBe(600);
    expect(accountBalances(db).get(acc.id)).toBe(1000);
  });

  it("reparto editado en ambos: conflicto financiero; gane quien gane, nunca supera el importe", async () => {
    const pc = new Device().use();
    const acc = await makeAccount({ initialBalance: 0 });
    const a = await goal("A", { tag: "CA" });
    const b = await goal("B", { tag: "CB" });
    const tx = await makeTx({ accountId: acc.id, kind: "income", amount: 1000 });
    const phone = new Device().use();
    loadDb();
    sync(phone, pc);
    const base = { kind: "income", amount: 1000, accountId: acc.id, date: "2026-09-10", concept: "X" };
    pc.use();
    await call("PUT", `/finance/transactions/${tx.id}`, { ...base, allocations: [{ tagId: a.tag.id, amount: 900 }] });
    phone.use();
    await call("PUT", `/finance/transactions/${tx.id}`, { ...base, allocations: [{ tagId: b.tag.id, amount: 900 }] });
    // Sin base común (sync de prueba sin historial): se compara como primera vez.
    const plan = sync(phone, pc, (p) => Object.fromEntries(p.conflicts.map((c) => [c.key, { choice: "remote" } as Resolution])));
    const c = plan.conflicts.find((x) => x.key === `finTransactions:${tx.id}`)!;
    expect(c.finance).toBe(true);
    expect(c.canCombine).toBe(false);
    for (const d of [pc, phone]) {
      const allocs = d.db().finTransactions.find((t) => t.id === tx.id)!.allocations!;
      expect(allocs.reduce((s, x) => s + x.amount, 0)).toBeLessThanOrEqual(1000);
      expect(allocs[0].tagId).toBe(a.tag.id);
    }
  });

  it("meta borrada en un dispositivo mientras otro le asignaba dinero: se conserva con su etiqueta", async () => {
    const pc = new Device().use();
    const acc = await makeAccount({ initialBalance: 0 });
    const g = await goal("Frágil", { tag: "Fragil" });
    const phone = new Device().use();
    loadDb();
    sync(phone, pc);
    pc.use();
    await call("DELETE", `/finance/goals/${g.id}`);
    phone.use();
    await makeTx({ accountId: acc.id, kind: "income", amount: 1000, allocations: [{ tagId: g.tag.id, amount: 300 }] });
    sync(phone, pc, (p) => Object.fromEntries(p.conflicts.map((c) => [c.key, { choice: "local" } as Resolution])));
    for (const d of [pc, phone]) {
      expect(d.db().finGoals.some((x) => x.id === g.id)).toBe(true);
      expect(d.db().finTags.some((t) => t.id === g.tag.id)).toBe(true);
    }
  });

  it("filas recibidas cuyas asignaciones superan el importe se rechazan", async () => {
    const acc = await makeAccount({ initialBalance: 0 });
    const g = await goal("Evil", { tag: "Evil" });
    const bad = {
      protocol: 1,
      kind: "offer",
      id: "x",
      createdAt: new Date().toISOString(),
      from: { deviceId: "evil", name: "Evil" },
      to: null,
      baseId: null,
      full: true,
      manifest: { "finTransactions:bad": "h" },
      entries: [
        {
          key: "finTransactions:bad",
          row: {
            id: "bad",
            kind: "income",
            amount: 100,
            accountId: acc.id,
            toAccountId: null,
            toAmount: null,
            categoryId: null,
            date: "2026-09-01",
            concept: "x",
            description: null,
            tagIds: [],
            goalId: null,
            recurringId: null,
            reason: null,
            allocations: [{ id: "a", tagId: g.tag.id, amount: 5000, flow: "assign" }],
            createdAt: "2026-09-01T00:00:00.000Z",
            updatedAt: "2026-09-01T00:00:00.000Z",
          },
        },
      ],
    };
    const { offer, errors } = validateOffer(bad);
    expect(offer).toBeNull();
    expect(errors[0]).toMatch(/financieros no válidos/);
  });

  it("presupuestos llegados de un dispositivo sin actualizar reciben la misma etiqueta en ambos lados", async () => {
    const pc = new Device().use();
    const legacy = loadDb();
    legacy.finBudgets.push({
      id: "b-old",
      name: "Gasolina mensual",
      description: null,
      kind: "spending",
      amount: 1000,
      currency: "COP",
      categoryIds: [],
      accountIds: [],
      period: "monthly",
      startDate: "2026-01-01",
      endDate: null,
      status: "active",
      alertPercent: 80,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    saveDb(legacy);
    const phone = new Device().use();
    loadDb();
    sync(phone, pc);
    const t1 = phone.db().finTags.find((t) => t.ownerId === "b-old");
    const t2 = pc.db().finTags.find((t) => t.ownerId === "b-old");
    expect(t1?.name).toBe("GasolinaMensual");
    expect(t1).toEqual(t2);
  });
});

describe("migración v4 y formatos", () => {
  it("un guardado v3 recibe etiquetas deterministas para sus presupuestos y metas", () => {
    const v3 = {
      version: 3,
      finGoals: [{ id: "g1", name: "Viaje a Japón", color: "#0ea5e9", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
      finBudgets: [{ id: "b1", name: "Viaje a Japón", status: "active", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" }],
    };
    const a = migrate(structuredClone(v3));
    const b = migrate(structuredClone(v3));
    expect(a.finTags).toEqual(b.finTags);
    expect(a.finTags.map((t) => t.name)).toEqual(["ViajeJapon", "ViajeJapon2"]);
  });

  it("CSV: exporta y reimporta la columna de finalidades", async () => {
    const bank = await makeAccount({ name: "Banco", initialBalance: 0 });
    await goal("Ordenador", { tag: "Ordenador" });
    const csv = "fecha;tipo;importe;cuenta;concepto;finalidades\n2026-09-01;ingreso;2000;Banco;Salario;#Ordenador=500\n2026-09-02;ingreso;100;Banco;X;#Nadie=5\n";
    const p = await call("POST", "/finance/import/csv/preview", { text: csv });
    expect(p.valid).toBe(false);
    expect(p.errors[0]).toMatchObject({ line: 3 });
    await call("POST", "/finance/import/csv", { text: csv.split("\n").slice(0, 2).join("\n") });
    const db = loadDb();
    expect(db.finTransactions[0].allocations?.[0]).toMatchObject({ amount: 50000, flow: "assign" });
    expect(transactionsToCsv(db, db.finTransactions)).toContain("#Ordenador=500");
    void bank;
  });

  it("SQL: el trigger impide asignar más que el importe", async () => {
    let DatabaseSync: any;
    try {
      ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite"));
    } catch {
      return;
    }
    const bank = await makeAccount({ initialBalance: 0 });
    const g = await goal("SQL", { tag: "Sql" });
    await makeTx({ id: "t1", accountId: bank.id, kind: "income", amount: 1000, allocations: [{ tagId: g.tag.id, amount: 800 }] });
    const sqlite = new DatabaseSync(":memory:");
    for (const m of FINANCE_MIGRATIONS) sqlite.exec(m.sql);
    sqlite.exec(financeSqlDump(loadDb()));
    expect(sqlite.prepare("SELECT SUM(amount) s FROM fin_allocations").get().s).toBe(800);
    expect(() =>
      sqlite.exec(`INSERT INTO fin_allocations (id, transaction_id, tag_id, amount, flow) VALUES ('x', 't1', '${g.tag.id}', 300, 'use')`)
    ).toThrow(/superan/);
  });
});
