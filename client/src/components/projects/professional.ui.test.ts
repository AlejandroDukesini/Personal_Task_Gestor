// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { Route, Routes } from "react-router-dom";
import { Projects } from "@/pages/Projects";
import { loadDb } from "@/services/localDb";
import { call } from "@/test/helpers";
import { click, field, mount, submit, text, type, unmount } from "@/test/ui";

beforeEach(() => {
  (window as any).confirm = vi.fn(() => true);
  (window as any).prompt = vi.fn((_: string, d: string) => d);
});
afterEach(() => unmount());

const app = (url: string) =>
  mount(
    createElement(Routes, null, createElement(Route, { path: "/proyectos", element: createElement(Projects) }), createElement(Route, { path: "/proyectos/:id", element: createElement(Projects) })),
    url
  );

describe("Proyectos profesionales: sistema de trabajo (interfaz)", () => {
  it("crear un proyecto con datos profesionales a partir de una plantilla SOP", async () => {
    await app("/proyectos");
    await click("Nuevo proyecto");
    await type("Título", "App empresarial");
    await type("Cliente o entidad", "ACME");
    await type("Responsable", "Laura");
    await type("Prioridad", "high");
    await type("Presupuesto", "15.000.000");
    const radio = [...document.querySelectorAll("label")].find((l) => l.textContent?.startsWith("Plantilla SOP"))!.querySelector("input")!;
    await click(radio);
    await type("Plantilla", "sop-tpl-software");
    await click(/^Crear proyecto$/);
    const p = loadDb().projects.find((x) => x.title === "App empresarial")!;
    expect(p).toMatchObject({ client: "ACME", owner: "Laura", priority: "high", budget: 15_000_000, sourceTemplateId: "sop-tpl-software" });
    expect(p.stages).toHaveLength(9);
  });

  it("vista «Sistema de trabajo»: crear etapa y actividades, completar y ver el progreso", async () => {
    const p = await call("POST", "/projects", { title: "Portal" });
    await app(`/proyectos/${p.id}?modo=sistema`);
    expect(text()).toContain("Sistema de trabajo");
    await type("Título de la nueva etapa", "Análisis");
    await click("Añadir etapa");
    await type(field("Nueva actividad"), "Reunión inicial");
    await submit("Nueva actividad");
    await type(field("Nueva actividad"), "Documento de requisitos");
    await submit("Nueva actividad");
    await click("Completar Reunión inicial");
    const row = loadDb().projects.find((x) => x.id === p.id)!;
    expect(row.stages[0].activities!.map((a) => [a.title, a.status])).toEqual([["Reunión inicial", "done"], ["Documento de requisitos", "pending"]]);
    expect(row.stages[0].progress).toBe(50);
    expect(text()).toContain("50 %");

    // Aplicar una plantilla al final.
    await click(/^Aplicar plantilla$/);
    await type("Plantilla", "sop-tpl-research");
    await click(/^Aplicar$/);
    expect(loadDb().projects.find((x) => x.id === p.id)!.stages).toHaveLength(6);

    // Guardar como plantilla.
    await click(/^Guardar como plantilla$/);
    expect(loadDb().sops.find((s) => s.kind === "template" && s.name === "Portal")?.stages).toHaveLength(6);
  });

  it("administrador de plantillas: usar una plantilla en un proyecto nuevo", async () => {
    await app("/proyectos?vista=plantillas");
    expect(text()).toContain("Desarrollo de software");
    expect(text()).toContain("Proyecto de investigación");
    await click("Acciones de Proyecto de investigación");
    await click("Usar en un proyecto nuevo");
    expect((field("Plantilla") as HTMLSelectElement).value).toBe("sop-tpl-research");
    await type("Título", "Tesis");
    await click(/^Crear proyecto$/);
    expect(loadDb().projects.find((x) => x.title === "Tesis")!.stages).toHaveLength(5);
  });

  it("duplicar un proyecto desde su detalle", async () => {
    const p = await call("POST", "/projects", { title: "Base", stages: [{ title: "Única" }] });
    await app(`/proyectos/${p.id}`);
    await click(`Acciones de Base`);
    await click("Duplicar proyecto");
    const copy = loadDb().projects.find((x) => x.title === "Base (copia)")!;
    expect(copy.stages[0].title).toBe("Única");
    expect(copy.stages[0].id).not.toBe(p.stages[0].id);
  });
});
