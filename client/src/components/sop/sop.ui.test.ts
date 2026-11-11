// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { Route, Routes } from "react-router-dom";
import { Sop } from "@/pages/Sop";
import { loadDb } from "@/services/localDb";
import { call } from "@/test/helpers";
import { click, field, mount, submit, text, type, unmount } from "@/test/ui";

beforeEach(() => {
  (window as any).confirm = vi.fn(() => true);
});
afterEach(() => unmount());

const app = (url: string) =>
  mount(
    createElement(Routes, null, createElement(Route, { path: "/sop", element: createElement(Sop) }), createElement(Route, { path: "/sop/:id", element: createElement(Sop) })),
    url
  );

describe("SOP (interfaz)", () => {
  it("las plantillas iniciales aparecen y se crea un SOP desde una de ellas", async () => {
    await app("/sop?tipo=plantillas");
    expect(text()).toContain("Desarrollo de software");
    await click("Acciones de Desarrollo de software");
    await click("Crear SOP con esta plantilla");
    const created = loadDb().sops.find((s) => s.kind === "sop");
    expect(created?.name).toBe("Desarrollo de software");
    expect(created?.stages).toHaveLength(9);
  });

  it("crea un SOP desde cero y construye su estructura desde la interfaz", async () => {
    await app("/sop");
    await click("Nuevo SOP");
    await type("Nombre", "Cierre mensual");
    await click(/^Crear$/);
    const s = loadDb().sops.find((x) => x.name === "Cierre mensual")!;
    expect(s.kind).toBe("sop");

    await app(`/sop/${s.id}`);
    await type("Título de la nueva etapa", "Conciliación");
    await click("Añadir etapa");
    expect(loadDb().sops.find((x) => x.id === s.id)!.stages.map((x) => x.title)).toEqual(["Conciliación"]);

    await type(field("Nueva actividad"), "Descargar extractos");
    await submit("Nueva actividad");
    await type(field("Nueva actividad"), "Cruzar movimientos");
    await submit("Nueva actividad");
    await type(field("Añadir a lista de verificación"), "Saldo cuadrado");
    await submit("Añadir a lista de verificación");
    let stage = loadDb().sops.find((x) => x.id === s.id)!.stages[0];
    expect(stage.activities.map((a) => a.title)).toEqual(["Descargar extractos", "Cruzar movimientos"]);
    expect(stage.checklist.map((c) => c.text)).toEqual(["Saldo cuadrado"]);

    await click("Completar Descargar extractos");
    await click("Bajar Descargar extractos");
    stage = loadDb().sops.find((x) => x.id === s.id)!.stages[0];
    expect(stage.activities.map((a) => a.title)).toEqual(["Cruzar movimientos", "Descargar extractos"]);
    expect(stage.progress).toBe(50);
    expect(text()).toContain("1/2 actividades completadas");

    // Panel de etapa: objetivo y documentación.
    await click(/^Editar etapa$/);
    await type("Objetivo de la etapa", "Cuadrar bancos");
    await type("Documentación", "- Extractos del banco");
    await click(/^Guardar$/);
    stage = loadDb().sops.find((x) => x.id === s.id)!.stages[0];
    expect(stage).toMatchObject({ objective: "Cuadrar bancos", documentation: "- Extractos del banco" });

    // Panel de actividad: prioridad y dependencia.
    await click(/^Cruzar movimientos/);
    await type("Prioridad", "high");
    const dep = [...document.querySelectorAll("label")].find((l) => l.textContent?.startsWith("Descargar extractos"))!.querySelector("input")!;
    await click(dep);
    await click(/^Guardar$/);
    stage = loadDb().sops.find((x) => x.id === s.id)!.stages[0];
    const cruzar = stage.activities.find((a) => a.title === "Cruzar movimientos")!;
    expect(cruzar.priority).toBe("high");
    expect(cruzar.dependsOn).toEqual([stage.activities.find((a) => a.title === "Descargar extractos")!.id]);
  });
});

it("archivar y restaurar desde el listado", async () => {
  const s = await call("POST", "/sops", { name: "Auditoría" });
  await app("/sop");
  await click("Acciones de Auditoría");
  await click("Archivar");
  expect(loadDb().sops.find((x) => x.id === s.id)!.status).toBe("archived");
  await click("Archivados");
  expect(text()).toContain("Auditoría");
  await click("Acciones de Auditoría");
  await click("Restaurar");
  expect(loadDb().sops.find((x) => x.id === s.id)!.status).toBe("active");
});
