import { describe, expect, it } from "vitest";
import { DB_VERSION, listDbBackups, loadDb, resetDb } from "@/services/localDb";
import { call } from "@/test/helpers";
import { nextDueDate } from "./localApi";

describe("migraciones de la base local", () => {
  it("migra un guardado v2 a v3 conservando datos y guardando copia previa", () => {
    const v2 = {
      version: 2,
      settings: { id: 1, theme: "dark", pinHash: "abc" },
      categories: [],
      tags: [],
      tasks: [
        {
          id: "t1",
          title: "Antigua",
          description: null,
          priority: "high",
          status: "completed",
          progress: 100,
          startDate: null,
          dueDate: null,
          dueTime: null,
          notes: null,
          position: 0,
          categoryId: null,
          completedAt: "2026-01-01T10:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T10:00:00.000Z",
        },
      ],
      taskTags: [],
      subtasks: [],
      habits: [],
      habitLogs: [{ id: "l1", habitId: "h", date: "2026-01-01T00:00:00.000Z", count: 1, note: null, createdAt: "2026-01-01T00:00:00.000Z" }],
      events: [],
      reminders: [],
      goals: [{ id: "g1", title: "G", targetValue: 5, currentValue: 2, endDate: "2026-12-31T00:00:00.000Z" }],
      tombstones: [],
    };
    resetDb();
    localStorage.setItem("gestion-tareas:db", JSON.stringify(v2));
    const db = loadDb();
    expect(db.version).toBe(DB_VERSION);
    expect(db.tasks[0]).toMatchObject({ title: "Antigua", completedAt: "2026-01-01T10:00:00.000Z", recurrence: null, goalId: null });
    expect(db.goals[0]).toMatchObject({ source: "manual", currentValue: 2 });
    expect(db.habitLogs[0].updatedAt).toBe(db.habitLogs[0].createdAt);
    expect(db.settings).toMatchObject({ theme: "dark", pinHash: "abc", currency: "COP" });
    expect(db.finCategories.length).toBeGreaterThan(10);
    expect(listDbBackups()[0]).toMatchObject({ version: 2 });
    expect(JSON.parse(localStorage.getItem(listDbBackups()[0].key)!).tasks[0].title).toBe("Antigua");
  });

  it("un guardado de una versión más nueva no se rebaja", () => {
    resetDb();
    localStorage.setItem("gestion-tareas:db", JSON.stringify({ version: 99, tasks: [], futureField: 1 }));
    const db = loadDb() as any;
    expect(db.version).toBe(99);
    expect(db.futureField).toBe(1);
  });
});

