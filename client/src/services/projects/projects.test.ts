import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { bootDb, DB_VERSION, dropCache, loadDb, migrate } from "@/services/localDb";
import { __resetStorageForTests, flushStorage } from "@/services/storage";
import { call, expectStatus } from "@/test/helpers";
import { buildOffer, validateOffer } from "@/services/manualsync/engine";
import { formatPercent, normalizePercent, projectProgress, stageState } from "./progress";
import { deadlineOf } from "./query";

const newProject = (over: Record<string, unknown> = {}) => call("POST", "/projects", { title: "Proyecto", ...over });
const list = (qs = "") => call("GET", `/projects${qs ? `?${qs}` : ""}`);
const addStage = (id: string, body: Record<string, unknown> = {}) => call("POST", `/projects/${id}/stages`, { title: "Etapa", ...body }).then((r) => r.stage);
const setStage = (id: string, stageId: string, body: Record<string, unknown>) => call("PUT", `/projects/${id}/stages/${stageId}`, body);
const summary = async (id: string) => (await list("view=all")).items.find((p: any) => p.id === id);

describe("fórmula de progreso", () => {
  it("media de los porcentajes de las etapas", () => {
    const P = (...ps: number[]) => projectProgress(ps.map((progress) => ({ progress })));
    expect(P(100, 50)).toBe(75);
    expect(P(100, 25)).toBe(62.5);
    expect(P(100, 50, 0)).toBe(50);
    expect(P(100, 100, 100)).toBe(100);
    expect(P(0, 0, 0)).toBe(0);
  });

  it("sin etapas es 0 (no divide entre cero) y siempre queda entre 0 y 100", () => {
    expect(projectProgress([])).toBe(0);
    expect(projectProgress([{ progress: 250 }, { progress: -40 }])).toBe(50);
  });

  it("admite pesos opcionales: sin peso cada etapa vale 1", () => {
    expect(projectProgress([{ progress: 100, weight: 3 }, { progress: 0 }])).toBe(75);
    expect(projectProgress([{ progress: 100, weight: 0 }, { progress: 20 }])).toBe(20);
  });

  it("formato: entero en listas y un decimal en el detalle", () => {
    expect(formatPercent(62.5)).toBe("63 %");
    expect(formatPercent(62.5, 1)).toBe("62,5 %");
    expect(formatPercent(50, 1)).toBe("50 %");
  });

  it("normaliza porcentajes manuales y rechaza lo que no es número", () => {
    expect(normalizePercent(-5)).toBe(0);
    expect(normalizePercent(140)).toBe(100);
    expect(normalizePercent("37,6")).toBe(38);
    expect(normalizePercent("abc")).toBeNull();
    expect(normalizePercent(NaN)).toBeNull();
    expect(normalizePercent("")).toBeNull();
  });

  it("estado de etapa derivado del porcentaje", () => {
    expect(stageState(0)).toBe("pending");
    expect(stageState(1)).toBe("in_progress");
    expect(stageState(100)).toBe("done");
  });
});

describe("modelo y migración", () => {
  it("la migración 7 añade proyectos vacíos sin tocar nada existente ni sembrar ejemplos", () => {
    const old = { version: 6, tasks: [{ id: "t1", title: "x" }], notes: [{ id: "n1" }], settings: {} };
    const db = migrate(structuredClone(old));
    expect(db.version).toBe(DB_VERSION);
    expect(db.projects).toEqual([]);
    expect(db.tasks).toEqual(old.tasks);
    expect(db.notes).toEqual(old.notes);
  });

  it("una base nueva no trae proyectos de demostración", () => {
    expect(loadDb().projects).toEqual([]);
  });
});

