import { describe, expect, it } from "vitest";
import { DB_VERSION, loadDb, localDateKey, migrate, startOfDay } from "@/services/localDb";
import { call, expectStatus } from "@/test/helpers";
import { habitStats, logTarget, logsByDay, nextCount, progressOf } from "./progress";

const today = () => startOfDay(new Date()).toISOString();
const daysAgo = (n: number) => {
  const d = startOfDay(new Date());
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

async function habit(over: Record<string, unknown> = {}) {
  return call("POST", "/habits", { name: "Beber agua", dailyTarget: 8, unit: "vasos", ...over });
}

describe("metas cuantificables: cada clic es una realización", () => {
  it("meta 8: cada clic suma 1 y el progreso sigue la tabla 0/8 … 8/8", async () => {
    const h = await habit();
    const expected = [12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];
    for (let i = 0; i < 8; i++) {
      await call("POST", `/habits/${h.id}/logs`, { date: today() });
      const p = await call("GET", `/habits/${h.id}/progress`);
      expect(p.count).toBe(i + 1);
      expect(p.percent).toBeCloseTo(expected[i]);
      expect(p.done).toBe(i === 7);
    }
    const list = await call("GET", "/habits");
    const mine = list.find((x: any) => x.id === h.id);
    expect(mine.stats.today).toMatchObject({ count: 8, target: 8, done: true, percent: 100 });
    expect(mine.stats.last30.at(-1).done).toBe(true);
  });

  it("meta 1 (hábito binario): un clic lo completa, como antes", async () => {
    const h = await habit({ name: "Meditar", dailyTarget: 1, unit: null });
    await call("POST", `/habits/${h.id}/logs`, { date: today() });
    const p = await call("GET", `/habits/${h.id}/progress`);
    expect(p).toMatchObject({ count: 1, target: 1, done: true, percent: 100 });
    // Desmarcar sigue funcionando con la ruta de siempre.
    await call("DELETE", `/habits/${h.id}/logs?date=${today()}`);
    expect((await call("GET", `/habits/${h.id}/progress`)).count).toBe(0);
  });

  it("realizaciones extra: el progreso visual se queda en 100 % pero se guarda el total real", async () => {
    const h = await habit({ dailyTarget: 2 });
    for (let i = 0; i < 5; i++) await call("POST", `/habits/${h.id}/logs`, { date: today() });
    const p = await call("GET", `/habits/${h.id}/progress`);
    expect(p.count).toBe(5);
    expect(p.percent).toBe(100);
    expect(p.done).toBe(true);
  });

  it("decrementar corrige un clic de más y llegar a 0 borra solo el registro de ese día", async () => {
    const h = await habit({ dailyTarget: 3 });
    await call("POST", `/habits/${h.id}/logs`, { date: daysAgo(1), count: 3 });
    await call("POST", `/habits/${h.id}/logs`, { date: today() });
    await call("POST", `/habits/${h.id}/logs`, { date: today() });
    await call("POST", `/habits/${h.id}/logs`, { date: today(), delta: -1 });
    expect((await call("GET", `/habits/${h.id}/progress`)).count).toBe(1);
    await call("POST", `/habits/${h.id}/logs`, { date: today(), delta: -1 });
    await call("POST", `/habits/${h.id}/logs`, { date: today(), delta: -1 }); // no baja de 0
    const db = loadDb();
    expect(db.habitLogs.filter((l) => l.habitId === h.id)).toHaveLength(1);
    expect(db.tombstones.some((t) => t.collection === "habitLogs")).toBe(true);
    expect((await call("GET", `/habits/${h.id}/progress?date=${daysAgo(1)}`)).count).toBe(3);
  });

  it("introducir una cantidad manual fija el total del día", async () => {
    const h = await habit();
    await call("POST", `/habits/${h.id}/logs`, { date: today(), count: 6 });
    expect((await call("GET", `/habits/${h.id}/progress`)).count).toBe(6);
    await expectStatus(400, call("POST", `/habits/${h.id}/logs`, { date: today(), count: -2 }));
  });

  it("cada acción queda trazada con su origen", async () => {
    const h = await habit();
    await call("POST", `/habits/${h.id}/logs`, { date: today() });
    await call("POST", `/habits/${h.id}/logs`, { date: today(), source: "calendar" });
    await call("POST", `/habits/${h.id}/logs`, { date: today(), delta: -1 });
    const p = await call("GET", `/habits/${h.id}/progress`);
    expect(p.trail.map((t: any) => [t.op, t.value, t.source])).toEqual([
      ["inc", 1, "manual"],
      ["inc", 2, "calendar"],
      ["dec", 1, "manual"],
    ]);
  });

  it("el día nuevo empieza en 0 sin perder el historial de días anteriores", async () => {
    const h = await habit({ dailyTarget: 2 });
    await call("POST", `/habits/${h.id}/logs`, { date: daysAgo(2), count: 2 });
    await call("POST", `/habits/${h.id}/logs`, { date: daysAgo(1), count: 2 });
    const p = await call("GET", `/habits/${h.id}/progress`);
    expect(p.count).toBe(0);
    const [mine] = (await call("GET", "/habits")).filter((x: any) => x.id === h.id);
    expect(mine.stats.last30.slice(-3).map((d: any) => d.count)).toEqual([2, 2, 0]);
    // Hoy aún está abierto: la racha no se rompe hasta que termina el día.
    expect(mine.stats.streak).toBe(2);
  });
});

describe("cambiar la meta no reescribe la historia", () => {
  it("días pasados conservan su meta; hoy adopta la nueva", async () => {
    const h = await habit({ dailyTarget: 2 });
    await call("POST", `/habits/${h.id}/logs`, { date: daysAgo(1), count: 2 }); // cumplido con meta 2
    await call("POST", `/habits/${h.id}/logs`, { date: today(), count: 2 });
    await call("PUT", `/habits/${h.id}`, { dailyTarget: 5 });
    const yesterday = await call("GET", `/habits/${h.id}/progress?date=${daysAgo(1)}`);
    expect(yesterday).toMatchObject({ count: 2, target: 2, done: true });
    const now = await call("GET", `/habits/${h.id}/progress`);
    expect(now).toMatchObject({ count: 2, target: 5, done: false, percent: 40 });
  });

  it("registros heredados sin meta guardada se leen como cumplidos (igual que antes)", () => {
    const habitRow = { dailyTarget: 8 } as any;
    expect(logTarget({ count: 1 } as any, habitRow)).toBe(1);
    expect(logTarget({ count: 3, target: 8 } as any, habitRow)).toBe(8);
  });
});

describe("registros duplicados", () => {
  it("dos filas del mismo día (sincronización antigua) se leen como una y se unifican al registrar", async () => {
    const h = await habit({ dailyTarget: 4 });
    const db = loadDb();
    const date = today();
    const ts = new Date().toISOString();
    db.habitLogs.push(
      { id: "legacy-a", habitId: h.id, date, count: 2, note: null, target: 4, createdAt: ts, updatedAt: ts },
      { id: "legacy-b", habitId: h.id, date, count: 3, note: null, target: 4, createdAt: ts, updatedAt: ts }
    );
    expect(logsByDay(db.habitLogs.filter((l) => l.habitId === h.id)).get(localDateKey())!.count).toBe(3);
    // No se suman (serían la misma realización vista desde dos dispositivos).
    expect(habitStats(db.habits.find((x) => x.id === h.id)!, db.habitLogs).today.count).toBe(3);
    await call("POST", `/habits/${h.id}/logs`, { date });
    const after = loadDb().habitLogs.filter((l) => l.habitId === h.id);
    expect(after).toHaveLength(1);
    expect(after[0].count).toBe(4);
  });

  it("el id del registro es determinista por (hábito, día)", async () => {
    const h = await habit();
    const a = await call("POST", `/habits/${h.id}/logs`, { date: today() });
    const b = await call("POST", `/habits/${h.id}/logs`, { date: today() });
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(`hl-${h.id}-${today().slice(0, 10)}`);
  });
});

describe("funciones puras de progreso", () => {
  it("nextCount: +1 por defecto, delta, valor fijo y límites", () => {
    expect(nextCount(0, {})).toBe(1);
    expect(nextCount(4, { delta: -1 })).toBe(3);
    expect(nextCount(0, { delta: -1 })).toBe(0);
    expect(nextCount(2, { count: 7 })).toBe(7);
    expect(nextCount(0, { count: 99999999 })).toBe(10000);
  });

  it("progressOf nunca pasa de 100 %", () => {
    expect(progressOf(12, 8, "x").percent).toBe(100);
    expect(progressOf(1, 8, "x").percent).toBe(12.5);
  });
});

describe("migración v6", () => {
  it("añade las colecciones nuevas sin tocar hábitos ni registros existentes", () => {
    const v5 = {
      version: 5,
      settings: { id: 1 },
      habits: [{ id: "h1", name: "Leer", dailyTarget: 1, color: "#000", archived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
      habitLogs: [{ id: "l1", habitId: "h1", date: "2026-01-01T05:00:00.000Z", count: 1, note: null, createdAt: "x", updatedAt: "x" }],
    };
    const before = JSON.stringify({ h: v5.habits, l: v5.habitLogs });
    const db = migrate(structuredClone(v5));
    expect(DB_VERSION).toBe(6);
    expect(db.habitSchedules).toEqual([]);
    expect(db.gcalLinks).toEqual([]);
    expect(db.habitImports).toEqual([]);
    expect(JSON.stringify({ h: db.habits, l: db.habitLogs })).toBe(before);
  });

  it("la copia de seguridad incluye y restaura programaciones", async () => {
    const h = await habit();
    await call("POST", `/habits/${h.id}/schedules`, { kind: "once", startTime: "07:00", startDate: "2026-09-30" });
    const backup = await call("GET", "/backup/export");
    expect(backup.data.habitSchedules).toHaveLength(1);
    await call("POST", "/backup/import", { data: backup.data, replace: true });
    expect(loadDb().habitSchedules).toHaveLength(1);
  });
});

describe("sincronización PC ↔ móvil", () => {
  it("horarios, vínculos e importaciones forman parte del espacio sincronizable", async () => {
    const { entriesOf, referencesOf } = await import("@/services/manualsync/keyspace");
    const h = await habit();
    const s = await call("POST", `/habits/${h.id}/schedules`, { kind: "once", startTime: "07:00", startDate: "2026-09-30" });
    await call("POST", "/habit-imports/apply", { items: [{ title: "Beber agua", date: "2026-09-29", habitId: h.id, action: "scheduled" }] });
    const keys = [...entriesOf(loadDb()).keys()];
    expect(keys).toContain(`habitSchedules:${s.id}`);
    expect(keys.some((k) => k.startsWith("habitImports:imp-"))).toBe(true);
    // El horario arrastra a su hábito si se envía solo.
    expect(referencesOf("habitSchedules", s)).toEqual([`habits:${h.id}`]);
  });
});
