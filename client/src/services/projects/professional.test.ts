import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { loadDb } from "@/services/localDb";
import { call, expectStatus } from "@/test/helpers";
import { buildOffer, validateOffer } from "@/services/manualsync/engine";
import { projectProgress } from "./progress";

const project = (over: Record<string, unknown> = {}) => call("POST", "/projects", { title: `Proyecto ${Math.random().toString(36).slice(2, 7)}`, ...over });
const op = (id: string, body: Record<string, unknown>) => call("POST", `/projects/${id}/ops`, body);
const get = (id: string) => call("GET", `/projects/${id}`);

describe("proyecto profesional: datos y creación", () => {
  it("guarda cliente, responsable, prioridad y presupuesto", async () => {
    const p = await project({ title: "App empresarial", client: "ACME S.A.", owner: "Laura", priority: "high", budget: 15_000_000, tag: "Software", color: "#0ea5e9", startDate: "2026-11-01", endDate: "2027-03-31" });
    expect(p).toMatchObject({ client: "ACME S.A.", owner: "Laura", priority: "high", budget: 15_000_000 });
    const edited = await call("PUT", `/projects/${p.id}`, { client: null, budget: 20_000_000 });
    expect(edited).toMatchObject({ client: null, budget: 20_000_000 });
    await expectStatus(400, project({ budget: -1 }));
  });

  it("crear desde una plantilla SOP copia una estructura independiente", async () => {
    const before = JSON.stringify(loadDb().sops.find((s) => s.id === "sop-tpl-software"));
    const p = await project({ title: "ERP", from: { type: "sop", id: "sop-tpl-software" } });
    expect(p.stages).toHaveLength(9);
    expect(p.sourceTemplateId).toBe("sop-tpl-software");
    expect(JSON.stringify(p)).not.toMatch(/sop-tpl-software-s/); // ids nuevos en todos los niveles
    const st = p.stages[0];
    await op(p.id, { op: "stage.update", stageId: st.id, data: { title: "Levantamiento" } });
    await op(p.id, { op: "activity.update", stageId: st.id, activityId: st.activities[0].id, data: { status: "done" } });
    await op(p.id, { op: "stage.delete", stageId: p.stages[8].id });
    expect(JSON.stringify(loadDb().sops.find((s) => s.id === "sop-tpl-software"))).toBe(before);

    // Otro proyecto con la misma plantilla no comparte nada con el primero.
    const q = await project({ title: "CRM", from: { type: "sop", id: "sop-tpl-software" } });
    expect(q.stages[0].title).toBe("Análisis y levantamiento de requisitos");
    expect(q.stages[0].activities[0].status).toBe("pending");
    expect(q.stages.map((s: any) => s.id).some((id: string) => p.stages.some((x: any) => x.id === id))).toBe(false);
  });

  it("crear duplicando la estructura de otro proyecto", async () => {
    const a = await project({ stages: [{ title: "Diseño" }, { title: "Construcción" }] });
    const b = await project({ from: { type: "project", id: a.id } });
    expect(b.stages.map((s: any) => s.title)).toEqual(["Diseño", "Construcción"]);
    expect(b.stages[0].id).not.toBe(a.stages[0].id);
  });
});

describe("proyecto profesional: sistema de trabajo", () => {
  it("etapas, procedimientos, actividades con checklist y dependencias; el avance general sale de las actividades", async () => {
    const p = await project();
    const e1 = (await op(p.id, { op: "stage.add", data: { title: "Análisis", priority: "high", startDate: "2026-11-01", endDate: "2026-11-30" } })).createdId;
    const e2 = (await op(p.id, { op: "stage.add", data: { title: "Desarrollo" } })).createdId;
    await op(p.id, { op: "procedure.add", stageId: e1, data: { title: "Entrevistas", instructions: "1. Agendar" } });
    const a1 = (await op(p.id, { op: "activity.add", stageId: e1, data: { title: "Entrevistar al cliente", dueDate: "2026-11-15" } })).createdId;
    const a2 = (await op(p.id, { op: "activity.add", stageId: e2, data: { title: "Implementar", dependsOn: [a1] } })).createdId;
    await op(p.id, { op: "check.add", owner: { stageId: e1, activityId: a1 }, text: "Acta firmada" });
    await op(p.id, { op: "activity.update", stageId: e1, activityId: a1, data: { status: "done" } });
    const row = await get(p.id);
    expect(row.stages[0].progress).toBe(100);
    expect(row.stages[1].activities[0]).toMatchObject({ id: a2, dependsOn: [a1] });
    expect(projectProgress(row.stages)).toBe(50);
    // La etapa con actividades no admite avance manual por la ruta clásica.
    await expectStatus(400, call("PUT", `/projects/${p.id}/stages/${e1}`, { progress: 20 }));
    // Pero sí el título o la descripción.
    await call("PUT", `/projects/${p.id}/stages/${e1}`, { description: "Primera fase" });
  });

  it("los proyectos anteriores (etapas sin campos nuevos) funcionan con el sistema de trabajo", async () => {
    const p = await project({ stages: [{ title: "Vieja" }] });
    await call("PUT", `/projects/${p.id}/stages/${p.stages[0].id}`, { progress: 40 });
    const a = (await op(p.id, { op: "activity.add", stageId: p.stages[0].id, data: { title: "Nueva actividad" } })).createdId;
    const row = await get(p.id);
    expect(row.stages[0]).toMatchObject({ title: "Vieja", procedures: [], checklist: [] });
    expect(row.stages[0].activities[0].id).toBe(a);
    expect(row.stages[0].progress).toBe(0); // ahora manda la actividad
  });

  it("no se edita la estructura de un proyecto en la papelera", async () => {
    const p = await project();
    await call("DELETE", `/projects/${p.id}`);
    await expectStatus(409, op(p.id, { op: "stage.add", data: { title: "x" } }));
  });
});

