import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { DB_VERSION, loadDb, migrate } from "@/services/localDb";
import { call, expectStatus } from "@/test/helpers";
import { buildOffer, validateOffer } from "@/services/manualsync/engine";
import { blockersOf, cloneStages, createsCycle, stageProgressOf, stageStatusOf } from "@/services/workflow/logic";

const sop = (over: Record<string, unknown> = {}) => call("POST", "/sops", { name: `SOP ${Math.random().toString(36).slice(2, 7)}`, ...over });
const op = (id: string, body: Record<string, unknown>) => call("POST", `/sops/${id}/ops`, body);
const get = (id: string) => call("GET", `/sops/${id}`);

describe("modelo y migración", () => {
  it("la migración 10 añade las plantillas de ejemplo sin tocar proyectos", () => {
    const project = { id: "p1", title: "P", stages: [{ id: "s1", title: "Etapa", description: null, progress: 40, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] };
    const db = migrate(structuredClone({ version: 9, projects: [project], settings: {} }));
    expect(db.version).toBe(DB_VERSION);
    expect(db.projects).toEqual([project]);
    const software = db.sops.find((s) => s.id === "sop-tpl-software")!;
    expect(software.kind).toBe("template");
    expect(software.stages.map((s) => s.title)).toEqual([
      "Análisis y levantamiento de requisitos",
      "Planificación",
      "Diseño y arquitectura",
      "Desarrollo",
      "Pruebas y validación",
      "Seguridad",
      "Despliegue",
      "Documentación y entrega",
      "Mantenimiento",
    ]);
  });

  it("no resucita una plantilla borrada en otro dispositivo", () => {
    const db = migrate(structuredClone({ version: 9, tombstones: [{ collection: "sops", id: "sop-tpl-research", deletedAt: "2026-01-01T00:00:00.000Z" }], settings: {} }));
    expect(db.sops.map((s) => s.id)).toEqual(["sop-tpl-software"]);
  });
});

describe("SOP: CRUD", () => {
  it("crear, editar, listar, archivar, restaurar y eliminar", async () => {
    const s = await sop({ name: "Cierre contable", objective: "Cerrar el mes", category: "Finanzas", owner: "Ana", version: "2.1" });
    expect(s).toMatchObject({ kind: "sop", status: "active", version: "2.1", stages: [] });
    await expectStatus(409, sop({ name: "cierre CONTABLE" }));
    // Mismo nombre permitido como plantilla.
    await sop({ name: "Cierre contable", kind: "template" });
    const edited = await call("PUT", `/sops/${s.id}`, { description: "Pasos del cierre", status: "draft" });
    expect(edited).toMatchObject({ description: "Pasos del cierre", status: "draft" });

    expect((await call("GET", "/sops?q=contable")).items.map((x: any) => x.name)).toEqual(["Cierre contable"]);
    await call("POST", `/sops/${s.id}/archive`);
    expect((await call("GET", "/sops")).items).toHaveLength(0);
    expect((await call("GET", "/sops?status=archived")).items).toHaveLength(1);
    await expectStatus(409, call("PUT", `/sops/${s.id}`, { name: "x" }));
    await expectStatus(409, op(s.id, { op: "stage.add", data: { title: "X" } }));
    await call("POST", `/sops/${s.id}/restore`);
    expect((await get(s.id)).status).toBe("active");

    await call("DELETE", `/sops/${s.id}`);
    expect(loadDb().sops.some((x) => x.id === s.id)).toBe(false);
    expect(loadDb().tombstones.some((t) => t.collection === "sops" && t.id === s.id)).toBe(true);
  });

  it("funciona sin ningún proyecto (módulo independiente)", async () => {
    expect(loadDb().projects).toHaveLength(0);
    const s = await sop();
    await op(s.id, { op: "stage.add", data: { title: "Única" } });
    expect((await get(s.id)).stages).toHaveLength(1);
  });
});

describe("estructura: etapas, procedimientos, actividades y listas", () => {
  it("etapas: crear, editar, reordenar, duplicar y eliminar sin límites artificiales", async () => {
    const s = await sop();
    const ids: string[] = [];
    for (let i = 1; i <= 12; i++) ids.push((await op(s.id, { op: "stage.add", data: { title: `Etapa ${i}` } })).createdId);
    let row = await get(s.id);
    expect(row.stages).toHaveLength(12);
    const inserted = (await op(s.id, { op: "stage.add", data: { title: "Entre 1 y 2" }, after: ids[0] })).createdId;
    row = await get(s.id);
    expect(row.stages[1].id).toBe(inserted);

    await op(s.id, { op: "stage.update", stageId: ids[0], data: { title: "Análisis", objective: "Entender", subtitle: "Fase inicial", color: "#ef4444", startDate: "2026-01-01", endDate: "2026-01-31", priority: "high", documentation: "- [Guía](https://ejemplo.com)", observations: "Ojo" } });
    await expectStatus(400, op(s.id, { op: "stage.update", stageId: ids[0], data: { startDate: "2026-02-01" } }));
    row = await get(s.id);
    expect(row.stages[0]).toMatchObject({ title: "Análisis", objective: "Entender", subtitle: "Fase inicial", priority: "high" });

    const order = row.stages.map((x: any) => x.id).reverse();
    await op(s.id, { op: "stage.reorder", ids: order });
    expect((await get(s.id)).stages.map((x: any) => x.id)).toEqual(order);
    await expectStatus(409, op(s.id, { op: "stage.reorder", ids: order.slice(1) }));

    const dup = (await op(s.id, { op: "stage.duplicate", stageId: ids[0] })).createdId;
    row = await get(s.id);
    expect(row.stages.find((x: any) => x.id === dup).title).toBe("Análisis (copia)");

    await op(s.id, { op: "stage.delete", stageId: ids[0] });
    expect((await get(s.id)).stages.some((x: any) => x.id === ids[0])).toBe(false);
  });

  it("procedimientos y listas de verificación en todos los niveles", async () => {
    const s = await sop();
    const st = (await op(s.id, { op: "stage.add", data: { title: "E" } })).createdId;
    const p1 = (await op(s.id, { op: "procedure.add", stageId: st, data: { title: "Paso A", instructions: "1. Hacer" } })).createdId;
    const p2 = (await op(s.id, { op: "procedure.add", stageId: st, data: { title: "Paso B" } })).createdId;
    await op(s.id, { op: "procedure.update", stageId: st, procedureId: p1, data: { observations: "Revisar" } });
    await op(s.id, { op: "procedure.reorder", stageId: st, ids: [p2, p1] });
    const c1 = (await op(s.id, { op: "check.add", owner: { stageId: st }, text: "Aprobado" })).createdId;
    const c2 = (await op(s.id, { op: "check.add", owner: { stageId: st, procedureId: p1 }, text: "Firmado" })).createdId;
    await op(s.id, { op: "check.update", owner: { stageId: st }, itemId: c1, done: true });
    await op(s.id, { op: "check.update", owner: { stageId: st, procedureId: p1 }, itemId: c2, text: "Firmado por gerencia" });
    let stage = (await get(s.id)).stages[0];
    expect(stage.procedures.map((p: any) => p.title)).toEqual(["Paso B", "Paso A"]);
    expect(stage.checklist[0]).toMatchObject({ text: "Aprobado", done: true });
    expect(stage.procedures[1]).toMatchObject({ instructions: "1. Hacer", observations: "Revisar", checklist: [{ text: "Firmado por gerencia", done: false }] });
    await op(s.id, { op: "check.delete", owner: { stageId: st }, itemId: c1 });
    await op(s.id, { op: "procedure.delete", stageId: st, procedureId: p2 });
    stage = (await get(s.id)).stages[0];
    expect(stage.checklist).toEqual([]);
    expect(stage.procedures).toHaveLength(1);
    await expectStatus(404, op(s.id, { op: "check.add", owner: { stageId: st, procedureId: "nope" }, text: "x" }));
  });

  it("actividades: completar, avance automático, mover, reordenar y dependencias", async () => {
    const s = await sop();
    const e1 = (await op(s.id, { op: "stage.add", data: { title: "E1" } })).createdId;
    const e2 = (await op(s.id, { op: "stage.add", data: { title: "E2" } })).createdId;
    await op(s.id, { op: "stage.update", stageId: e1, data: { progress: 30 } });
    const a = (await op(s.id, { op: "activity.add", stageId: e1, data: { title: "A", priority: "high", dueDate: "2026-12-01" } })).createdId;
    const b = (await op(s.id, { op: "activity.add", stageId: e1, data: { title: "B", progress: 50, dependsOn: [a] } })).createdId;
    let st = (await get(s.id)).stages[0];
    expect(st.progress).toBe(25); // media de 0 y 50: ya no manda el manual
    await expectStatus(400, op(s.id, { op: "stage.update", stageId: e1, data: { progress: 80 } }));
    expect(blockersOf(st.activities[1], st.activities).map((x) => x.title)).toEqual(["A"]);

    await op(s.id, { op: "activity.update", stageId: e1, activityId: a, data: { status: "done" } });
    st = (await get(s.id)).stages[0];
    expect(st.activities[0].completedAt).not.toBeNull();
    expect(st.progress).toBe(75);
    expect(blockersOf(st.activities[1], st.activities)).toEqual([]);

    // Dependencias inválidas.
    await expectStatus(400, op(s.id, { op: "activity.update", stageId: e1, activityId: a, data: { dependsOn: [a] } }));
    await expectStatus(400, op(s.id, { op: "activity.update", stageId: e1, activityId: a, data: { dependsOn: [b] } })); // ciclo
    await expectStatus(400, op(s.id, { op: "activity.update", stageId: e1, activityId: a, data: { dependsOn: ["inexistente"] } }));

    await op(s.id, { op: "activity.reorder", stageId: e1, ids: [b, a] });
    expect((await get(s.id)).stages[0].activities.map((x: any) => x.title)).toEqual(["B", "A"]);
    await op(s.id, { op: "activity.move", stageId: e1, activityId: b, toStageId: e2 });
    let row = await get(s.id);
    expect(row.stages[1].activities.map((x: any) => x.title)).toEqual(["B"]);
    expect(row.stages[1].activities[0].dependsOn).toEqual([a]); // sigue dependiendo entre etapas

    // Borrar la actividad limpia las dependencias que apuntaban a ella.
    await op(s.id, { op: "activity.delete", stageId: e1, activityId: a });
    row = await get(s.id);
    expect(row.stages[1].activities[0].dependsOn).toEqual([]);
    // Sin actividades conserva su último avance y vuelve a ser manual.
    expect(row.stages[0].progress).toBe(100);
    await op(s.id, { op: "stage.update", stageId: e1, data: { progress: 30 } });
    expect((await get(s.id)).stages[0].progress).toBe(30);
  });

  it("estado de etapa: elegido o derivado del avance", async () => {
    const s = await sop();
    const e = (await op(s.id, { op: "stage.add", data: { title: "E" } })).createdId;
    await op(s.id, { op: "stage.update", stageId: e, data: { status: "done" } });
    let st = (await get(s.id)).stages[0];
    expect([st.status, st.progress]).toEqual(["done", 100]);
    await op(s.id, { op: "stage.update", stageId: e, data: { status: null, progress: 40 } });
    st = (await get(s.id)).stages[0];
    expect(stageStatusOf(st)).toBe("in_progress");
    await op(s.id, { op: "stage.update", stageId: e, data: { status: "on_hold" } });
    expect(stageStatusOf((await get(s.id)).stages[0])).toBe("on_hold");
  });
});

describe("plantillas: copias independientes", () => {
  it("crear un SOP desde una plantilla no comparte nada con ella", async () => {
    const before = JSON.stringify(await get("sop-tpl-software"));
    const s = await call("POST", "/sops/sop-tpl-software/duplicate", { kind: "sop", name: "App de inventario" });
    expect(s).toMatchObject({ kind: "sop", name: "App de inventario" });
    expect(s.stages).toHaveLength(9);
    const tplIds = new Set(JSON.stringify(await get("sop-tpl-software")).match(/sop-tpl-software-[\w-]+/g));
    expect(JSON.stringify(s).match(/sop-tpl-software-[\w-]+/g)).toBeNull();
    expect(tplIds.size).toBeGreaterThan(0);
    // Editar la copia (incluidas listas y actividades) no toca la plantilla.
    const st = s.stages[0];
    await op(s.id, { op: "stage.update", stageId: st.id, data: { title: "Cambiado" } });
    await op(s.id, { op: "activity.update", stageId: st.id, activityId: st.activities[0].id, data: { status: "done" } });
    await op(s.id, { op: "check.update", owner: { stageId: st.id }, itemId: st.checklist[0].id, done: true });
    await op(s.id, { op: "stage.delete", stageId: s.stages[8].id });
    expect(JSON.stringify(await get("sop-tpl-software"))).toBe(before);
  });

  it("guardar un SOP como plantilla, duplicar y crear plantillas desde cero", async () => {
    const s = await sop({ name: "Onboarding" });
    const e = (await op(s.id, { op: "stage.add", data: { title: "Bienvenida" } })).createdId;
    const act = (await op(s.id, { op: "activity.add", stageId: e, data: { title: "Entregar equipo" } })).createdId;
    await op(s.id, { op: "activity.update", stageId: e, activityId: act, data: { status: "done" } });
    const tpl = await call("POST", `/sops/${s.id}/duplicate`, { kind: "template" });
    expect(tpl).toMatchObject({ kind: "template", name: "Onboarding" });
    expect(tpl.stages[0].activities[0]).toMatchObject({ status: "pending", completedAt: null }); // desde cero
    const copy = await call("POST", `/sops/${tpl.id}/duplicate`);
    expect(copy).toMatchObject({ kind: "template", name: "Onboarding (copia)" });
    const blank = await sop({ kind: "template", name: "Desde cero" });
    expect(blank.stages).toEqual([]);
    await call("DELETE", `/sops/${copy.id}`);
    expect((await call("GET", "/sops?kind=template")).items.map((x: any) => x.name)).toContain("Onboarding");
  });

  it("crear desde la estructura de un proyecto", async () => {
    const p = await call("POST", "/projects", { title: "Web", stages: [{ title: "Diseño" }, { title: "Código" }] });
    const tpl = await sop({ kind: "template", name: "Web genérica", from: { type: "project", id: p.id } });
    expect(tpl.stages.map((x: any) => x.title)).toEqual(["Diseño", "Código"]);
    expect(tpl.stages[0].id).not.toBe(p.stages[0].id);
  });
});

describe("lógica pura", () => {
  it("avance de etapa, ciclos y clonado con dependencias reasignadas", () => {
    expect(stageProgressOf({ progress: 10, activities: [] })).toBe(10);
    const acts = [
      { id: "a", dependsOn: [] as string[] },
      { id: "b", dependsOn: ["a"] },
    ];
    expect(createsCycle("a", ["b"], acts)).toBe(true);
    expect(createsCycle("b", ["a"], acts)).toBe(false);
    const ts = "2026-01-01T00:00:00.000Z";
    const stage = { id: "s", title: "S", description: null, progress: 50, createdAt: ts, updatedAt: ts, activities: [
      { id: "a", title: "A", description: null, dueDate: null, priority: "medium" as const, status: "done" as const, progress: null, observations: null, checklist: [{ id: "c", text: "x", done: true }], dependsOn: [], completedAt: ts, createdAt: ts, updatedAt: ts },
      { id: "b", title: "B", description: null, dueDate: null, priority: "medium" as const, status: "pending" as const, progress: 20, observations: null, checklist: [], dependsOn: ["a"], completedAt: null, createdAt: ts, updatedAt: ts },
    ] };
    const [copy] = cloneStages([stage], ts);
    expect(copy.id).not.toBe("s");
    expect(copy.activities[1].dependsOn).toEqual([copy.activities[0].id]);
    expect(copy.activities[0]).toMatchObject({ status: "pending", completedAt: null, checklist: [{ text: "x", done: false }] });
    expect(copy.activities[1].progress).toBe(0);
  });
});

describe("sincronización", () => {
  it("las filas de SOP viajan validadas", async () => {
    const s = await sop();
    await op(s.id, { op: "stage.add", data: { title: "E" } });
    const offer = buildOffer(loadDb(), { deviceId: "pc", name: "PC" } as any, null, null);
    expect(offer.entries.some((e: any) => e.key === `sops:${s.id}`)).toBe(true);
    expect(validateOffer(offer).errors).toEqual([]);
    const tampered = structuredClone(offer);
    (tampered.entries.find((e: any) => e.key === `sops:${s.id}`)!.row as any).stages[0].progress = 300;
    expect(validateOffer(tampered).errors.join(" ")).toMatch(/datos no válidos/);
  });
});
