import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDb } from "@/services/localDb";
import { call } from "@/test/helpers";
import { GcalError, classify, createGcalClient, type CalendarListItem, type GcalApi } from "./client";
import {
  buildEvent,
  eventIdFor,
  googleColorId,
  rruleFor,
  scheduleFromEvent,
  timingHash,
  type GcalEvent,
} from "./payload";
import { runGcalSync, resolveLink, linkIdFor, type SyncOptions } from "./sync";
import { __setTokenForTests } from "./auth";
import { __setClientForTests, connect, disconnect, syncNow } from "./service";
import { loadPrefs, savePrefs } from "./prefs";

const TZ = "America/Bogota";
const CAL = "cal-1";

/* ------------------------------------------------ Google Calendar falso */

class FakeGcal implements GcalApi {
  cals = new Map<string, Map<string, GcalEvent>>([[CAL, new Map()]]);
  version = 0;
  calls: string[] = [];
  /** Errores a inyectar por operación. */
  failures: Partial<Record<string, GcalError[]>> = {};
  /** Simula "se creó en Google pero la respuesta se perdió". */
  loseInsertResponse = false;

  private cal(id: string) {
    const c = this.cals.get(id);
    if (!c) throw new GcalError("not_found", 404, "no cal");
    return c;
  }
  private maybeFail(op: string) {
    const f = this.failures[op]?.shift();
    if (f) throw f;
  }
  private stamp(ev: GcalEvent): GcalEvent {
    this.version++;
    return { ...structuredClone(ev), etag: `"v${this.version}"`, updated: new Date(Date.UTC(2026, 0, 1) + this.version * 1000).toISOString() };
  }
  async listCalendars(): Promise<CalendarListItem[]> {
    return [...this.cals.keys()].map((id) => ({ id, summary: id, accessRole: "owner" }));
  }
  async createCalendar(summary: string): Promise<CalendarListItem> {
    const id = `created-${this.cals.size}`;
    this.cals.set(id, new Map());
    return { id, summary };
  }
  async listAppEvents(calendarId: string) {
    this.calls.push("list");
    this.maybeFail("list");
    return [...this.cal(calendarId).values()].filter((e) => e.extendedProperties?.private?.gtApp === "gestion-tareas").map((e) => structuredClone(e));
  }
  async getEvent(calendarId: string, id: string) {
    const e = this.cal(calendarId).get(id);
    if (!e) throw new GcalError("not_found", 404, "no");
    return structuredClone(e);
  }
  async insertEvent(calendarId: string, ev: GcalEvent) {
    this.calls.push("insert");
    this.maybeFail("insert");
    const c = this.cal(calendarId);
    if (c.has(ev.id)) throw new GcalError("conflict", 409, "dup");
    const saved = this.stamp({ ...ev, status: "confirmed" });
    c.set(ev.id, saved);
    if (this.loseInsertResponse) {
      this.loseInsertResponse = false;
      throw new GcalError("network", 0, "respuesta perdida");
    }
    return structuredClone(saved);
  }
  async updateEvent(calendarId: string, ev: GcalEvent, etag?: string) {
    this.calls.push("update");
    this.maybeFail("update");
    const c = this.cal(calendarId);
    const cur = c.get(ev.id);
    if (!cur) throw new GcalError("not_found", 404, "no");
    if (etag && cur.etag !== etag) throw new GcalError("precondition", 412, "etag");
    const saved = this.stamp({ ...ev, status: "confirmed" });
    c.set(ev.id, saved);
    return structuredClone(saved);
  }
  async patchEvent(calendarId: string, id: string, patch: Partial<GcalEvent>, etag?: string) {
    this.calls.push("patch");
    const c = this.cal(calendarId);
    const cur = c.get(id);
    if (!cur) throw new GcalError("not_found", 404, "no");
    if (etag && cur.etag !== etag) throw new GcalError("precondition", 412, "etag");
    const saved = this.stamp({ ...cur, ...patch });
    c.set(id, saved);
    return structuredClone(saved);
  }
  async deleteEvent(calendarId: string, id: string, etag?: string) {
    this.calls.push("delete");
    const c = this.cal(calendarId);
    const cur = c.get(id);
    if (!cur) throw new GcalError("not_found", 404, "no");
    if (etag && cur.etag !== etag) throw new GcalError("precondition", 412, "etag");
    c.set(id, this.stamp({ ...cur, status: "cancelled" }));
  }
  /** Edición hecha por el usuario directamente en Google. */
  userEdit(id: string, patch: Partial<GcalEvent>) {
    const c = this.cal(CAL);
    c.set(id, this.stamp({ ...c.get(id)!, ...patch }));
  }
  alive() {
    return [...this.cal(CAL).values()].filter((e) => e.status !== "cancelled");
  }
}