describe("CRUD de proyectos", () => {
  it("crear con todos los campos, consultar y editar sin perder etapas ni ids", async () => {
    const p = await newProject({
      title: "Web nueva",
      icon: "Code",
      color: "#0ea5e9",
      tag: "Cliente",
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      description: "Rediseño completo",
      status: "inactive",
      objectives: [{ text: "Lanzar en diciembre" }, { text: "Mejorar conversión", done: true }],
      stages: [{ title: "Diseño" }, { title: "Desarrollo" }],
    });
    expect(p).toMatchObject({ title: "Web nueva", icon: "Code", color: "#0ea5e9", tag: "Cliente", status: "inactive", deletedAt: null, finishedAt: null });
    expect(p.stages.map((s: any) => [s.title, s.progress])).toEqual([["Diseño", 0], ["Desarrollo", 0]]);
    expect(p.objectives.map((o: any) => o.done)).toEqual([false, true]);
    expect(p).not.toHaveProperty("progress"); // el progreso general no se guarda

    const got = await call("GET", `/projects/${p.id}`);
    expect(got).toEqual(p);

    const upd = await call("PUT", `/projects/${p.id}`, { title: "Web 2.0", tag: null, objectives: [...p.objectives, { text: "Nuevo" }] });
    expect(upd.title).toBe("Web 2.0");
    expect(upd.tag).toBeNull();
    expect(upd.stages).toEqual(p.stages);
    expect(upd.objectives.slice(0, 2).map((o: any) => o.id)).toEqual(p.objectives.map((o: any) => o.id));
    expect(upd.objectives).toHaveLength(3);
    expect(upd.createdAt).toBe(p.createdAt);
    expect(upd.updatedAt > p.updatedAt).toBe(true);
  });

  it("título obligatorio, fechas coherentes y valores por defecto", async () => {
    await expectStatus(400, newProject({ title: "  " }));
    await expectStatus(400, newProject({ startDate: "2026-10-10", endDate: "2026-10-01" }));
    await expectStatus(400, newProject({ startDate: "10/10/2026" }));
    await expectStatus(400, newProject({ icon: "<script>" }));
    const p = await newProject();
    expect(p).toMatchObject({ status: "active", icon: "FolderKanban", stages: [], objectives: [], tag: null });
  });

  it("crear con el mismo id es idempotente (doble clic)", async () => {
    await newProject({ id: "fijo" });
    await newProject({ id: "fijo" });
    expect(loadDb().projects).toHaveLength(1);
  });

  it("estado: activo, inactivo y finalizado; el 100 % no finaliza solo", async () => {
    const p = await newProject();
    const s = await addStage(p.id);
    await setStage(p.id, s.id, { progress: 100 });
    expect((await summary(p.id)).status).toBe("active");
    expect((await summary(p.id)).progress).toBe(100);

    const fin = await call("PUT", `/projects/${p.id}`, { status: "finished" });
    expect(fin.status).toBe("finished");
    expect(fin.finishedAt).toBeTruthy();
    const again = await call("PUT", `/projects/${p.id}`, { status: "active" });
    expect(again.finishedAt).toBeNull();
    await expectStatus(400, call("PUT", `/projects/${p.id}`, { status: "done" }));
  });

  it("vistas por estado, búsqueda, etiqueta y orden", async () => {
    await newProject({ title: "Alfa", tag: "Trabajo", description: "Migración de servidores" });
    await newProject({ title: "Beta", tag: "Personal", status: "inactive" });
    await newProject({ title: "Gamma", tag: "trabajo", status: "finished", objectives: [{ text: "Publicar el libro" }] });

    const all = await list("view=all&sort=title&dir=asc");
    expect(all.items.map((p: any) => p.title)).toEqual(["Alfa", "Beta", "Gamma"]);
    expect(all.counts).toMatchObject({ all: 3, active: 1, inactive: 1, finished: 1, trash: 0 });
    expect((await list("view=active")).items.map((p: any) => p.title)).toEqual(["Alfa"]);
    expect((await list("view=inactive")).items.map((p: any) => p.title)).toEqual(["Beta"]);
    expect((await list("view=finished")).items.map((p: any) => p.title)).toEqual(["Gamma"]);
    expect((await list("q=migracion")).items.map((p: any) => p.title)).toEqual(["Alfa"]);
    expect((await list("q=LIBRO")).items.map((p: any) => p.title)).toEqual(["Gamma"]);
    expect((await list("tag=Trabajo&sort=title&dir=asc")).items.map((p: any) => p.title)).toEqual(["Alfa", "Gamma"]);
    expect((await list("sort=title&dir=desc")).items[0].title).toBe("Gamma");
  });

  it("la lista no envía descripciones de etapas y trae etapas completadas/totales", async () => {
    const p = await newProject({ stages: [{ title: "A" }, { title: "B" }] });
    await setStage(p.id, p.stages[0].id, { progress: 100, description: "larga" });
    const s = await summary(p.id);
    expect(s).not.toHaveProperty("stages");
    expect(s).toMatchObject({ stagesDone: 1, stagesTotal: 2, progress: 50 });
  });

  it("eliminar: papelera con confirmación previa en la UI, restaurar y eliminar definitivamente", async () => {
    const p = await newProject({ stages: [{ title: "A" }] });
    await expectStatus(409, call("DELETE", `/projects/${p.id}/purge`));
    await call("DELETE", `/projects/${p.id}`);
    expect((await list()).items).toHaveLength(0);
    expect((await list("view=trash")).items).toHaveLength(1);
    await expectStatus(409, call("PUT", `/projects/${p.id}`, { title: "x" }));
    await expectStatus(409, addStage(p.id));

    const r = await call("POST", `/projects/${p.id}/restore`);
    expect(r.deletedAt).toBeNull();
    expect(r.stages).toHaveLength(1); // las etapas vuelven con él

    await call("DELETE", `/projects/${p.id}`);
    await call("DELETE", `/projects/${p.id}/purge`);
    expect(loadDb().projects).toHaveLength(0); // sin etapas huérfanas: vivían dentro
    expect(loadDb().tombstones.some((t) => t.collection === "projects" && t.id === p.id)).toBe(true);
    await expectStatus(404, call("GET", `/projects/${p.id}`));
  });

  it("vaciar la papelera", async () => {
    const a = await newProject();
    await newProject();
    await call("DELETE", `/projects/${a.id}`);
    expect((await call("POST", "/projects/trash/empty")).purged).toBe(1);
    expect(loadDb().projects).toHaveLength(1);
  });

  it("indicadores de plazo sin cambiar el estado", () => {
    const today = "2026-10-17";
    expect(deadlineOf({ endDate: "2026-10-16", status: "active" }, today)).toBe("overdue");
    expect(deadlineOf({ endDate: "2026-10-20", status: "inactive" }, today)).toBe("soon");
    expect(deadlineOf({ endDate: "2026-12-01", status: "active" }, today)).toBeNull();
    expect(deadlineOf({ endDate: "2026-10-01", status: "finished" }, today)).toBeNull();
    expect(deadlineOf({ endDate: null, status: "active" }, today)).toBeNull();
  });
});

