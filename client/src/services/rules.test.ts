// Reglas de negocio del núcleo, probadas contra la API local (la misma que usan
// las páginas). Todas las peticiones van directas al router, sin pasar por los
// formularios: así se comprueba que la regla no depende del frontend. Cada
// rechazo verifica además que la base quedó intacta.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDb } from "@/services/localDb";
import { call, expectStatus, makeAccount } from "@/test/helpers";
import { fromLocalInput, toLocalInput } from "@/lib/utils";
import { MESSAGES, eventRangeError, goalDatesError, habitDaysError, taskCompletionError, taskDatesError } from "./rules";

/** Instantánea de la base para comprobar que un rechazo no escribió nada. */
const snapshot = () => JSON.stringify({ ...loadDb(), savedAt: undefined });

async function expectRejected(status: number, p: Promise<unknown>, message?: string) {
  const before = snapshot();
  const msg = await expectStatus(status, p);
  if (message) expect(msg).toContain(message);
  expect(snapshot()).toBe(before);
  return msg;
}

/* ================================================================= fechas */

describe("fechas de tareas: inicio ≤ vencimiento", () => {
  it("inicio 2026-10-01, vencimiento 2026-10-10 → permitido", async () => {
    const t = await call("POST", "/tasks", { title: "Informe", startDate: "2026-10-01", dueDate: "2026-10-10" });
    expect(t.startDate.slice(0, 10)).toBe("2026-10-01");
    expect(t.dueDate.slice(0, 10)).toBe("2026-10-10");
  });

  it("inicio 2026-10-10, vencimiento 2026-10-01 → rechazado y nada se guarda", async () => {
    await expectRejected(400, call("POST", "/tasks", { title: "Informe", startDate: "2026-10-10", dueDate: "2026-10-01" }), MESSAGES.taskDates);
    expect(loadDb().tasks.some((t) => t.title === "Informe")).toBe(false);
  });

  it("mismo día → permitido (una tarea puede empezar y vencer el mismo día)", async () => {
    const t = await call("POST", "/tasks", { title: "Llamada", startDate: "2026-10-10", dueDate: "2026-10-10" });
    expect(t.id).toBeTruthy();
  });

  it("un PUT parcial no puede invertir las fechas de una tarea existente", async () => {
    const t = await call("POST", "/tasks", { title: "Informe", startDate: "2026-10-01", dueDate: "2026-10-10" });
    await expectRejected(400, call("PUT", `/tasks/${t.id}`, { startDate: "2026-10-20" }), MESSAGES.taskDates);
    await expectRejected(400, call("PUT", `/tasks/${t.id}`, { dueDate: "2026-09-01" }), MESSAGES.taskDates);
    expect(loadDb().tasks.find((x) => x.id === t.id)!.startDate!.slice(0, 10)).toBe("2026-10-01");
  });

  it("fecha con formato incorrecto → 400 claro (antes saltaba un RangeError)", async () => {
    const msg = await expectRejected(400, call("POST", "/tasks", { title: "X", dueDate: "mañana" }));
    expect(msg).toContain("fecha no válida");
  });

  it("hora mal formada o sin fecha de vencimiento → rechazada; vacía equivale a sin hora", async () => {
    await expectRejected(400, call("POST", "/tasks", { title: "X", dueDate: "2026-10-10", dueTime: "25:99" }), "Hora no válida");
    await expectRejected(400, call("POST", "/tasks", { title: "X", dueTime: "10:00" }), MESSAGES.taskTimeWithoutDate);
    const t = await call("POST", "/tasks", { title: "X", dueDate: "2026-10-10", dueTime: "" });
    expect(t.dueTime).toBeNull();
  });

  it("recordatorio sin vencimiento → rechazado (antes se ignoraba en silencio)", async () => {
    await expectRejected(400, call("POST", "/tasks", { title: "X", reminderMinutes: 30 }), MESSAGES.taskReminderWithoutDate);
    const t = await call("POST", "/tasks", { title: "X", dueDate: "2030-01-10" });
    await expectRejected(400, call("PUT", `/tasks/${t.id}`, { dueDate: null, reminderMinutes: 10 }), MESSAGES.taskReminderWithoutDate);
  });

  it("filas antiguas con fechas invertidas siguen pudiendo cambiar de estado", async () => {
    const t = await call("POST", "/tasks", { title: "Antigua" });
    // Simula un dato previo a la regla, escrito directamente en el almacenamiento.
    const raw = JSON.parse(localStorage.getItem("gestion-tareas:db")!);
    Object.assign(raw.tasks.find((x: { id: string }) => x.id === t.id), { startDate: "2026-10-10T00:00:00.000Z", dueDate: "2026-10-01T00:00:00.000Z" });
    localStorage.setItem("gestion-tareas:db", JSON.stringify(raw));
    const { dropCache } = await import("@/services/localDb");
    dropCache();
    expect(loadDb().tasks.find((x) => x.id === t.id)!.startDate).toBe("2026-10-10T00:00:00.000Z");
    const done = await call("PUT", `/tasks/${t.id}`, { status: "completed" });
    expect(done.status).toBe("completed");
  });
});

