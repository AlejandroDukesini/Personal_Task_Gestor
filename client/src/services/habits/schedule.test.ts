import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDb, type HabitScheduleRow } from "@/services/localDb";
import { call, expectStatus } from "@/test/helpers";
import {
  addDays,
  describeSchedule,
  expandSchedule,
  occursOn,
  wallClock,
  withStatus,
  zonedToUtc,
} from "./schedule";

const TZ = "America/Bogota";

function rule(over: Partial<HabitScheduleRow> = {}): HabitScheduleRow {
  return {
    id: "s1",
    habitId: "h1",
    kind: "recurring",
    freq: "weekly",
    interval: 1,
    daysOfWeek: [1, 3, 5],
    startTime: "20:00",
    endTime: "20:30",
    startDate: "2026-09-28",
    endDate: null,
    timezone: TZ,
    active: true,
    inactiveFrom: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const range = (a: string, b: string) => [new Date(`${a}T00:00:00Z`), new Date(`${b}T23:59:59Z`)] as const;

describe("zonas horarias", () => {
  it("convierte hora de pared a UTC y vuelta", () => {
    expect(zonedToUtc("2026-09-30", "07:00", TZ).toISOString()).toBe("2026-09-30T12:00:00.000Z");
    expect(zonedToUtc("2026-09-30", "07:00", "Europe/Madrid").toISOString()).toBe("2026-09-30T05:00:00.000Z");
    expect(wallClock(new Date("2026-09-30T12:00:00Z"), TZ)).toEqual({ dateKey: "2026-09-30", time: "07:00" });
  });

  it("respeta el cambio de horario de verano (Madrid, marzo)", () => {
    expect(zonedToUtc("2026-03-28", "08:00", "Europe/Madrid").toISOString()).toBe("2026-03-28T07:00:00.000Z");
    expect(zonedToUtc("2026-03-30", "08:00", "Europe/Madrid").toISOString()).toBe("2026-03-30T06:00:00.000Z");
  });
});

describe("reglas de programación", () => {
  it("horario único: solo su fecha", () => {
    const s = rule({ kind: "once", startDate: "2026-09-30", startTime: "07:00", endTime: "08:00" });
    const occ = expandSchedule(s, ...range("2026-09-01", "2026-10-31"));
    expect(occ).toHaveLength(1);
    expect(occ[0]).toMatchObject({ dateKey: "2026-09-30", start: "2026-09-30T12:00:00.000Z", end: "2026-09-30T13:00:00.000Z", recurring: false });
  });

  it("semanal lunes, miércoles y viernes", () => {
    const occ = expandSchedule(rule(), ...range("2026-09-28", "2026-10-11"));
    expect(occ.map((o) => o.dateKey)).toEqual(["2026-09-28", "2026-09-30", "2026-10-02", "2026-10-05", "2026-10-07", "2026-10-09"]);
  });

  it("cada 2 semanas, diario cada 3 días y mensual", () => {
    const biweekly = expandSchedule(rule({ daysOfWeek: [1], interval: 2 }), ...range("2026-09-28", "2026-10-31"));
    expect(biweekly.map((o) => o.dateKey)).toEqual(["2026-09-28", "2026-10-12", "2026-10-26"]);
    const every3 = expandSchedule(rule({ freq: "daily", interval: 3 }), ...range("2026-09-28", "2026-10-08"));
    expect(every3.map((o) => o.dateKey)).toEqual(["2026-09-28", "2026-10-01", "2026-10-04", "2026-10-07"]);
    const monthly = expandSchedule(rule({ freq: "monthly", startDate: "2026-01-31" }), ...range("2026-01-01", "2026-06-01"));
    expect(monthly.map((o) => o.dateKey)).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]); // meses sin día 31 se saltan
  });

  it("respeta fecha de inicio y de finalización", () => {
    const s = rule({ startDate: "2026-09-30", endDate: "2026-10-05" });
    expect(expandSchedule(s, ...range("2026-09-01", "2026-12-31")).map((o) => o.dateKey)).toEqual([
      "2026-09-30",
      "2026-10-02",
      "2026-10-05",
    ]);
  });

  it("una regla desactivada conserva las ocurrencias pasadas y corta las futuras", () => {
    const s = rule({ active: false, inactiveFrom: "2026-10-05" });
    const keys = expandSchedule(s, ...range("2026-09-28", "2026-10-31")).map((o) => o.dateKey);
    expect(keys).toEqual(["2026-09-28", "2026-09-30", "2026-10-02"]);
    expect(occursOn(s, "2026-10-05")).toBe(false);
  });

  it("describe la programación en español", () => {
    expect(describeSchedule(rule())).toBe("Lun, Mié, Vie · 20:00–20:30");
    expect(describeSchedule(rule({ kind: "once", startDate: "2026-09-30", endTime: null, startTime: "07:00" }))).toBe("30/09/2026 · 07:00");
  });
});

