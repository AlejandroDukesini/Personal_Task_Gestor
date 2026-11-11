// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { PersonalGoals } from "./PersonalGoals";
import { loadDb, localDateKey } from "@/services/localDb";
import { call } from "@/test/helpers";
import { click, field, mount, text, type, unmount } from "@/test/ui";

beforeEach(() => {
  (window as any).confirm = vi.fn(() => true);
  try {
    localStorage.removeItem("gestion-tareas:goals-view");
  } catch {
    /* */
  }
});
afterEach(() => unmount());

const year = Number(localDateKey().slice(0, 4));

describe("Metas personales: línea del tiempo (interfaz)", () => {
  it("muestra los años, la meta en su fecha con su color y la referencia de hoy", async () => {
    await call("POST", "/personal-goals", { title: "Comprar una motocicleta", targetDate: `${year + 1}-10-18`, color: "#ef4444" });
    await call("POST", "/personal-goals", { title: "Viaje", targetDate: `${year + 4}-03-01` });
    await call("POST", "/personal-goals", { title: "Curso antiguo", targetDate: `${year - 2}-05-05`, status: "completed" });
    await mount(createElement(PersonalGoals));
    for (const y of [year - 2, year, year + 1, year + 4]) expect(document.getElementById(`anio-${y}`)).not.toBeNull();
    expect(document.getElementById(`anio-${year + 2}`)).toBeNull(); // sin años vacíos
    expect(document.getElementById("hoy")?.textContent).toContain("Hoy");
    const moto = document.querySelector(`[aria-label^="Comprar una motocicleta, fecha objetivo"]`) as HTMLElement;
    expect(moto).not.toBeNull();
    expect(moto.textContent).toContain("18 oct");
    expect(moto.closest("section")!.id).toBe(`anio-${year + 1}`);
    expect(text()).toContain("Curso antiguo"); // las pasadas no desaparecen
  });

  it("el panel de detalle muestra la información y actualiza el avance con historial", async () => {
    const m = await call("POST", "/personal-goals", { title: "Aprender alemán", targetDate: `${year + 1}-02-01`, progress: 10 });
    await mount(createElement(PersonalGoals));
    await click(/^Aprender alemán, fecha objetivo/);
    expect(text()).toContain("Tiempo restante");
    expect(text()).toContain("Historial de cambios");
    await type(field("Nuevo avance"), "60");
    await click("Guardar avance");
    expect(loadDb().personalGoals.find((g) => g.id === m.id)!.progress).toBe(60);
    expect(text()).toContain("Avance: 10 % → 60 %");
    await click("Marcar como completada");
    expect(loadDb().personalGoals.find((g) => g.id === m.id)!.status).toBe("completed");
  });

  it("la leyenda resalta una fase sin ocultar las demás metas", async () => {
    await call("POST", "/personal-goals", { title: "Atrasada", targetDate: `${year - 1}-01-01` });
    await call("POST", "/personal-goals", { title: "Futura", targetDate: `${year + 3}-01-01` });
    await mount(createElement(PersonalGoals));
    await click(/^Retrasada/);
    const futura = document.querySelector(`[aria-label^="Futura, fecha objetivo"]`)!.closest("li")!;
    expect(futura.className).toContain("opacity-40");
    expect(text()).toContain("Futura");
  });
});