describe("fechas de eventos: fin > inicio", () => {
  const base = { title: "Reunión" };

  it("fin posterior al inicio → permitido", async () => {
    const e = await call("POST", "/events", { ...base, start: "2026-10-01T10:00:00Z", end: "2026-10-01T11:00:00Z" });
    expect(e.id).toBeTruthy();
  });

  it("fin anterior al inicio → rechazado", async () => {
    await expectRejected(400, call("POST", "/events", { ...base, start: "2026-10-10T10:00:00Z", end: "2026-10-01T10:00:00Z" }), MESSAGES.eventRange);
  });

  it("fin igual al inicio → rechazado (un evento ocupa un intervalo)", async () => {
    await expectRejected(400, call("POST", "/events", { ...base, start: "2026-10-10T10:00:00Z", end: "2026-10-10T10:00:00Z" }), MESSAGES.eventRange);
  });

  it("inicio o fin ausentes o inválidos → rechazado", async () => {
    await expectRejected(400, call("POST", "/events", { ...base, start: "2026-10-10T10:00:00Z" }));
    await expectRejected(400, call("POST", "/events", { ...base, start: "2026-10-10T10:00:00Z", end: "" }), "fecha no válida");
  });

  it("mover solo el inicio más allá del fin → rechazado; moverlo dentro → permitido", async () => {
    const e = await call("POST", "/events", { ...base, start: "2026-10-01T10:00:00Z", end: "2026-10-01T11:00:00Z" });
    await expectRejected(400, call("PUT", `/events/${e.id}`, { start: "2026-10-01T12:00:00Z" }), MESSAGES.eventRange);
    const moved = await call("PUT", `/events/${e.id}`, { start: "2026-10-01T10:30:00Z" });
    expect(moved.start).toBe("2026-10-01T10:30:00.000Z");
  });
});