describe("estados en el calendario", () => {
  const habit = { id: "h1", dailyTarget: 8, archived: false } as any;
  const eight = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00"].map((t, i) =>
    rule({ id: `w${i}`, kind: "recurring", freq: "daily", startTime: t, endTime: null, startDate: "2026-09-01" })
  );

  it("varias horas al día: la meta se reparte entre las franjas", () => {
    const now = new Date("2026-09-30T17:30:00Z"); // 12:30 en Bogotá
    const occ = eight.flatMap((s) => expandSchedule(s, new Date("2026-09-30T05:00:00Z"), new Date("2026-10-01T04:59:00Z")));
    expect(occ).toHaveLength(8);
    const logDate = new Date(2026, 8, 30).toISOString();
    const logs = [{ id: "l", habitId: "h1", date: logDate, count: 3, target: 8, note: null, createdAt: "", updatedAt: "" }];
    const st = withStatus(occ, [habit], logs as any, now);
    expect(st.map((o) => o.threshold)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(st.filter((o) => o.status === "completed")).toHaveLength(3);
  });

  it("aparecer en el calendario NO cuenta como realizado; pasado sin registro = incumplido", () => {
    const s = rule({ freq: "daily", daysOfWeek: [], startDate: "2026-09-27" });
    const habitOne = { id: "h1", dailyTarget: 1, archived: false } as any;
    const now = new Date(2026, 8, 30, 12, 0);
    const occ = expandSchedule(s, new Date(2026, 8, 27), new Date(2026, 9, 2, 23));
    const logs = [{ id: "l", habitId: "h1", date: new Date(2026, 8, 28).toISOString(), count: 1, target: 1, note: null, createdAt: "", updatedAt: "" }];
    const byDay = Object.fromEntries(withStatus(occ, [habitOne], logs as any, now).map((o) => [o.logDate, o.status]));
    expect(byDay["2026-09-27"]).toBe("missed");
    expect(byDay["2026-09-28"]).toBe("completed");
    expect(byDay["2026-09-29"]).toBe("missed");
    expect(byDay["2026-09-30"]).toBe("pending");
    expect(byDay["2026-10-01"]).toBe("scheduled");
  });

  it("en curso y parcial", () => {
    const s = rule({ freq: "daily", daysOfWeek: [], startDate: "2026-09-30", startTime: "12:00", endTime: "13:00", timezone: "UTC" });
    const h2 = { id: "h1", dailyTarget: 2, archived: false } as any;
    const occ = expandSchedule(s, new Date("2026-09-30T00:00:00Z"), new Date("2026-09-30T23:00:00Z"));
    const inProgress = withStatus(occ, [h2], [], new Date("2026-09-30T12:30:00Z"));
    expect(inProgress[0].status).toBe("in_progress");
    const logDate = new Date(new Date("2026-09-30T12:00:00Z").setHours(0, 0, 0, 0)).toISOString();
    const partial = withStatus(occ, [h2], [{ id: "l", habitId: "h1", date: logDate, count: 1, target: 2 }] as any, new Date("2026-09-30T14:00:00Z"));
    expect(partial[0].status).toBe("partial");
  });
});