describe("tareas", () => {
  it("volver a guardar una tarea completada NO reescribe su fecha de cierre", async () => {
    const t = await call("POST", "/tasks", { title: "X" });
    const done = await call("PUT", `/tasks/${t.id}`, { status: "completed" });
    await new Promise((r) => setTimeout(r, 5));
    const resaved = await call("PUT", `/tasks/${t.id}`, { status: "completed", title: "X editada" });
    expect(resaved.completedAt).toBe(done.completedAt);
    const reopened = await call("PUT", `/tasks/${t.id}`, { status: "pending" });
    expect(reopened.completedAt).toBeNull();
  });

  it("completar una tarea recurrente crea la siguiente, una sola vez", async () => {
    const t = await call("POST", "/tasks", {
      title: "Pagar arriendo",
      dueDate: "2026-01-31",
      recurrence: "monthly",
      recurrenceInterval: 1,
    });
    await call("POST", `/tasks/${t.id}/subtasks`, { title: "Transferir" });
    await call("PUT", `/tasks/${t.id}`, { status: "completed" });
    // Re-completar (p. ej. tras reabrir) no genera otra.
    await call("PUT", `/tasks/${t.id}`, { status: "pending" });
    await call("PUT", `/tasks/${t.id}`, { status: "completed" });
    const series = loadDb().tasks.filter((x) => x.seriesId === t.id);
    expect(series).toHaveLength(1);
    expect(series[0].id).toBe(`${t.id}~2026-02-28`);
    expect(series[0].status).toBe("pending");
    const steps = loadDb().subtasks.filter((s) => s.taskId === series[0].id);
    expect(steps).toHaveLength(1);
    expect(steps[0].done).toBe(false);
  });

  it("nextDueDate: laborables saltan el fin de semana; mensual respeta fin de mes", () => {
    const friday = new Date("2026-09-25T00:00:00.000Z");
    expect(nextDueDate(friday, "weekdays", 1).toISOString().slice(0, 10)).toBe("2026-09-28");
    expect(nextDueDate(new Date("2026-01-31T00:00:00.000Z"), "monthly", 1).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(nextDueDate(new Date("2026-09-01T00:00:00.000Z"), "weekly", 2).toISOString().slice(0, 10)).toBe("2026-09-15");
  });

  it("recordatorio relativo: se crea, se recalcula al mover la fecha y se elimina", async () => {
    const t = await call("POST", "/tasks", { title: "Cita", dueDate: "2030-05-10", dueTime: "15:00", reminderMinutes: 30 });
    let r = loadDb().reminders.filter((x) => x.taskId === t.id);
    expect(r).toHaveLength(1);
    expect(new Date(r[0].triggerAt).getHours()).toBe(14);
    await call("PUT", `/tasks/${t.id}`, { dueTime: "18:00" });
    r = loadDb().reminders.filter((x) => x.taskId === t.id);
    expect(r).toHaveLength(1);
    expect(new Date(r[0].triggerAt).getHours()).toBe(17);
    await call("PUT", `/tasks/${t.id}`, { reminderMinutes: null });
    expect(loadDb().reminders.filter((x) => x.taskId === t.id)).toHaveLength(0);
  });

  it("objetivos vinculados: el progreso se calcula desde las tareas completadas", async () => {
    const g = await call("POST", "/goals", { title: "Leer 3 libros", targetValue: 3, endDate: "2026-12-31", source: "tasks" });
    const a = await call("POST", "/tasks", { title: "Libro 1", goalId: g.id });
    await call("POST", "/tasks", { title: "Libro 2", goalId: g.id });
    await call("PUT", `/tasks/${a.id}`, { status: "completed" });
    const goals = await call("GET", "/goals");
    const got = goals.find((x: any) => x.id === g.id);
    expect(got.currentValue).toBe(1);
    expect(got.linkedTasks).toBe(2);
    // Borrar el objetivo no borra las tareas: solo desvincula.
    await call("DELETE", `/goals/${g.id}`);
    expect(loadDb().tasks.find((t) => t.id === a.id)?.goalId).toBeNull();
  });

  it("objetivo ligado a una meta de ahorro refleja lo ahorrado", async () => {
    const main = await call("POST", "/finance/accounts", { name: "Banco", type: "bank", currency: "COP", initialBalance: 100000 });
    const sav = await call("POST", "/finance/accounts", { name: "Ahorro", type: "savings", currency: "COP", initialBalance: 0 });
    const fg = await call("POST", "/finance/goals", { name: "Colchón", targetAmount: 50000, currency: "COP", startDate: "2026-09-01" });
    await call("POST", `/finance/goals/${fg.id}/contribute`, { amount: 20000, date: "2026-09-02", fromAccountId: main.id, toAccountId: sav.id });
    const g = await call("POST", "/goals", { title: "Colchón", endDate: "2026-12-31", source: "finance", finGoalId: fg.id });
    expect(g.currentValue).toBe(200);
    expect(g.targetValue).toBe(500);
  });

  it("la copia de seguridad incluye finanzas y no el hash del PIN", async () => {
    await call("POST", "/settings/pin", { pin: "1234" });
    await call("POST", "/finance/accounts", { name: "Banco", type: "bank", currency: "COP", initialBalance: 1 });
    const backup = await call("GET", "/backup/export");
    expect(backup.data.finAccounts).toHaveLength(1);
    expect(backup.data.settings.pinHash).toBeNull();
    resetDb();
    localStorage.clear();
    await call("POST", "/backup/import", { data: backup.data });
    expect(loadDb().finAccounts).toHaveLength(1);
  });
});
