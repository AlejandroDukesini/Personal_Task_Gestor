import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { dropCache, loadDb, mutate, type ProjectRow } from "@/services/localDb";
import { call, expectStatus } from "@/test/helpers";
import { buildOffer, validateOffer } from "@/services/manualsync/engine";
import { PROJECT_ROW_SCHEMAS } from "./schemas";
import { projectProgress } from "./progress";

const op = (id: string, body: Record<string, unknown>) => call("POST", `/projects/${id}/ops`, body);
const move = (id: string, kind: "personal" | "professional") => call<ProjectRow>("POST", `/projects/${id}/kind`, { kind });
const list = (kind: string, view = "all") => call("GET", `/projects?view=${view}&kind=${kind}`);
const row = (id: string) => structuredClone(loadDb().projects.find((p) => p.id === id)!);
/** Todo menos lo que la reclasificación puede cambiar. */
const content = ({ kind: _k, updatedAt: _u, ...rest }: ProjectRow) => rest;

/** Proyecto completo: plantilla SOP, etapas, procedimientos, actividades, tareas, fechas, prioridades, objetivos y documentación. */
async function richProject() {
  const p = await call<ProjectRow>("POST", "/projects", {
    title: "Plataforma de pagos",
    description: "## Alcance\nIntegración con **pasarela** y conciliación.",
    tag: "Cliente ACME",
    color: "#0ea5e9",
    startDate: "2026-11-01",
    endDate: "2027-04-30",
    client: "ACME S.A.",
    owner: "Laura",
    priority: "high",
    budget: 12_000_000,
    status: "active",
    objectives: [
      { text: "Salir a producción", done: false },
      { text: "Firmar contrato", done: true },
    ],
    from: { type: "sop", id: "sop-tpl-software" },
  });
  const [s1, s2] = p.stages;
  const e3 = (await op(p.id, { op: "stage.add", data: { title: "Soporte", priority: "low", startDate: "2027-04-01", endDate: "2027-04-30" } })).createdId;
  await op(p.id, { op: "procedure.add", stageId: e3, data: { title: "Atención", instructions: "1. Registrar el caso\n2. Resolver" } });
  const a1 = (await op(p.id, { op: "activity.add", stageId: e3, data: { title: "Turnos de guardia", dueDate: "2027-04-10", priority: "critical" } })).createdId;
  const a2 = (await op(p.id, { op: "activity.add", stageId: e3, data: { title: "Informe final", dependsOn: [a1] } })).createdId;
  await op(p.id, { op: "check.add", owner: { stageId: e3, activityId: a1 }, text: "Calendario publicado" });
  await op(p.id, { op: "activity.update", stageId: e3, activityId: a1, data: { status: "done" } });
  await op(p.id, { op: "activity.update", stageId: e3, activityId: a2, data: { status: "in_progress" } });
  await op(p.id, { op: "activity.update", stageId: s1.id, activityId: s1.activities![0].id, data: { status: "done" } });
  await op(p.id, { op: "stage.update", stageId: s2.id, data: { notes: "Documentación técnica de la etapa" } });
  return row(p.id);
}