describe("objetivos: fecha límite, meta y origen", () => {
  // "Hoy" fijo para que las fechas de los casos no caduquen con el tiempo.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T15:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("inicio 2026-10-01, límite 2026-10-10 → permitido", async () => {
    const g = await call("POST", "/goals", { title: "Leer", startDate: "2026-10-01", endDate: "2026-10-10" });
    expect(g.endDate.slice(0, 10)).toBe("2026-10-10");
  });

  it("límite anterior al inicio → rechazado", async () => {
    await expectRejected(400, call("POST", "/goals", { title: "Leer", startDate: "2026-10-10", endDate: "2026-10-08" }), MESSAGES.goalDates);
  });

  it("mismo día → permitido (objetivo diario)", async () => {
    const g = await call("POST", "/goals", { title: "Hoy", type: "daily", startDate: "2026-10-10", endDate: "2026-10-10" });
    expect(g.id).toBeTruthy();
  });

  it("sin inicio explícito empieza hoy en el día LOCAL: un objetivo diario creado de noche es válido", async () => {
    // 21:00 en Bogotá = 02:00 UTC del día siguiente.
    vi.setSystemTime(new Date("2026-10-06T02:00:00Z"));
    const g = await call("POST", "/goals", { title: "Hoy", type: "daily", endDate: "2026-10-05" });
    expect(g.startDate.slice(0, 10)).toBe("2026-10-05");
  });

  it("crear con fecha límite pasada → rechazado; editar uno antiguo sí se permite", async () => {
    await expectRejected(400, call("POST", "/goals", { title: "Viejo", startDate: "2026-01-01", endDate: "2026-02-01" }), MESSAGES.goalPastDeadline);
    const g = await call("POST", "/goals", { title: "Vigente", startDate: "2026-10-01", endDate: "2026-10-20" });
    vi.setSystemTime(new Date("2026-12-01T12:00:00Z"));
    const edited = await call("PUT", `/goals/${g.id}`, { title: "Vigente (renombrado)" });
    expect(edited.title).toBe("Vigente (renombrado)");
  });

  it("meta 0 o negativa → rechazada (evita progreso NaN/Infinito)", async () => {
    await expectRejected(400, call("POST", "/goals", { title: "X", endDate: "2026-12-31", targetValue: 0 }), MESSAGES.goalTarget);
    await expectRejected(400, call("POST", "/goals", { title: "X", endDate: "2026-12-31", targetValue: -5 }), MESSAGES.goalTarget);
  });

  it("origen «finanzas» exige meta de ahorro (antes solo lo comprobaba el formulario)", async () => {
    await expectRejected(400, call("POST", "/goals", { title: "X", endDate: "2026-12-31", source: "finance" }), MESSAGES.goalFinance);
    const g = await call("POST", "/goals", { title: "X", endDate: "2026-12-31" });
    await expectRejected(400, call("PUT", `/goals/${g.id}`, { source: "finance" }), MESSAGES.goalFinance);
  });

  it("un PUT parcial no puede dejar la fecha límite antes del inicio", async () => {
    const g = await call("POST", "/goals", { title: "X", startDate: "2026-10-05", endDate: "2026-12-31" });
    await expectRejected(400, call("PUT", `/goals/${g.id}`, { endDate: "2026-10-01" }), MESSAGES.goalDates);
  });
});

describe("hábitos: fechas y días", () => {
  it("fin anterior al inicio → rechazado; igual o posterior → permitido", async () => {
    await expectRejected(400, call("POST", "/habits", { name: "Correr", startDate: "2026-10-10", endDate: "2026-10-01" }), MESSAGES.habitDates);
    const same = await call("POST", "/habits", { name: "Correr", startDate: "2026-10-10", endDate: "2026-10-10" });
    expect(same.id).toBeTruthy();
    await expectRejected(400, call("PUT", `/habits/${same.id}`, { endDate: "2026-10-01" }), MESSAGES.habitDates);
  });

  it("frecuencia personalizada sin días → rechazada; con días → permitida", async () => {
    await expectRejected(400, call("POST", "/habits", { name: "Gym", frequency: "custom", daysOfWeek: "" }), MESSAGES.habitDays);
    await expectRejected(400, call("POST", "/habits", { name: "Gym", frequency: "custom", daysOfWeek: "1,9" }), "Días de la semana no válidos");
    const h = await call("POST", "/habits", { name: "Gym", frequency: "custom", daysOfWeek: "1,3,5" });
    await expectRejected(400, call("PUT", `/habits/${h.id}`, { daysOfWeek: "" }), MESSAGES.habitDays);
  });
});

/* ====================================================== campos obligatorios */