let fake: FakeGcal;
const opts = (over: Partial<SyncOptions> = {}): SyncOptions => ({
  gcal: fake,
  calendarId: CAL,
  scope: "all",
  remoteChanges: "ask",
  now: new Date("2026-09-30T15:00:00Z"),
  ...over,
});

async function habitWith(schedules: Record<string, unknown>[], over: Record<string, unknown> = {}) {
  const h = await call("POST", "/habits", { name: "Leer", dailyTarget: 1, color: "#8b5cf6", ...over });
  const list = await call("PUT", `/habits/${h.id}/schedules`, { schedules });
  return { habit: h, schedules: list as any[] };
}

const weekly = {
  kind: "recurring",
  freq: "weekly",
  daysOfWeek: [1, 3, 5],
  startTime: "06:00",
  endTime: "07:00",
  startDate: "2026-10-05",
  timezone: TZ,
};

beforeEach(() => {
  fake = new FakeGcal();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T15:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  __setClientForTests(null);
  __setTokenForTests(null);
});

/* ---------------------------------------------------------------- payload */

describe("conversión programación → evento de Google", () => {
  const sched = (over: Record<string, unknown> = {}) =>
    ({ id: "sch-1", habitId: "h", ...weekly, interval: 1, endDate: null, active: true, inactiveFrom: null, createdAt: "", updatedAt: "", ...over }) as any;
  const habit = { id: "h", name: "Ejercicio", dailyTarget: 1, color: "#10b981", unit: null } as any;

  it("id determinista válido (base32hex) y propiedades privadas de la app", () => {
    const id = eventIdFor("3f2a-uuid");
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(eventIdFor("3f2a-uuid")).toBe(id);
    const ev = buildEvent(sched(), habit)!;
    expect(ev.extendedProperties?.private).toMatchObject({ gtApp: "gestion-tareas", gtScheduleId: "sch-1", gtHabitId: "h" });
    expect(ev.description).toContain("registra la realización en la app");
  });

  it("recurrencia semanal lunes, miércoles y viernes con una sola regla RRULE", () => {
    const ev = buildEvent(sched(), habit)!;
    expect(ev.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]);
    expect(ev.start).toEqual({ dateTime: "2026-10-05T06:00:00", timeZone: TZ });
    expect(ev.end).toEqual({ dateTime: "2026-10-05T07:00:00", timeZone: TZ });
  });

  it("el inicio es la primera ocurrencia real (si la fecha de inicio no cae en un día elegido)", () => {
    const ev = buildEvent(sched({ startDate: "2026-10-04" }), habit)!; // domingo
    expect(ev.start?.dateTime).toBe("2026-10-05T06:00:00");
  });

  it("fin de la recurrencia (UNTIL en UTC), intervalos, diario, mensual y único", () => {
    expect(rruleFor(sched({ endDate: "2026-12-31", interval: 2 }))).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;UNTIL=20270101T045959Z");
    expect(rruleFor(sched({ freq: "daily", interval: 3 }))).toBe("RRULE:FREQ=DAILY;INTERVAL=3");
    expect(rruleFor(sched({ freq: "monthly", startDate: "2026-10-15" }))).toBe("RRULE:FREQ=MONTHLY;BYMONTHDAY=15");
    expect(buildEvent(sched({ kind: "once", startDate: "2026-10-01" }), habit)!.recurrence).toBeUndefined();
  });

  it("sin hora de fin se asume 30 min; color aproximado de Google", () => {
    const ev = buildEvent(sched({ endTime: null, startTime: "23:45" }), habit)!;
    expect(ev.end?.dateTime).toBe("2026-10-06T00:15:00");
    expect(googleColorId("#10b981")).toBe("2");
  });

  it("la huella horaria coincide con la forma en que Google devuelve el evento", () => {
    const ev = buildEvent(sched(), habit)!;
    const fromGoogle: GcalEvent = {
      ...ev,
      start: { dateTime: "2026-10-05T06:00:00-05:00", timeZone: TZ },
      end: { dateTime: "2026-10-05T07:00:00-05:00", timeZone: TZ },
      recurrence: ["RRULE:BYDAY=FR,MO,WE;FREQ=WEEKLY;INTERVAL=1"],
    };
    expect(timingHash(fromGoogle)).toBe(timingHash(ev));
  });

  it("Google → programación: acepta lo representable y rechaza lo que no", () => {
    const current = sched();
    const moved: GcalEvent = {
      id: "x",
      start: { dateTime: "2026-10-06T18:00:00-05:00", timeZone: TZ },
      end: { dateTime: "2026-10-06T19:00:00-05:00", timeZone: TZ },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20270101T045959Z"],
    };
    const r = scheduleFromEvent(moved, current);
    expect(r.ok && r.schedule).toMatchObject({ kind: "recurring", freq: "weekly", daysOfWeek: [2, 4], startTime: "18:00", endTime: "19:00", endDate: "2026-12-31" });
    const count = scheduleFromEvent({ ...moved, recurrence: ["RRULE:FREQ=WEEKLY;COUNT=5"] }, current);
    expect(count.ok).toBe(false);
    const allDay = scheduleFromEvent({ id: "x", start: { date: "2026-10-06" }, end: { date: "2026-10-07" } }, current);
    expect(allDay.ok).toBe(false);
  });
});