describe("CRUD de etapas y progreso automático", () => {
  it("crear, consultar, editar y eliminar etapas recalculando el total", async () => {
    const p = await newProject();
    expect((await summary(p.id)).progress).toBe(0); // sin etapas

    const a = await addStage(p.id, { title: "A" });
    await setStage(p.id, a.id, { progress: 100 });
    expect((await summary(p.id)).progress).toBe(100);

    const b = await addStage(p.id, { title: "B" }); // nueva al 0 %
    expect(b.progress).toBe(0);
    expect((await summary(p.id)).progress).toBe(50);

    const r = await setStage(p.id, b.id, { progress: 25 });
    expect(r.stage.progress).toBe(25);
    expect(projectProgress(r.project.stages)).toBe(62.5);
    expect(Math.round((await summary(p.id)).progress)).toBe(63);

    const got = await call("GET", `/projects/${p.id}`);
    expect(got.stages.find((s: any) => s.id === b.id)).toMatchObject({ title: "B", progress: 25 });

    await call("DELETE", `/projects/${p.id}/stages/${a.id}`);
    expect((await summary(p.id)).progress).toBe(25);
    await call("DELETE", `/projects/${p.id}/stages/${b.id}`);
    expect((await summary(p.id)).progress).toBe(0);
    await expectStatus(404, call("DELETE", `/projects/${p.id}/stages/${b.id}`));
  });

  it("cambiar título o descripción no altera el porcentaje", async () => {
    const p = await newProject();
    const s = await addStage(p.id, { progress: 40 });
    const r = await setStage(p.id, s.id, { title: "Renombrada", description: "**Detalle** de la etapa" });
    expect(r.stage).toMatchObject({ title: "Renombrada", description: "**Detalle** de la etapa", progress: 40 });
    expect((await summary(p.id)).progress).toBe(40);
    expect(r.stage.createdAt).toBe(s.createdAt);
    expect(r.stage.updatedAt > s.updatedAt).toBe(true);
  });

  it("0 % y 100 % son válidos; negativos, >100, decimales y texto se rechazan", async () => {
    const p = await newProject();
    const s = await addStage(p.id);
    expect((await setStage(p.id, s.id, { progress: 0 })).stage.progress).toBe(0);
    expect((await setStage(p.id, s.id, { progress: 100 })).stage.progress).toBe(100);
    await expectStatus(400, setStage(p.id, s.id, { progress: -1 }));
    await expectStatus(400, setStage(p.id, s.id, { progress: 101 }));
    await expectStatus(400, setStage(p.id, s.id, { progress: 50.5 }));
    await expectStatus(400, setStage(p.id, s.id, { progress: "50" }));
    await expectStatus(400, addStage(p.id, { progress: 120 }));
    expect((await call("GET", `/projects/${p.id}`)).stages[0].progress).toBe(100);
  });

  it("completar (100 %) y reabrir conservando la descripción", async () => {
    const p = await newProject();
    const s = await addStage(p.id, { description: "Notas importantes", progress: 70 });
    const done = await setStage(p.id, s.id, { progress: 100 });
    expect(stageState(done.stage.progress)).toBe("done");
    const reopened = await setStage(p.id, s.id, { progress: 70 });
    expect(reopened.stage).toMatchObject({ progress: 70, description: "Notas importantes" });
  });

  it("reordenar persiste el orden y no cambia el progreso", async () => {
    const p = await newProject({ stages: [{ title: "1" }, { title: "2" }, { title: "3" }] });
    const [a, b, c] = p.stages;
    await setStage(p.id, a.id, { progress: 100 });
    await setStage(p.id, b.id, { progress: 50 });
    const before = (await summary(p.id)).progress;
    const r = await call("POST", `/projects/${p.id}/stages/reorder`, { ids: [c.id, a.id, b.id] });
    expect(r.stages.map((s: any) => s.title)).toEqual(["3", "1", "2"]);
    expect((await summary(p.id)).progress).toBe(before);
    expect((await call("GET", `/projects/${p.id}`)).stages.map((s: any) => s.title)).toEqual(["3", "1", "2"]);
    // Un orden que no nombra exactamente las etapas actuales se rechaza.
    await expectStatus(409, call("POST", `/projects/${p.id}/stages/reorder`, { ids: [a.id, b.id] }));
    await expectStatus(409, call("POST", `/projects/${p.id}/stages/reorder`, { ids: [a.id, a.id, b.id] }));
  });

  it("tantas etapas como hagan falta, cada una con id único", async () => {
    const p = await newProject();
    for (let i = 0; i < 25; i++) await addStage(p.id, { title: `E${i}`, progress: i % 2 ? 100 : 0 });
    const got = await call("GET", `/projects/${p.id}`);
    expect(new Set(got.stages.map((s: any) => s.id)).size).toBe(25);
    expect((await summary(p.id)).stagesDone).toBe(12);
  });
});