describe("reclasificar proyectos (profesional ⇄ personal)", () => {
  it("mover a Personal conserva el proyecto íntegro, con el mismo id y sin duplicados", async () => {
    const other = await call<ProjectRow>("POST", "/projects", { title: "Otro proyecto", stages: [{ title: "A" }] });
    const before = await richProject();
    const otherBefore = row(other.id);
    const sopsBefore = JSON.stringify(loadDb().sops);
    const goalsBefore = JSON.stringify(loadDb().personalGoals);
    const countBefore = loadDb().projects.length;
    // Hay algo que perder: etapas, actividades, tareas, procedimientos y avance.
    expect(before.stages.length).toBe(10);
    expect(before.stages[9].activities).toHaveLength(2);
    expect(before.stages[9].activities![0].checklist).toHaveLength(1);
    expect(projectProgress(before.stages)).toBeGreaterThan(0);

    const moved = await move(before.id, "personal");
    expect(moved.id).toBe(before.id);
    expect(moved.kind).toBe("personal");
    const after = row(before.id);
    expect(content(after)).toEqual(content(before)); // nada cambia salvo la clasificación
    expect(after.deletedAt).toBeNull();
    expect(projectProgress(after.stages)).toBe(projectProgress(before.stages));
    expect(after.stages[9].activities!.map((a) => a.status)).toEqual(["done", "in_progress"]);
    expect(after.stages[9].activities![1].dependsOn).toEqual([before.stages[9].activities![0].id]);
    expect(after.sourceTemplateId).toBe("sop-tpl-software");

    expect(loadDb().projects.length).toBe(countBefore);
    expect(loadDb().projects.filter((p) => p.id === before.id)).toHaveLength(1);
    expect(loadDb().tombstones.some((t) => t.id === before.id)).toBe(false);
    // Otros proyectos, plantillas SOP y metas personales no se tocan.
    expect(row(other.id)).toEqual(otherBefore);
    expect(JSON.stringify(loadDb().sops)).toBe(sopsBefore);
    expect(JSON.stringify(loadDb().personalGoals)).toBe(goalsBefore);

    // Cambia de pestaña.
    expect((await list("personal")).items.map((p: any) => p.id)).toEqual([before.id]);
    expect((await list("professional")).items.map((p: any) => p.id)).toEqual([other.id]);
    expect((await list("personal")).counts.all).toBe(1);
    expect((await list("professional")).counts.all).toBe(1);
  });

  it("persiste tras reiniciar la aplicación y vuelve a Profesional sin perder nada", async () => {
    const before = await richProject();
    await move(before.id, "personal");
    dropCache(); // reinicio: la siguiente lectura sale del almacenamiento
    const reloaded = row(before.id);
    expect(reloaded.kind).toBe("personal");
    expect(content(reloaded)).toEqual(content(before));

    await move(before.id, "professional");
    dropCache();
    const back = row(before.id);
    expect(back.kind).toBe("professional");
    expect(content(back)).toEqual(content(before));
    expect((await list("professional")).items.map((p: any) => p.id)).toEqual([before.id]);
    expect((await list("personal")).items).toHaveLength(0);
  });

  it("el proyecto personal sigue siendo editable y repetir el traslado no hace nada", async () => {
    const p = await richProject();
    const moved = await move(p.id, "personal");
    const again = await move(p.id, "personal");
    expect(again.updatedAt).toBe(moved.updatedAt);
    const stage = (await op(p.id, { op: "stage.add", data: { title: "Cierre" } })).createdId;
    expect(row(p.id).stages.some((s) => s.id === stage)).toBe(true);
    // Editar no cambia la sección por accidente.
    await call("PUT", `/projects/${p.id}`, { title: "Plataforma de pagos v2", kind: "professional" });
    expect(row(p.id).kind).toBe("personal");
    // Duplicar conserva la sección.
    const copy = await call<ProjectRow>("POST", `/projects/${p.id}/duplicate`);
    expect(copy.kind).toBe("personal");
  });

  it("los proyectos antiguos sin clasificación son profesionales; valores raros se rechazan", async () => {
    const p = await call<ProjectRow>("POST", "/projects", { title: "Antiguo" });
    mutate((db) => {
      delete db.projects[0].kind;
    });
    expect((await list("professional")).items.map((x: any) => x.id)).toEqual([p.id]);
    expect((await list("personal")).items).toHaveLength(0);
    await expectStatus(400, call("POST", `/projects/${p.id}/kind`, { kind: "otro" }));
    await call("DELETE", `/projects/${p.id}`);
    await expectStatus(409, move(p.id, "personal")); // en la papelera: restaurar primero
    expect(row(p.id).kind).toBeUndefined();
  });

  it("crear directamente en Personal", async () => {
    const p = await call<ProjectRow>("POST", "/projects", { title: "Mudanza", kind: "personal", stages: [{ title: "Cajas" }] });
    expect(p.kind).toBe("personal");
    expect((await list("personal")).items.map((x: any) => x.id)).toEqual([p.id]);
  });

  it("la clasificación sobrevive a la validación de copias de seguridad y sincronización", async () => {
    const p = await richProject();
    await move(p.id, "personal");
    const parsed = PROJECT_ROW_SCHEMAS.projects.parse(row(p.id));
    expect(parsed.kind).toBe("personal");
    expect(parsed).toEqual(row(p.id));
    const offer = buildOffer(loadDb(), { deviceId: "pc", name: "PC" } as any, null, null);
    expect(validateOffer(offer).errors).toEqual([]);
    expect((offer.entries.find((e: any) => e.key === `projects:${p.id}`)!.row as any).kind).toBe("personal");
  });
});