describe("campos obligatorios", () => {
  const cases: [string, string, Record<string, unknown>, string][] = [
    ["tarea", "/tasks", {}, "title"],
    ["evento", "/events", { start: "2026-10-01T10:00:00Z", end: "2026-10-01T11:00:00Z" }, "title"],
    ["objetivo", "/goals", { endDate: "2099-12-31" }, "title"],
    ["hábito", "/habits", {}, "name"],
    ["categoría", "/categories", {}, "name"],
    ["etiqueta", "/tags", {}, "name"],
  ];

  for (const [what, path, rest, field] of cases) {
    it(`${what}: ${field} null, vacío o solo espacios → rechazado`, async () => {
      for (const value of [null, undefined, "", "    "]) {
        const msg = await expectRejected(400, call("POST", path, { ...rest, [field]: value }));
        expect(msg).toContain("es obligatorio");
      }
    });
  }

  it("el texto se guarda sin espacios sobrantes", async () => {
    const t = await call("POST", "/tasks", { title: "  Comprar pan  " });
    expect(t.title).toBe("Comprar pan");
  });

  it("vaciar el título con un PUT → rechazado", async () => {
    const t = await call("POST", "/tasks", { title: "Comprar pan" });
    await expectRejected(400, call("PUT", `/tasks/${t.id}`, { title: "   " }), "es obligatorio");
  });

  it("sub-paso sin título → rechazado", async () => {
    const t = await call("POST", "/tasks", { title: "Mudanza" });
    await expectRejected(400, call("POST", `/tasks/${t.id}/subtasks`, { title: "  " }), "es obligatorio");
  });

  it("objetivo sin fecha límite → rechazado", async () => {
    await expectRejected(400, call("POST", "/goals", { title: "X" }));
  });

  it("etiquetas duplicadas sin distinguir mayúsculas ni espacios → 409", async () => {
    await call("POST", "/tags", { name: "Trabajo" });
    await expectRejected(409, call("POST", "/tags", { name: " trabajo " }), "Ya existe");
  });
});

/* =================================================== referencias existentes */

describe("relaciones: no se guardan referencias a registros inexistentes", () => {
  it("tarea con categoría, etiqueta u objetivo inexistente → 404", async () => {
    await expectRejected(404, call("POST", "/tasks", { title: "X", categoryId: "no-existe" }), "Categoría");
    await expectRejected(404, call("POST", "/tasks", { title: "X", tagIds: ["no-existe"] }), "Etiqueta");
    await expectRejected(404, call("POST", "/tasks", { title: "X", goalId: "no-existe" }), "Objetivo");
    expect(loadDb().taskTags.some((tt) => tt.tagId === "no-existe")).toBe(false);
  });

  it("recordatorio de una tarea inexistente → 404", async () => {
    await expectRejected(404, call("POST", "/reminders", { triggerAt: "2030-01-01T10:00:00Z", taskId: "no-existe" }), "Tarea");
  });

  it("categoría padre: existente y principal → permitido; sí misma, inexistente o subcategoría → rechazado", async () => {
    const root = await call("POST", "/categories", { name: "Trabajo" });
    const child = await call("POST", "/categories", { name: "Reuniones", parentId: root.id });
    expect(child.parentId).toBe(root.id);
    await expectRejected(404, call("POST", "/categories", { name: "X", parentId: "no-existe" }));
    await expectRejected(400, call("POST", "/categories", { name: "X", parentId: child.id }), "Solo hay un nivel");
    await expectRejected(400, call("PUT", `/categories/${root.id}`, { parentId: root.id }), "su propia categoría padre");
    const other = await call("POST", "/categories", { name: "Personal" });
    await expectRejected(409, call("PUT", `/categories/${root.id}`, { parentId: other.id }), "tiene subcategorías");
  });

  it("operar sobre un id inexistente → 404 sin crear nada", async () => {
    await expectRejected(404, call("PUT", "/tasks/no-existe", { title: "X" }));
    await expectRejected(404, call("PUT", "/events/no-existe", { title: "X" }));
    await expectRejected(404, call("DELETE", "/goals/no-existe"));
  });
});

