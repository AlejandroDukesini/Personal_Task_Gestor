// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { Projects } from "@/pages/Projects";
import { loadDb } from "@/services/localDb";
import { call } from "@/test/helpers";
import { click, mount, text, type, unmount } from "@/test/ui";

beforeEach(() => {
  (window as any).confirm = vi.fn(() => true);
});
afterEach(() => unmount());

describe("Proyectos: profesional y personal (interfaz)", () => {
  it("los proyectos existentes aparecen en Profesional y no en Personal", async () => {
    await call("POST", "/projects", { title: "Sistema de facturación" });
    await mount(createElement(Projects), "/proyectos");
    expect(text()).toContain("Profesional");
    expect(text()).toContain("Sistema de facturación");
    await click(/^Personal$/);
    expect(text()).not.toContain("Sistema de facturación");
    expect(text()).toContain("Aún no tienes proyectos personales");
    await click(/^Metas$/);
    expect(text()).toContain("Aún no tienes metas personales");
  });

  it("crear una meta personal desde la pestaña Personal", async () => {
    await mount(createElement(Projects), "/proyectos?seccion=personal&tipo=metas");
    await click("Nueva meta");
    await type("Nombre de la meta", "Comprar una motocicleta");
    await type("Fecha objetivo", "2027-10-18");
    await click(/^Crear meta$/);
    expect(loadDb().personalGoals.map((g) => [g.title, g.targetDate])).toEqual([["Comprar una motocicleta", "2027-10-18"]]);
    expect(text()).toContain("Comprar una motocicleta");
  });

  it("mover un proyecto a Personal desde su menú y volver a Profesional, sin perder nada", async () => {
    const p = await call("POST", "/projects", { title: "Viaje a Japón", endDate: "2027-04-01", stages: [{ title: "Vuelos" }, { title: "Hoteles" }] });
    const before = structuredClone(loadDb().projects[0]);
    await mount(createElement(Projects), "/proyectos");
    await click("Acciones de Viaje a Japón");
    await click("Mover a Personal");
    expect(text()).not.toContain("Viaje a Japón");
    expect(loadDb().projects).toHaveLength(1);
    expect(loadDb().personalGoals).toHaveLength(0);
    const after = loadDb().projects[0];
    expect(after).toMatchObject({ id: p.id, kind: "personal", deletedAt: null, stages: before.stages, endDate: "2027-04-01" });

    await click(/^Personal$/);
    expect(text()).toContain("Viaje a Japón");
    expect(text()).toContain("0/2 etapas");
    await click("Acciones de Viaje a Japón");
    await click("Mover a Profesional");
    expect(loadDb().projects[0]).toMatchObject({ id: p.id, kind: "professional", stages: before.stages });
  });
});
