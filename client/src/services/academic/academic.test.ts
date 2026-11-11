import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { bootDb, DB_VERSION, dropCache, loadDb, migrate } from "@/services/localDb";
import { __resetStorageForTests, flushStorage } from "@/services/storage";
import { call, expectStatus } from "@/test/helpers";
import { buildOffer, validateOffer } from "@/services/manualsync/engine";
import { activityState, conflictingIds, filterActivities, layoutDay, overlaps, overviewOf, weekOf, weeklyHours } from "./logic";

const semester = (over: Record<string, unknown> = {}) => call("POST", "/academic/semesters", { name: `S-${Math.random().toString(36).slice(2, 7)}`, startDate: "2026-08-01", endDate: "2026-12-15", ...over });
const subject = (semesterId: string, over: Record<string, unknown> = {}) => call("POST", "/academic/subjects", { semesterId, name: `Materia ${Math.random().toString(36).slice(2, 7)}`, ...over });
const klass = (subjectId: string, over: Record<string, unknown> = {}) => call("POST", "/academic/classes", { subjectId, day: 1, startTime: "08:00", endTime: "10:00", ...over });
const activity = (semesterId: string, over: Record<string, unknown> = {}) => call("POST", "/academic/activities", { semesterId, title: "Taller", ...over });
const state = (semesterId?: string) => call("GET", `/academic${semesterId ? `?semesterId=${semesterId}` : ""}`);