/* =========================================================== precondiciones */

describe("precondición: completar una tarea exige su checklist completo", () => {
  it("sub-pasos pendientes → 409; todos hechos → permitido", async () => {
    const t = await call("POST", "/tasks", { title: "Mudanza" });
    const a = await call("POST", `/tasks/${t.id}/subtasks`, { title: "Cajas" });
    const b = await call("POST", `/tasks/${t.id}/subtasks`, { title: "Camión" });
    await call("PATCH", `/subtasks/${a.id}`, { done: true });

    const msg = await expectRejected(409, call("PUT", `/tasks/${t.id}`, { status: "completed" }));
    expect(msg).toContain("1 de 2 hechos");
    const status = () => loadDb().tasks.find((x) => x.id === t.id)!.status;
    expect(status()).not.toBe("completed");

    // Marcar el último paso la cierra sola (regla previa, intacta).
    await call("PATCH", `/subtasks/${b.id}`, { done: true });
    expect(status()).toBe("completed");
  });

  it("la regla también rige al arrastrar en el Kanban (reorder) y es atómica", async () => {
    const free = await call("POST", "/tasks", { title: "Libre" });
    const blocked = await call("POST", "/tasks", { title: "Con pasos" });
    await call("POST", `/tasks/${blocked.id}/subtasks`, { title: "Paso" });
    await expectRejected(
      409,
      call("PATCH", "/tasks/reorder", [
        { id: free.id, position: 0, status: "completed" },
        { id: blocked.id, position: 1, status: "completed" },
      ])
    );
    // Ni siquiera la primera tarea cambió: el lote entero se descarta.
    expect(loadDb().tasks.find((t) => t.id === free.id)!.status).toBe("pending");
  });

  it("una tarea sin sub-pasos se completa libremente", async () => {
    const t = await call("POST", "/tasks", { title: "Simple" });
    const done = await call("PUT", `/tasks/${t.id}`, { status: "completed" });
    expect(done.status).toBe("completed");
  });

  it("crear una tarea ya completada (sin sub-pasos) sigue permitido", async () => {
    const t = await call("POST", "/tasks", { title: "Hecha", status: "completed" });
    expect(t.status).toBe("completed");
  });
});

describe("precondición: registrar hábitos", () => {
  const day = (offset: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d.toISOString();
  };

  it("hoy y días pasados → permitido; un día futuro → rechazado", async () => {
    const h = await call("POST", "/habits", { name: "Agua" });
    await call("POST", `/habits/${h.id}/logs`, { date: day(0) });
    await call("POST", `/habits/${h.id}/logs`, { date: day(-3) });
    await expectRejected(400, call("POST", `/habits/${h.id}/logs`, { date: day(1) }), MESSAGES.habitFutureLog);
    expect(loadDb().habitLogs).toHaveLength(2);
  });

  it("hábito archivado → 409; al reactivarlo vuelve a aceptar registros", async () => {
    const h = await call("POST", "/habits", { name: "Agua" });
    await call("PUT", `/habits/${h.id}`, { archived: true });
    await expectRejected(409, call("POST", `/habits/${h.id}/logs`, { date: day(0) }), MESSAGES.habitArchived);
    await call("PUT", `/habits/${h.id}`, { archived: false });
    const log = await call("POST", `/habits/${h.id}/logs`, { date: day(0) });
    expect(log.count).toBe(1);
  });
});

