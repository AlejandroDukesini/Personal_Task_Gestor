// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { Finance } from "@/pages/Finance";
import { Notes } from "@/pages/Notes";
import { loadDb } from "@/services/localDb";
import { call } from "@/test/helpers";
import { textToDoc } from "@/services/notes/content";
import { click, mount, text, type, unmount } from "@/test/ui";

beforeEach(() => {
  (window as any).confirm = vi.fn(() => true);
});
afterEach(() => unmount());

describe("Finanzas › Notas (interfaz)", () => {
  it("lista solo las notas financieras, sin exigir cuentas, y crea una nueva en ese bloc", async () => {
    await call("POST", "/notes", { title: "Nota general", content: textToDoc("x") });
    await call("POST", "/notes", { space: "finance", title: "Plan de ahorro", content: textToDoc("Precio estimado 3.000.000"), categoryId: "notecat-fin-savings", tags: ["computador"] });
    await mount(createElement(Finance), "/finanzas?tab=notas");
    expect(text()).toContain("Plan de ahorro");
    expect(text()).toContain("#computador");
    expect(text()).not.toContain("Nota general");
    expect(text()).not.toContain("Empieza creando una cuenta");

    await click("Nueva nota");
    await type("Título", "Deuda con Juan");
    await click(/^Crear y escribir$/);
    const created = loadDb().notes.find((n) => n.title === "Deuda con Juan");
    expect(created?.space).toBe("finance");
    expect(loadDb().finTransactions).toHaveLength(0);
  });

  it("fijar desde el menú y el bloc general no muestra las financieras", async () => {
    const n = await call("POST", "/notes", { space: "finance", title: "Inversiones 2027", content: textToDoc("x") });
    await mount(createElement(Finance), "/finanzas?tab=notas");
    await click("Acciones de Inversiones 2027");
    await click("Fijar arriba");
    expect(loadDb().notes.find((x) => x.id === n.id)?.pinned).toBe(true);

    await mount(createElement(Notes), "/notas");
    expect(text()).not.toContain("Inversiones 2027");
  });
});