describe("lógica del horario", () => {
  it("detecta solapes solo el mismo día y con minutos compartidos", () => {
    const a = { day: 1, startTime: "08:00", endTime: "10:00" };
    expect(overlaps(a, { day: 1, startTime: "09:30", endTime: "11:00" })).toBe(true);
    expect(overlaps(a, { day: 1, startTime: "10:00", endTime: "11:00" })).toBe(false);
    expect(overlaps(a, { day: 2, startTime: "08:00", endTime: "10:00" })).toBe(false);
    expect(overlaps(a, { day: 1, startTime: "07:00", endTime: "12:00" })).toBe(true);
  });

  it("marca todas las clases en conflicto y reparte carriles sin pisarse", () => {
    const c = (id: string, startTime: string, endTime: string) => ({ id, semesterId: "s", day: 3, startTime, endTime });
    const rows = [c("a", "08:00", "10:00"), c("b", "09:00", "11:00"), c("c", "11:00", "12:00")];
    expect([...conflictingIds(rows)].sort()).toEqual(["a", "b"]);
    const lanes = layoutDay(rows);
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("c")).toEqual({ lane: 0, lanes: 1 });
    expect(weeklyHours(rows)).toBe(5);
  });

  it("semana de lunes a domingo", () => {
    expect(weekOf("2026-11-11")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(weekOf("2026-11-15")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
  });
});

describe("estado y filtros de actividades", () => {
  const base = { semesterId: "s", description: null, customType: null, dueTime: null, references: [], observations: null, completedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  const a = (id: string, over: Record<string, unknown>) => ({ ...base, id, title: id, subjectId: null, type: "task", dueDate: null, priority: "medium", status: "pending", progress: 0, ...over }) as any;

  it("«Vencida» se deriva de la fecha límite y nunca afecta a las completadas", () => {
    expect(activityState(a("x", { dueDate: "2026-11-01" }), "2026-11-11")).toBe("overdue");
    expect(activityState(a("x", { dueDate: "2026-11-01", status: "done" }), "2026-11-11")).toBe("done");
    expect(activityState(a("x", { dueDate: "2026-11-11", status: "review" }), "2026-11-11")).toBe("review");
  });

  it("filtra por materia, estado, prioridad, fechas y texto; ordena por fecha", () => {
    const items = [
      a("Ensayo", { subjectId: "m1", dueDate: "2026-11-20", priority: "high" }),
      a("Parcial álgebra", { subjectId: "m2", type: "exam", dueDate: "2026-11-12" }),
      a("Lectura", { subjectId: "m1", dueDate: "2026-11-05" }),
      a("Sin fecha", {}),
    ];
    const subjects = [{ id: "m1", name: "Historia" }, { id: "m2", name: "Matemáticas" }];
    const titles = (f: any, sort?: any) => filterActivities(items, subjects, "2026-11-11", f, sort).map((x) => x.title);
    expect(titles({})).toEqual(["Lectura", "Parcial álgebra", "Ensayo", "Sin fecha"]);
    expect(titles({ subjectId: "m1" })).toEqual(["Lectura", "Ensayo"]);
    expect(titles({ subjectId: "none" })).toEqual(["Sin fecha"]);
    expect(titles({ state: "overdue" })).toEqual(["Lectura"]);
    expect(titles({ priority: "high" })).toEqual(["Ensayo"]);
    expect(titles({ from: "2026-11-10", to: "2026-11-15" })).toEqual(["Parcial álgebra"]);
    expect(titles({ q: "matematicas" })).toEqual(["Parcial álgebra"]);
    expect(titles({}, "priority")[0]).toBe("Ensayo");
  });

  it("el panel separa próximas entregas, parciales y vencidas", () => {
    const items = [
      a("Entrega", { dueDate: "2026-11-13" }),
      a("Parcial", { type: "exam", dueDate: "2026-11-30" }),
      a("Atrasada", { dueDate: "2026-11-02" }),
      a("Hecha", { status: "done", progress: 100, dueDate: "2026-11-10" }),
      a("Lejana", { dueDate: "2027-02-01" }),
    ];
    const o = overviewOf(items, [], "2026-11-11");
    expect(o.upcoming.map((x) => x.title)).toEqual(["Entrega"]);
    expect(o.upcomingExams.map((x) => x.title)).toEqual(["Parcial"]);
    expect(o.overdue.map((x) => x.title)).toEqual(["Atrasada"]);
    expect([o.pendingCount, o.doneCount, o.totalCount]).toEqual([4, 1, 5]);
    expect(o.week.due.map((x) => x.title)).toEqual(["Hecha", "Entrega"]);
  });
});

describe("modelo y migración", () => {
  it("la migración 8 añade las colecciones vacías sin tocar nada existente", () => {
    const old = { version: 7, tasks: [{ id: "t1", title: "x" }], projects: [{ id: "p1" }], settings: {} };
    const db = migrate(structuredClone(old));
    expect(db.version).toBe(DB_VERSION);
    expect([db.acadSemesters, db.acadSubjects, db.acadClasses, db.acadActivities]).toEqual([[], [], [], []]);
    expect(db.tasks).toEqual(old.tasks);
    expect(db.projects).toEqual(old.projects);
  });
});

describe("semestres", () => {
  it("CRUD, un solo semestre activo y nombres sin duplicar", async () => {
    const s1 = await semester({ name: "2026-1", startDate: "2026-02-01", endDate: "2026-06-15" });
    expect(s1.active).toBe(true); // el primero queda activo
    const s2 = await semester({ name: "2026-2", active: true });
    const all = (await state()).semesters;
    expect(all.filter((s: any) => s.active).map((s: any) => s.id)).toEqual([s2.id]);
    await call("POST", `/academic/semesters/${s1.id}/activate`);
    expect((await state()).semester.id).toBe(s1.id);
    const edited = await call("PUT", `/academic/semesters/${s1.id}`, { name: "2026-I", notes: "Primer semestre" });
    expect(edited).toMatchObject({ name: "2026-I", notes: "Primer semestre" });
    await expectStatus(409, semester({ name: "2026-2" }));
    await expectStatus(400, semester({ name: "Mal", startDate: "2026-06-01", endDate: "2026-01-01" }));
    // Consultar un semestre anterior por id.
    expect((await state(s2.id)).semester.name).toBe("2026-2");
  });

  it("borrar un semestre borra en cascada lo suyo (con lápidas) y no toca otros", async () => {
    const s1 = await semester();
    const s2 = await semester();
    const m1 = await subject(s1.id);
    const m2 = await subject(s2.id);
    await klass(m1.id);
    await activity(s1.id, { subjectId: m1.id });
    await activity(s2.id, { subjectId: m2.id });
    const removed = await call("DELETE", `/academic/semesters/${s1.id}`);
    expect(removed).toEqual({ subjects: 1, classes: 1, activities: 1 });
    const db = loadDb();
    expect(db.acadSubjects.map((s) => s.id)).toEqual([m2.id]);
    expect(db.acadActivities).toHaveLength(1);
    expect(db.tombstones.filter((t) => t.collection.startsWith("acad"))).toHaveLength(4);
  });
});

describe("materias y horario", () => {
  it("CRUD de materias con todos los campos; nombre único por semestre", async () => {
    const s = await semester();
    const m = await subject(s.id, { name: "Cálculo", code: "MAT-101", professor: "Ana Ruiz", professorContact: "ana@uni.edu", room: "B-204", credits: 4, description: "Derivadas", color: "#ef4444" });
    expect(m).toMatchObject({ code: "MAT-101", professor: "Ana Ruiz", credits: 4, color: "#ef4444" });
    await expectStatus(409, subject(s.id, { name: "cálculo" }));
    const other = await semester();
    await subject(other.id, { name: "Cálculo" }); // otro semestre: permitido
    const e = await call("PUT", `/academic/subjects/${m.id}`, { room: "", credits: null });
    expect(e).toMatchObject({ room: null, credits: null, name: "Cálculo" });
    await expectStatus(400, subject(s.id, { name: "X", credits: -1 }));
  });

  it("rechaza solapes salvo confirmación y valida las horas", async () => {
    const s = await semester();
    const m1 = await subject(s.id, { name: "Física" });
    const m2 = await subject(s.id, { name: "Química" });
    const c1 = await klass(m1.id, { day: 2, startTime: "08:00", endTime: "10:00" });
    const msg = await expectStatus(409, klass(m2.id, { day: 2, startTime: "09:00", endTime: "11:00" }));
    expect(msg).toMatch(/martes.*Física/);
    await klass(m2.id, { day: 2, startTime: "10:00", endTime: "11:00" }); // contigua: sin conflicto
    const forced = await klass(m2.id, { day: 2, startTime: "09:00", endTime: "11:00", allowOverlap: true });
    // La forzada choca con Física y con la de 10:00-11:00 de Química.
    expect((await state(s.id)).conflicts).toEqual(expect.arrayContaining([c1.id, forced.id]));
    await expectStatus(400, klass(m1.id, { startTime: "10:00", endTime: "09:00" }));
    await expectStatus(400, klass(m1.id, { startTime: "25:00", endTime: "26:00" }));
    // Editar hacia un hueco que choca también se avisa.
    await expectStatus(409, call("PUT", `/academic/classes/${c1.id}`, { startTime: "10:30", endTime: "11:30" }));
    const moved = await call("PUT", `/academic/classes/${c1.id}`, { day: 4, room: "Lab 1" });
    expect(moved).toMatchObject({ day: 4, room: "Lab 1" });
  });

  it("borrar una materia borra sus clases y actividades, no las del resto", async () => {
    const s = await semester();
    const m1 = await subject(s.id);
    const m2 = await subject(s.id);
    await klass(m1.id);
    await activity(s.id, { subjectId: m1.id });
    const keep = await activity(s.id, { subjectId: m2.id });
    const general = await activity(s.id);
    expect(await call("DELETE", `/academic/subjects/${m1.id}`)).toEqual({ classes: 1, activities: 1 });
    expect(loadDb().acadActivities.map((a) => a.id).sort()).toEqual([keep.id, general.id].sort());
  });
});

describe("actividades", () => {
  it("CRUD completo con tipos, prioridad, estado, avance y referencias", async () => {
    const s = await semester();
    const m = await subject(s.id);
    const a = await activity(s.id, {
      subjectId: m.id,
      title: "Parcial 1",
      type: "exam",
      dueDate: "2026-11-20",
      dueTime: "07:00",
      priority: "high",
      references: [{ label: "Guía", url: "https://uni.edu/guia.pdf" }, { label: "Capítulo 3" }],
      observations: "Llevar calculadora",
    });
    expect(a).toMatchObject({ type: "exam", priority: "high", status: "pending", progress: 0, dueTime: "07:00" });
    expect(a.references.map((r: any) => r.url)).toEqual(["https://uni.edu/guia.pdf", null]);
    const other = await activity(s.id, { type: "other", customType: "Laboratorio" });
    expect(other.customType).toBe("Laboratorio");

    const p = await call("PUT", `/academic/activities/${a.id}`, { status: "in_progress", progress: 40 });
    expect(p).toMatchObject({ status: "in_progress", progress: 40, completedAt: null });
    const done = await call("PUT", `/academic/activities/${a.id}`, { status: "done" });
    expect(done.progress).toBe(100);
    expect(done.completedAt).toBeTruthy();
    const noDate = await call("PUT", `/academic/activities/${a.id}`, { dueDate: null });
    expect(noDate.dueTime).toBeNull();

    await expectStatus(400, activity(s.id, { references: [{ label: "x", url: "javascript:alert(1)" }] }));
    await expectStatus(400, activity(s.id, { progress: 120 }));
    await expectStatus(400, activity(s.id, { title: "  " }));
    // Una materia de otro semestre no se puede asociar.
    const s2 = await semester();
    await expectStatus(400, activity(s2.id, { subjectId: m.id }));

    await call("DELETE", `/academic/activities/${a.id}`);
    expect(loadDb().acadActivities.map((x) => x.id)).toEqual([other.id]);
  });

  it("el panel se recalcula al modificar los registros", async () => {
    const s = await semester();
    const today = (await state(s.id)).today as string;
    const a = await activity(s.id, { dueDate: today });
    expect((await state(s.id)).overview.upcoming.map((x: any) => x.id)).toEqual([a.id]);
    await call("PUT", `/academic/activities/${a.id}`, { status: "done" });
    const o = (await state(s.id)).overview;
    expect(o.upcoming).toEqual([]);
    expect(o.doneCount).toBe(1);
  });
});

describe("persistencia, copias y sincronización", () => {
  afterEach(async () => {
    await flushStorage();
    __resetStorageForTests();
    (globalThis as any).indexedDB = new IDBFactory();
  });

  it("se mantiene tras reiniciar la aplicación (IndexedDB)", async () => {
    await bootDb();
    const s = await semester({ name: "Persistente" });
    const m = await subject(s.id, { name: "Redes" });
    await klass(m.id, { day: 5 });
    await activity(s.id, { subjectId: m.id, title: "Informe" });
    await flushStorage();
    __resetStorageForTests();
    dropCache();
    await bootDb();
    const got = await state(s.id);
    expect(got.semester.name).toBe("Persistente");
    expect(got.subjects.map((x: any) => x.name)).toEqual(["Redes"]);
    expect(got.classes[0].day).toBe(5);
    expect(got.activities[0].title).toBe("Informe");
  });

  it("la copia de seguridad lo incluye y restaura; rechaza filas inválidas", async () => {
    const s = await semester();
    await subject(s.id);
    const backup = await call("GET", "/backup/export");
    expect(backup.data.acadSemesters).toHaveLength(1);
    expect(backup.data.acadSubjects).toHaveLength(1);
    await call("POST", "/backup/import", { data: backup.data, replace: true });
    expect(loadDb().acadSubjects).toHaveLength(1);
    const bad = structuredClone(backup.data);
    bad.acadSubjects[0].color = "rojo";
    await expectStatus(400, call("POST", "/backup/import", { data: bad }));
    // Copias anteriores al módulo siguen siendo válidas.
    const { acadSemesters: _a, acadSubjects: _b, acadClasses: _c, acadActivities: _d, ...old } = backup.data;
    await call("POST", "/backup/import", { data: old });
    expect(loadDb().acadSemesters).toHaveLength(1);
  });

  it("viaja en la sincronización y se valida lo recibido", async () => {
    const s = await semester();
    const m = await subject(s.id);
    const offer = buildOffer(loadDb(), { deviceId: "pc", name: "PC" } as any, null, null);
    expect(offer.entries.some((e: any) => e.key === `acadSubjects:${m.id}`)).toBe(true);
    expect(validateOffer(offer).errors).toEqual([]);
    const tampered = structuredClone(offer);
    (tampered.entries.find((e: any) => e.key === `acadSubjects:${m.id}`)!.row as any).color = "x";
    expect(validateOffer(tampered).errors.join(" ")).toMatch(/datos no válidos/);
  });
});