describe("precondición: aportar y retirar en metas de ahorro", () => {
  async function setup() {
    const main = await makeAccount({ initialBalance: 500000 });
    const piggy = await makeAccount({ type: "savings" });
    const goal = await call("POST", "/finance/goals", { name: "Moto", targetAmount: 300000, currency: "COP", startDate: "2026-09-01" });
    const move = (amount: number, withdraw = false) =>
      call("POST", `/finance/goals/${goal.id}/contribute`, { amount, date: "2026-09-02", fromAccountId: main.id, toAccountId: piggy.id, withdraw });
    return { goal, move };
  }

  it("activa → se puede aportar; pausada o archivada → 409", async () => {
    const { goal, move } = await setup();
    await move(1000);
    await call("PATCH", `/finance/goals/${goal.id}/status`, { status: "paused" });
    await expectRejected(409, move(1000), "no está activa");
    await call("PATCH", `/finance/goals/${goal.id}/status`, { status: "archived" });
    await expectRejected(409, move(1000), "no está activa");
  });

  it("retirar hasta lo ahorrado → permitido; más → 409; de una meta archivada → 409", async () => {
    const { goal, move } = await setup();
    await move(50000);
    await expectRejected(409, move(60000, true), "más de lo ahorrado");
    await move(50000, true);
    await move(10000);
    await call("PATCH", `/finance/goals/${goal.id}/status`, { status: "archived" });
    await expectRejected(409, move(5000, true), "archivada");
  });
});

/* ===================================================== estados de tareas */

describe("transiciones de estado de tareas", () => {
  it("pendiente → en progreso → completada → reabierta: válidas y coherentes con completedAt", async () => {
    const t = await call("POST", "/tasks", { title: "Flujo" });
    const prog = await call("PUT", `/tasks/${t.id}`, { status: "in_progress" });
    expect(prog.completedAt).toBeNull();
    const done = await call("PUT", `/tasks/${t.id}`, { status: "completed" });
    expect(done.completedAt).toBeTruthy();
    const reopened = await call("PUT", `/tasks/${t.id}`, { status: "pending" });
    expect(reopened.completedAt).toBeNull();
  });

  it("estado desconocido → rechazado", async () => {
    const t = await call("POST", "/tasks", { title: "Flujo" });
    await expectRejected(400, call("PUT", `/tasks/${t.id}`, { status: "archived" }));
  });
});

/* ============================================================ reglas puras */

describe("reglas puras (las mismas que usan los formularios)", () => {
  it("devuelven null si se cumplen y un mensaje claro si no", () => {
    expect(taskDatesError({ startDate: "2026-10-01", dueDate: "2026-10-10" })).toBeNull();
    expect(taskDatesError({ startDate: "2026-10-10", dueDate: "2026-10-01" })).toBe(MESSAGES.taskDates);
    expect(eventRangeError({ start: "2026-10-01T10:00:00Z", end: "2026-10-01T10:00:00Z" })).toBe(MESSAGES.eventRange);
    expect(goalDatesError({ startDate: "2026-10-10", endDate: "2026-10-10" })).toBeNull();
    expect(habitDaysError({ frequency: "custom", daysOfWeek: "" })).toBe(MESSAGES.habitDays);
    expect(habitDaysError({ frequency: "daily", daysOfWeek: "" })).toBeNull();
    expect(taskCompletionError([{ done: true }, { done: false }])).toContain("1 de 2");
    expect(taskCompletionError([])).toBeNull();
  });
});

/* ======================================================== zona horaria */

describe("formulario de eventos: hora local (TZ de pruebas = America/Bogota)", () => {
  it("el input muestra la hora local, no la UTC, y el viaje de ida y vuelta no desplaza el evento", () => {
    const iso = "2026-10-05T15:00:00.000Z"; // 10:00 en Bogotá
    expect(toLocalInput(iso)).toBe("2026-10-05T10:00");
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });

  it("vaciar el campo no lanza: queda vacío y el formulario lo marca como obligatorio", () => {
    expect(fromLocalInput("")).toBe("");
    expect(toLocalInput("")).toBe("");
  });
});