/* ------------------------------------------------------------ sincronización */

describe("sincronización con Google Calendar", () => {
  it("crea un evento recurrente por programación y repetir no duplica", async () => {
    await habitWith([weekly, { ...weekly, startTime: "18:00", endTime: "18:30" }]);
    const r1 = await runGcalSync(opts());
    expect(r1.created).toBe(2);
    expect(fake.alive()).toHaveLength(2);
    expect(fake.alive().every((e) => e.recurrence?.length === 1)).toBe(true);
    const r2 = await runGcalSync(opts());
    const r3 = await runGcalSync(opts());
    expect(r2.created + r3.created).toBe(0);
    expect(r3.unchanged).toBe(2);
    expect(fake.calls.filter((c) => c === "insert")).toHaveLength(2);
    expect(loadDb().gcalLinks.every((l) => l.state === "synced")).toBe(true);
  });

  it("modificar el horario actualiza el evento vinculado", async () => {
    const { schedules } = await habitWith([weekly]);
    await runGcalSync(opts());
    await call("PUT", `/habit-schedules/${schedules[0].id}`, { ...schedules[0], startTime: "05:30", endTime: "06:30", applyFrom: "all" });
    const r = await runGcalSync(opts());
    expect(r.updated).toBe(1);
    expect(fake.alive()[0].start?.dateTime).toBe("2026-10-05T05:30:00");
  });

  it("renombrar el hábito actualiza el título en Google", async () => {
    const { habit } = await habitWith([weekly]);
    await runGcalSync(opts());
    await call("PUT", `/habits/${habit.id}`, { name: "Lectura nocturna" });
    expect((await runGcalSync(opts())).updated).toBe(1);
    expect(fake.alive()[0].summary).toBe("Lectura nocturna");
  });

  it("eliminar una programación con «quitar de Google» borra el evento futuro; con «mantener» no lo toca", async () => {
    const { schedules } = await habitWith([
      { kind: "once", startTime: "07:00", endTime: "08:00", startDate: "2026-10-10", timezone: TZ },
      { kind: "once", startTime: "09:00", startDate: "2026-10-11", timezone: TZ },
    ]);
    await runGcalSync(opts());
    await call("DELETE", `/habit-schedules/${schedules[0].id}?remote=future`);
    await call("DELETE", `/habit-schedules/${schedules[1].id}?remote=keep`);
    const r = await runGcalSync(opts());
    expect(r.deleted).toBe(1);
    expect(fake.alive().map((e) => e.start?.dateTime)).toEqual(["2026-10-11T09:00:00"]);
    expect(loadDb().gcalLinks).toHaveLength(0);
  });

  it("al quitar una serie ya empezada se conservan los eventos pasados (se recorta la repetición)", async () => {
    const { schedules } = await habitWith([{ ...weekly, startDate: "2026-09-01" }]);
    await runGcalSync(opts());
    await call("DELETE", `/habit-schedules/${schedules[0].id}?remote=future`);
    await runGcalSync(opts());
    const [ev] = fake.alive();
    expect(ev.recurrence?.[0]).toContain("UNTIL=20260930T045959Z"); // fin del 29-sep en Bogotá
  });

  it("nunca modifica eventos ajenos a la app", async () => {
    const foreign: GcalEvent = { id: "ajeno1", summary: "Cita médica", start: { dateTime: "2026-10-05T06:00:00", timeZone: TZ }, end: { dateTime: "2026-10-05T07:00:00", timeZone: TZ } };
    fake.cals.get(CAL)!.set(foreign.id, { ...foreign, etag: '"f"' });
    const { schedules } = await habitWith([weekly]);
    await runGcalSync(opts());
    await call("DELETE", `/habit-schedules/${schedules[0].id}?remote=future`);
    await runGcalSync(opts());
    expect(fake.cals.get(CAL)!.get("ajeno1")).toEqual({ ...foreign, etag: '"f"' });
  });

  it("reintento tras perder la respuesta de red: no se duplica el evento", async () => {
    await habitWith([weekly]);
    fake.loseInsertResponse = true;
    const r1 = await runGcalSync(opts());
    expect(r1.errors).toHaveLength(1);
    expect(loadDb().gcalLinks[0].state).toBe("error");
    const r2 = await runGcalSync(opts());
    expect(r2.errors).toHaveLength(0);
    expect(r2.adopted).toBe(1);
    expect(fake.alive()).toHaveLength(1);
    expect(loadDb().gcalLinks[0].state).toBe("synced");
  });

  it("dos dispositivos (o vínculos perdidos) no crean eventos duplicados", async () => {
    await habitWith([weekly]);
    await runGcalSync(opts());
    // Otro dispositivo sin los vínculos: los reconstruye adoptando los eventos.
    await call("DELETE", `/gcal/links/${loadDb().gcalLinks[0].id}`);
    const r = await runGcalSync(opts());
    expect(r.created).toBe(0);
    expect(r.adopted).toBe(1);
    expect(fake.alive()).toHaveLength(1);
  });

  it("cambio de horario hecho en Google: con «preguntar» se marca y no se aplica", async () => {
    const { schedules } = await habitWith([weekly]);
    await runGcalSync(opts());
    const id = eventIdFor(schedules[0].id);
    fake.userEdit(id, { start: { dateTime: "2026-10-05T08:00:00-05:00", timeZone: TZ }, end: { dateTime: "2026-10-05T09:00:00-05:00", timeZone: TZ } });
    const r = await runGcalSync(opts());
    expect(r.conflicts).toBe(1);
    expect(loadDb().gcalLinks[0].state).toBe("remote_changed");
    expect(loadDb().habitSchedules[0].startTime).toBe("06:00");
    // El usuario decide aceptar la versión de Google.
    await resolveLink(opts(), linkIdFor(schedules[0].id), "remote");
    expect(loadDb().habitSchedules[0]).toMatchObject({ startTime: "08:00", endTime: "09:00" });
    expect(loadDb().gcalLinks[0].state).toBe("synced");
    expect((await runGcalSync(opts())).unchanged).toBe(1);
  });

  it("cambio en Google con «aplicar automáticamente»: actualiza la programación, nunca el historial", async () => {
    const { schedules, habit } = await habitWith([weekly]);
    await runGcalSync(opts());
    fake.userEdit(eventIdFor(schedules[0].id), { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU,TH"] });
    const r = await runGcalSync(opts({ remoteChanges: "apply" }));
    expect(r.remoteApplied).toBe(1);
    expect(loadDb().habitSchedules[0].daysOfWeek).toEqual([2, 4]);
    expect(loadDb().habitLogs.filter((l) => l.habitId === habit.id)).toHaveLength(0);
    const again = await runGcalSync(opts({ remoteChanges: "apply" }));
    expect(again.updated + again.remoteApplied + again.conflicts).toBe(0);
  });

  it("cambios en ambos lados: conflicto, nada se sobrescribe hasta que el usuario elige", async () => {
    const { schedules } = await habitWith([weekly]);
    await runGcalSync(opts());
    fake.userEdit(eventIdFor(schedules[0].id), { start: { dateTime: "2026-10-05T08:00:00-05:00", timeZone: TZ }, end: { dateTime: "2026-10-05T09:00:00-05:00", timeZone: TZ } });
    await call("PUT", `/habit-schedules/${schedules[0].id}`, { ...schedules[0], startTime: "05:00", endTime: "05:45", applyFrom: "all" });
    const r = await runGcalSync(opts({ remoteChanges: "apply" }));
    expect(r.conflicts).toBe(1);
    expect(loadDb().gcalLinks[0]).toMatchObject({ state: "conflict" });
    expect(loadDb().gcalLinks[0].remote).toMatchObject({ start: "08:00" });
    expect(fake.alive()[0].start?.dateTime).toContain("08:00");
    await resolveLink(opts(), linkIdFor(schedules[0].id), "local");
    expect(fake.alive()[0].start?.dateTime).toBe("2026-10-05T05:00:00");
    expect(loadDb().gcalLinks[0].state).toBe("synced");
  });

  it("evento borrado por el usuario en Google: no se recrea solo; se puede recrear a petición", async () => {
    const { schedules } = await habitWith([weekly]);
    await runGcalSync(opts());
    await fake.deleteEvent(CAL, eventIdFor(schedules[0].id));
    const r = await runGcalSync(opts());
    expect(r.remoteDeleted).toBe(1);
    expect(fake.alive()).toHaveLength(0);
    expect(loadDb().gcalLinks[0].state).toBe("remote_deleted");
    expect(loadDb().habitSchedules).toHaveLength(1); // la programación de la app se conserva
    await resolveLink(opts(), linkIdFor(schedules[0].id), "recreate");
    expect(fake.alive()).toHaveLength(1);
  });

  it("modo «solo hábitos seleccionados»", async () => {
    await habitWith([weekly], { name: "A", gcalSync: true });
    await habitWith([weekly], { name: "B", gcalSync: false });
    const r = await runGcalSync(opts({ scope: "selected" }));
    expect(r.created).toBe(1);
    expect(fake.alive()[0].summary).toBe("A");
  });

  it("programación desactivada antes de empezar: se retira de Google", async () => {
    const { schedules } = await habitWith([{ ...weekly, startDate: "2026-10-12" }]);
    await runGcalSync(opts());
    await call("PATCH", `/habit-schedules/${schedules[0].id}/active`, { active: false });
    const r = await runGcalSync(opts());
    expect(r.deleted).toBe(1);
    expect(fake.alive()).toHaveLength(0);
  });

  it("un error de autorización detiene la sincronización sin tocar los datos locales", async () => {
    await habitWith([weekly]);
    const before = JSON.stringify(loadDb().habitSchedules);
    fake.failures.insert = [new GcalError("auth", 401, "caducó")];
    await expect(runGcalSync(opts())).rejects.toMatchObject({ kind: "auth" });
    expect(JSON.stringify(loadDb().habitSchedules)).toBe(before);
  });

  it("un fallo puntual (p. ej. 403 de permisos) se registra en el vínculo y el resto continúa", async () => {
    await habitWith([weekly, { ...weekly, startTime: "18:00", endTime: "18:30" }]);
    fake.failures.insert = [new GcalError("permission", 403, "Sin permiso")];
    const r = await runGcalSync(opts());
    expect(r.created).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(loadDb().gcalLinks.map((l) => l.state).sort()).toEqual(["error", "synced"]);
  });
});

/* ------------------------------------------------------------------ cliente */

describe("cliente HTTP de Google Calendar", () => {
  const TOKEN = "ya29.SECRETO-token";
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("clasifica los errores de la API", () => {
    expect(classify(401, {}).kind).toBe("auth");
    expect(classify(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }).kind).toBe("rate");
    expect(classify(403, {}).kind).toBe("permission");
    expect(classify(404, {}).kind).toBe("not_found");
    expect(classify(409, {}).kind).toBe("conflict");
    expect(classify(412, {}).kind).toBe("precondition");
    expect(classify(503, {}).kind).toBe("server");
  });

  it("reintenta 503 y errores de red con espera; no reintenta 400", async () => {
    const responses = [() => Promise.reject(new TypeError("net")), () => Promise.resolve(json(503, {})), () => Promise.resolve(json(200, { id: "e1" }))];
    const fetchImpl = vi.fn(() => responses.shift()!());
    const sleep = vi.fn(async () => undefined);
    const c = createGcalClient({ getToken: async () => TOKEN, fetchImpl: fetchImpl as any, sleep });
    expect(await c.getEvent("c", "e1")).toEqual({ id: "e1" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    const bad = vi.fn(async () => json(400, { error: { message: "Invalid start time" } }));
    const c2 = createGcalClient({ getToken: async () => TOKEN, fetchImpl: bad as any, sleep });
    await expect(c2.getEvent("c", "e")).rejects.toMatchObject({ kind: "bad_request" });
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("tras un 401 pide renovar el token una sola vez", async () => {
    const fetchImpl = vi.fn(async () => json(401, {}));
    const getToken = vi.fn(async (force?: boolean) => {
      if (force) throw new GcalError("auth", 401, "caducó");
      return TOKEN;
    });
    const c = createGcalClient({ getToken, fetchImpl: fetchImpl as any, sleep: async () => undefined });
    await expect(c.getEvent("c", "e")).rejects.toMatchObject({ kind: "auth" });
    expect(getToken).toHaveBeenCalledWith(true);
  });

  it("los mensajes de error nunca contienen el token; el token viaja solo en la cabecera", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      return json(500, { error: { message: "boom" } });
    });
    const c = createGcalClient({ getToken: async () => TOKEN, fetchImpl: fetchImpl as any, maxRetries: 0 });
    const err = await c.getEvent("c", "e").catch((e) => e);
    expect(String(err.message)).not.toContain(TOKEN);
  });

  it("envía If-Match para detectar ediciones simultáneas", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)["If-Match"]).toBe('"v1"');
      return json(412, {});
    });
    const c = createGcalClient({ getToken: async () => TOKEN, fetchImpl: fetchImpl as any });
    await expect(c.updateEvent("c", { id: "e" }, '"v1"')).rejects.toMatchObject({ kind: "precondition" });
  });
});

