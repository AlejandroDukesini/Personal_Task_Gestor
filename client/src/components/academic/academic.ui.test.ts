// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { Academic } from "@/pages/Academic";
import { loadDb } from "@/services/localDb";
import { call } from "@/test/helpers";
import { click, field, mount, settle, text, type, unmount } from "@/test/ui";

beforeEach(() => {
  (window as any).confirm = vi.fn(() => true);
});
afterEach(() => unmount());

const page = (tab = "") => mount(createElement(Academic), `/universidad${tab ? `?tab=${tab}` : ""}`);

describe("Tareas universitarias (interfaz)", () => {
  it("sin semestres invita a crear uno y el formulario lo guarda de verdad", async () => {
    await page();
    expect(text()).toContain("Empieza creando tu semestre");
    await click("Crear semestre");
    await click("Nuevo semestre");
    await type("Nombre", "2026-2");
    await type("Inicio", "2026-08-01");
    await type("Finalización", "2026-12-15");
    await click(/^Crear semestre$/);
    await settle();
    const db = loadDb();
    expect(db.acadSemesters.map((s) => s.name)).toEqual(["2026-2"]);
    expect(db.acadSemesters[0].active).toBe(true);
  });

  it("materias, horario con aviso de solape y actividades desde la interfaz", async () => {
    const sem = await call("POST", "/academic/semesters", { name: "2026-2", startDate: "2026-08-01", endDate: "2026-12-15" });
    const calc = await call("POST", "/academic/subjects", { semesterId: sem.id, name: "Cálculo", professor: "Ana Ruiz", room: "B-204" });
    await call("POST", "/academic/classes", { subjectId: calc.id, day: 1, startTime: "08:00", endTime: "10:00" });

    // Materias: crear una nueva desde el panel lateral.
    await page("materias");
    expect(text()).toContain("Cálculo");
    expect(text()).toContain("Ana Ruiz");
    await click("Nueva materia");
    await type("Nombre de la asignatura", "Física");
    await type("Créditos", "4");
    await click(/^Crear materia$/);
    expect(loadDb().acadSubjects.find((s) => s.name === "Física")?.credits).toBe(4);

    // Horario: una clase que choca pide confirmación y se guarda solo si se acepta.
    await page("horario");
    expect(text()).toContain("08:00–10:00");
    await click("Nueva clase");
    await type("Inicio", "09:00");
    await type("Fin", "11:00");
    expect(text()).toContain("Se solapa con Cálculo");
    (window.confirm as any).mockReturnValueOnce(false);
    await click(/^Añadir$/);
    expect(loadDb().acadClasses).toHaveLength(1);
    await click(/^Añadir$/);
    expect(loadDb().acadClasses).toHaveLength(2);
    expect(text()).toContain("clases que se solapan");

    // Actividades: crear un parcial y completarlo con un clic.
    await page("actividades");
    await click("Nueva actividad");
    await type("Título", "Parcial 1");
    await type("Tipo de actividad", "exam");
    await type("Fecha límite", "2026-12-01");
    await click(/^Crear actividad$/);
    const act = loadDb().acadActivities[0];
    expect(act).toMatchObject({ title: "Parcial 1", type: "exam", status: "pending" });
    await click("Completar Parcial 1");
    expect(loadDb().acadActivities[0].status).toBe("done");

    // Panel: refleja lo registrado.
    await page("panel");
    expect(text()).toContain("Próximos parciales");
    expect(text()).toContain("Materias activas");
    expect(text()).toContain("Física");
  });

  it("filtros de actividades por estado", async () => {
    const sem = await call("POST", "/academic/semesters", { name: "S", startDate: "2026-01-01", endDate: "2026-12-31" });
    await call("POST", "/academic/activities", { semesterId: sem.id, title: "Vieja", dueDate: "2020-01-01" });
    await call("POST", "/academic/activities", { semesterId: sem.id, title: "Hecha", status: "done" });
    await page("actividades");
    expect(text()).toContain("Vieja");
    await type(field("Estado"), "overdue");
    expect(text()).toContain("Vieja");
    expect(text()).not.toContain("Hecha");
  });
});