describe("plantillas y copias", () => {
  it("aplicar una plantilla a un proyecto existente: añadir al final o sustituir", async () => {
    const p = await project({ stages: [{ title: "Propia" }] });
    let r = await call("POST", `/projects/${p.id}/structure`, { from: { type: "sop", id: "sop-tpl-research" }, mode: "append" });
    expect(r.stages.map((s: any) => s.title)).toEqual(["Propia", "Planteamiento del problema", "Marco teórico", "Metodología", "Recolección y análisis", "Resultados y conclusiones"]);
    r = await call("POST", `/projects/${p.id}/structure`, { from: { type: "sop", id: "sop-tpl-research" }, mode: "replace" });
    expect(r.stages).toHaveLength(5);
    await expectStatus(400, call("POST", `/projects/${p.id}/structure`, { from: { type: "project", id: p.id }, mode: "append" }));
  });

  it("guardar un proyecto como plantilla y reutilizarla sin compartir estructuras modificables", async () => {
    const p = await project({ title: "Web corporativa", stages: [{ title: "Diseño" }] });
    const st = p.stages[0].id;
    const act = (await op(p.id, { op: "activity.add", stageId: st, data: { title: "Maqueta" } })).createdId;
    await op(p.id, { op: "activity.update", stageId: st, activityId: act, data: { status: "done" } });
    const tpl = await call("POST", "/sops", { kind: "template", name: "Web", from: { type: "project", id: p.id } });
    expect(tpl.stages[0].activities[0]).toMatchObject({ title: "Maqueta", status: "pending" });
    const q = await project({ title: "Web 2", from: { type: "sop", id: tpl.id } });
    // Modificar el nuevo proyecto no toca ni la plantilla ni el proyecto de origen.
    await op(q.id, { op: "activity.update", stageId: q.stages[0].id, activityId: q.stages[0].activities[0].id, data: { title: "Maqueta v2" } });
    expect((await call("GET", `/sops/${tpl.id}`)).stages[0].activities[0].title).toBe("Maqueta");
    expect((await get(p.id)).stages[0].activities[0].title).toBe("Maqueta");
  });

  it("duplicar un proyecto: copia independiente que empieza de cero", async () => {
    const p = await project({ title: "Original", objectives: [{ text: "Entregar", done: true }], stages: [{ title: "Etapa" }], status: "finished" });
    await op(p.id, { op: "activity.add", stageId: p.stages[0].id, data: { title: "Tarea", status: "done" } });
    const d = await call("POST", `/projects/${p.id}/duplicate`);
    expect(d).toMatchObject({ title: "Original (copia)", status: "active", finishedAt: null });
    expect(d.objectives[0].done).toBe(false);
    expect(d.stages[0].activities[0].status).toBe("pending");
    await op(d.id, { op: "stage.update", stageId: d.stages[0].id, data: { title: "Cambiada" } });
    expect((await get(p.id)).stages[0].title).toBe("Etapa");
  });
});

describe("sincronización", () => {
  it("los proyectos con estructura ampliada viajan validados", async () => {
    const p = await project({ from: { type: "sop", id: "sop-tpl-software" }, client: "ACME", budget: 100 });
    const offer = buildOffer(loadDb(), { deviceId: "pc", name: "PC" } as any, null, null);
    expect(validateOffer(offer).errors).toEqual([]);
    const tampered = structuredClone(offer);
    (tampered.entries.find((e: any) => e.key === `projects:${p.id}`)!.row as any).stages[0].activities[0].status = "volando";
    expect(validateOffer(tampered).errors.length).toBeGreaterThan(0);
  });
});