describe("persistencia, copias y sincronización", () => {
  afterEach(async () => {
    await flushStorage();
    __resetStorageForTests();
    (globalThis as any).indexedDB = new IDBFactory();
  });

  it("se mantienen tras reiniciar la aplicación (IndexedDB)", async () => {
    await bootDb();
    const p = await newProject({ title: "Persistente", color: "#ef4444", icon: "Star", stages: [{ title: "A" }, { title: "B" }] });
    await setStage(p.id, p.stages[0].id, { progress: 80, description: "desc" });
    await call("POST", `/projects/${p.id}/stages/reorder`, { ids: [p.stages[1].id, p.stages[0].id] });
    await call("PUT", `/projects/${p.id}`, { status: "inactive" });
    // Simula cerrar y volver a abrir la app: memoria vacía, mismo IndexedDB.
    await flushStorage();
    __resetStorageForTests();
    dropCache();
    await bootDb();
    const got = await call("GET", `/projects/${p.id}`);
    expect(got).toMatchObject({ title: "Persistente", color: "#ef4444", icon: "Star", status: "inactive" });
    expect(got.stages.map((s: any) => [s.title, s.progress, s.description])).toEqual([["B", 0, null], ["A", 80, "desc"]]);
  });

  it("la copia de seguridad los incluye y restaura; rechaza porcentajes inválidos", async () => {
    const p = await newProject({ stages: [{ title: "A" }] });
    const backup = await call("GET", "/backup/export");
    expect(backup.data.projects).toHaveLength(1);
    await call("POST", "/backup/import", { data: backup.data, replace: true });
    expect((await call("GET", `/projects/${p.id}`)).stages).toHaveLength(1);

    const bad = structuredClone(backup.data);
    bad.projects[0].stages[0].progress = 140;
    await expectStatus(400, call("POST", "/backup/import", { data: bad }));
    // Copias anteriores al módulo (sin `projects`) siguen siendo válidas.
    const { projects: _p, ...old } = backup.data;
    await call("POST", "/backup/import", { data: old });
    expect(loadDb().projects).toHaveLength(1);
  });

  it("viajan en la sincronización y se valida lo recibido", async () => {
    const p = await newProject({ stages: [{ title: "A" }] });
    const offer = buildOffer(loadDb(), { deviceId: "pc", name: "PC" } as any, null, null);
    const entry = offer.entries.find((e: any) => e.key === `projects:${p.id}`);
    expect(entry).toBeTruthy();
    expect(validateOffer(offer).errors).toEqual([]);
    const tampered = structuredClone(offer);
    (tampered.entries.find((e: any) => e.key === `projects:${p.id}`)!.row as any).stages[0].progress = -3;
    expect(validateOffer(tampered).errors.join(" ")).toMatch(/proyecto no válido/);
  });
});