describe("rutas de programación y calendario interno", () => {
  afterEach(() => vi.useRealTimers());

  async function makeHabit() {
    return call("POST", "/habits", { name: "Leer", dailyTarget: 1 });
  }

  it("crea, lista y muestra en el calendario un horario recurrente sin guardar ocurrencias", async () => {
    const h = await makeHabit();
    await call("POST", `/habits/${h.id}/schedules`, {
      kind: "recurring",
      freq: "weekly",
      daysOfWeek: [1, 3, 5],
      startTime: "20:00",
      endTime: "20:30",
      startDate: "2026-09-28",
      timezone: TZ,
    });
    const cal = await call("GET", `/habits/calendar?from=2026-09-28T00:00:00Z&to=2026-10-04T23:59:59Z`);
    expect(cal.map((o: any) => o.dateKey)).toEqual(["2026-09-28", "2026-09-30", "2026-10-02"]);
    expect(cal[0].habit).toMatchObject({ name: "Leer" });
    expect(loadDb().habitSchedules).toHaveLength(1); // una regla, no N eventos
  });

  it("valida horas, días y zona horaria", async () => {
    const h = await makeHabit();
    await expectStatus(400, call("POST", `/habits/${h.id}/schedules`, { kind: "once", startTime: "25:00", startDate: "2026-09-30" }));
    await expectStatus(400, call("POST", `/habits/${h.id}/schedules`, { kind: "once", startTime: "08:00", endTime: "07:00", startDate: "2026-09-30" }));
    await expectStatus(400, call("POST", `/habits/${h.id}/schedules`, { kind: "recurring", freq: "weekly", daysOfWeek: [], startTime: "08:00", startDate: "2026-09-30" }));
    await expectStatus(400, call("POST", `/habits/${h.id}/schedules`, { kind: "once", startTime: "08:00", startDate: "2026-09-30", timezone: "Marte/Olympus" }));
  });

  it("varios horarios en el mismo día, editables y borrables por separado (PUT idempotente)", async () => {
    const h = await call("POST", "/habits", { name: "Tomar agua", dailyTarget: 8 });
    const times = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00"];
    const base = { kind: "recurring", freq: "daily", startDate: "2026-09-30", timezone: TZ };
    let list = await call("PUT", `/habits/${h.id}/schedules`, { schedules: times.map((t) => ({ ...base, startTime: t })) });
    expect(list).toHaveLength(8);
    // Reenviar lo mismo no duplica ni reescribe.
    const stamp = loadDb().habitSchedules.map((s) => s.updatedAt).join();
    list = await call("PUT", `/habits/${h.id}/schedules`, { schedules: list });
    expect(list).toHaveLength(8);
    expect(loadDb().habitSchedules.map((s) => s.updatedAt).join()).toBe(stamp);
    // Editar una y quitar otra.
    const edited = list.map((s: any) => (s.startTime === "22:00" ? { ...s, startTime: "21:30" } : s)).filter((s: any) => s.startTime !== "08:00");
    list = await call("PUT", `/habits/${h.id}/schedules`, { schedules: edited, applyFrom: "all" });
    expect(list.map((s: any) => s.startTime).sort()).toEqual(["10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "21:30"]);
    const cal = await call("GET", `/habits/calendar?from=2026-09-30T05:00:00Z&to=2026-10-01T04:59:00Z`);
    expect(cal).toHaveLength(7);
    // Aparecer en el calendario no registra nada.
    expect(loadDb().habitLogs.filter((l) => l.habitId === h.id)).toHaveLength(0);
  });

  it("cambiar la hora de una regla ya empezada solo afecta a los eventos futuros", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T15:00:00Z"));
    const h = await makeHabit();
    const s = await call("POST", `/habits/${h.id}/schedules`, {
      kind: "recurring", freq: "weekly", daysOfWeek: [1, 3, 5], startTime: "20:00", endTime: "20:30", startDate: "2026-09-21", timezone: TZ,
    });
    await call("PUT", `/habit-schedules/${s.id}`, { ...s, startTime: "19:00", endTime: "19:30" });
    const rows = loadDb().habitSchedules;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === s.id)!.endDate).toBe("2026-09-29");
    const fresh = rows.find((r) => r.id !== s.id)!;
    expect(fresh).toMatchObject({ startDate: "2026-09-30", startTime: "19:00" });
    const cal = await call("GET", `/habits/calendar?from=2026-09-28T05:00:00Z&to=2026-10-03T04:59:00Z`);
    const hours = cal.map((o: any) => [o.dateKey, wallClock(new Date(o.start), TZ).time]);
    expect(hours).toEqual([
      ["2026-09-28", "20:00"],
      ["2026-09-30", "19:00"],
      ["2026-10-02", "19:00"],
    ]);
  });

  it("cambiar la zona horaria mueve las ocurrencias", async () => {
    const h = await makeHabit();
    const s = await call("POST", `/habits/${h.id}/schedules`, { kind: "once", startTime: "07:00", startDate: "2026-12-01", timezone: TZ });
    const updated = await call("PUT", `/habit-schedules/${s.id}`, { ...s, timezone: "Europe/Madrid" });
    expect(updated.timezone).toBe("Europe/Madrid");
    const [o] = await call("GET", `/habits/calendar?from=2026-11-30T00:00:00Z&to=2026-12-02T00:00:00Z`);
    expect(o.start).toBe("2026-12-01T06:00:00.000Z");
  });

  it("desactivar y eliminar una programación conserva el historial", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T15:00:00Z"));
    const h = await makeHabit();
    const s = await call("POST", `/habits/${h.id}/schedules`, {
      kind: "recurring", freq: "daily", startTime: "07:00", startDate: "2026-09-25", timezone: TZ,
    });
    await call("POST", `/habits/${h.id}/logs`, { date: new Date(2026, 8, 29).toISOString() });
    const off = await call("PATCH", `/habit-schedules/${s.id}/active`, { active: false });
    expect(off.inactiveFrom).toBe("2026-09-30");
    const cal = await call("GET", `/habits/calendar?from=2026-09-25T05:00:00Z&to=2026-10-05T04:59:00Z`);
    expect(cal.at(-1).dateKey).toBe("2026-09-29");
    await call("DELETE", `/habit-schedules/${s.id}`);
    expect(loadDb().habitSchedules).toHaveLength(0);
    expect(loadDb().habitLogs.filter((l) => l.habitId === h.id)).toHaveLength(1);
    expect(loadDb().tombstones.some((t) => t.collection === "habitSchedules" && t.id === s.id)).toBe(true);
  });

  it("los hábitos ocultos en el calendario o archivados no aparecen", async () => {
    const h = await makeHabit();
    await call("POST", `/habits/${h.id}/schedules`, { kind: "once", startTime: "07:00", startDate: "2026-09-30", timezone: TZ });
    await call("PUT", `/habits/${h.id}`, { showInCalendar: false });
    expect(await call("GET", `/habits/calendar?from=2026-09-29T00:00:00Z&to=2026-10-01T00:00:00Z`)).toHaveLength(0);
  });

  it("borrar un hábito borra sus programaciones", async () => {
    const h = await makeHabit();
    await call("POST", `/habits/${h.id}/schedules`, { kind: "once", startTime: "07:00", startDate: "2026-09-30" });
    await call("DELETE", `/habits/${h.id}`);
    expect(loadDb().habitSchedules).toHaveLength(0);
  });

  it("addDays cruza meses y años", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