/* -------------------------------------------------- conexión y desconexión */

describe("conexión OAuth", () => {
  function mockGis(granted = true) {
    const revoke = vi.fn();
    let requested: string[] = [];
    (globalThis as any).window = {
      google: {
        accounts: {
          oauth2: {
            initTokenClient: (cfg: any) => {
              requested = cfg.scope.split(" ");
              return { requestAccessToken: () => cfg.callback({ access_token: "ya29.TOKEN-EN-MEMORIA", expires_in: 3600 }) };
            },
            hasGrantedAllScopes: () => granted,
            revoke,
          },
        },
      },
    };
    return { revoke, scopes: () => requested };
  }

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it("conectar pide solo el permiso mínimo, crea el calendario «Hábitos» y no guarda el token", async () => {
    const gis = mockGis();
    __setClientForTests(fake);
    savePrefs({ clientId: "123-abc.apps.googleusercontent.com" });
    await connect("dedicated");
    expect(gis.scopes()).toEqual(["https://www.googleapis.com/auth/calendar.app.created"]);
    const p = loadPrefs();
    expect(p.connected).toBe(true);
    expect(p.calendarId).toMatch(/^created-/);
    const everything = JSON.stringify(Object.fromEntries(Array.from({ length: localStorage.length }, (_, i) => [localStorage.key(i), localStorage.getItem(localStorage.key(i)!)])));
    expect(everything).not.toContain("ya29.TOKEN-EN-MEMORIA");
  });

  it("si no se conceden los permisos, no queda conectado", async () => {
    mockGis(false);
    __setClientForTests(fake);
    savePrefs({ clientId: "123-abc.apps.googleusercontent.com" });
    await expect(connect("existing")).rejects.toMatchObject({ kind: "permission" });
    expect(loadPrefs().connected).toBe(false);
  });

  it("sincronizar desde la fachada y desconectar: revoca el token y conserva horarios, historial y vínculos", async () => {
    const gis = mockGis();
    __setClientForTests(fake);
    savePrefs({ clientId: "123-abc.apps.googleusercontent.com", mode: "existing", calendarId: CAL, calendarName: "Mi calendario" });
    await connect("existing");
    const { habit } = await habitWith([weekly]);
    await call("POST", `/habits/${habit.id}/logs`, { date: new Date().toISOString() });
    const report = await syncNow(false);
    expect(report.created).toBe(1);
    await disconnect();
    expect(gis.revoke).toHaveBeenCalled();
    expect(loadPrefs().connected).toBe(false);
    expect(loadDb().habitSchedules).toHaveLength(1);
    expect(loadDb().habitLogs).toHaveLength(1);
    expect(loadDb().gcalLinks).toHaveLength(1);
    // Sin conexión, sincronizar falla de forma controlada.
    await expect(syncNow(false)).rejects.toMatchObject({ kind: "auth" });
  });
});
