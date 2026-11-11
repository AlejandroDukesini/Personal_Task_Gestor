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
    expect(text()).toContain("Aún no tienes metas personales");
  });

  it("crear una meta personal desde la pestaña Personal", async () => {
    await mount(createElement(Projects), "/proyectos?seccion=personal");
    await click("Nueva meta");
    await type("Nombre de la meta", "Comprar una motocicleta");
    await type("Fecha objetivo", "2027-10-18");
    await click(/^Crear meta$/);
    expect(loadDb().personalGoals.map((g) => [g.title, g.targetDate])).toEqual([["Comprar una motocicleta", "2027-10-18"]]);
    expect(text()).toContain("Comprar una motocicleta");
  });

  it("convertir un proyecto en meta personal desde su menú", async () => {
    const p = await call("POST", "/projects", { title: "Viaje a Japón", endDate: "2027-04-01" });
    await mount(createElement(Projects), "/proyectos");
    await click("Acciones de Viaje a Japón");
    await click("Convertir en meta personal");
    expect(loadDb().personalGoals[0]).toMatchObject({ title: "Viaje a Japón", targetDate: "2027-04-01", sourceProjectId: p.id });
    expect(loadDb().projects[0].deletedAt).not.toBeNull();
  });
});
