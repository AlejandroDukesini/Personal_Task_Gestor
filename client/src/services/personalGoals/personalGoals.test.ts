import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { DB_VERSION, loadDb, migrate, mutate } from "@/services/localDb";
import { call, expectStatus } from "@/test/helpers";
import { buildOffer, validateOffer } from "@/services/manualsync/engine";
import { phaseOf, timeLeftLabel } from "./logic";

const goal = (over: Record<string, unknown> = {}) => call("POST", "/personal-goals", { title: "Comprar una motocicleta", targetDate: "2027-10-18", ...over });
const list = (qs = "") => call("GET", `/personal-goals${qs}`);

describe("modelo y migración", () => {
  it("la migración 11 añade las metas sin tocar los proyectos (todos quedan como profesionales)", () => {
    const project = { id: "p1", title: "App", stages: [], deletedAt: null };
    const db = migrate(structuredClone({ version: 10, projects: [project], settings: {} }));
    expect(db.version).toBe(DB_VERSION);
    expect(db.personalGoals).toEqual([]);
    expect(db.projects).toEqual([project]);
  });
});

describe("fase temporal (derivada)", () => {
  const T = "2026-11-11";
  const g = (over: Record<string, unknown>) => ({ status: "in_progress", startDate: null, targetDate: "2027-06-01", ...over }) as any;
  it("distingue completadas, retrasadas, en pausa, próximas, futuras, por terminar y en curso", () => {
    expect(phaseOf(g({ status: "completed", targetDate: "2020-01-01" }), T)).toBe("completed");
    expect(phaseOf(g({ targetDate: "2026-11-10" }), T)).toBe("overdue");
    expect(phaseOf(g({ status: "paused" }), T)).toBe("paused");
    expect(phaseOf(g({ status: "planned", startDate: "2026-11-30" }), T)).toBe("starting_soon");
    expect(phaseOf(g({ status: "planned", startDate: "2027-03-01" }), T)).toBe("future");
    expect(phaseOf(g({ status: "planned" }), T)).toBe("future");
    expect(phaseOf(g({ targetDate: "2026-11-25" }), T)).toBe("ending_soon");
    expect(phaseOf(g({ startDate: "2026-01-01" }), T)).toBe("running");
  });
  it("tiempo restante legible", () => {
    expect(timeLeftLabel("2026-11-11", T)).toBe("Vence hoy");
    expect(timeLeftLabel("2026-11-12", T)).toBe("Faltan 1 día");
    expect(timeLeftLabel("2027-10-18", T)).toBe("Faltan 11 meses");
    expect(timeLeftLabel("2026-10-30", T)).toBe("Hace 12 días");
  });
});

describe("CRUD de metas", () => {
  it("crear con todos los campos, consultar y validar fechas", async () => {
    const m = await goal({ description: "Moto de 250 cc", category: "Transporte", color: "#ef4444", priority: "high", startDate: "2026-01-15", progress: 20, observations: "Ahorrar cada mes" });
    expect(m).toMatchObject({ title: "Comprar una motocicleta", targetDate: "2027-10-18", color: "#ef4444", priority: "high", status: "planned", progress: 20, archived: false });
    expect(m.history[0].text).toBe("Meta creada");
    const r = await list();
    expect(r.items[0]).toMatchObject({ id: m.id, phase: expect.any(String), timeLeft: expect.stringMatching(/^(Faltan|Hace|Vence)/) });
    expect(r.years).toEqual([2026, 2027]);
    await expectStatus(400, goal({ startDate: "2028-01-01" }));
    await expectStatus(400, call("POST", "/personal-goals", { title: "Sin fecha" }));
    await expectStatus(400, goal({ progress: 120 }));
  });

  it("editar registra el historial; completar fija el 100 % y bajar el avance la reabre", async () => {
    const m = await goal({ progress: 10 });
    await call("PUT", `/personal-goals/${m.id}`, { targetDate: "2027-12-01", progress: 45, color: "#16a34a", priority: "critical" });
    let g = await call("GET", `/personal-goals/${m.id}`);
    const texts = g.history.map((h: any) => h.text);
    expect(texts).toContain("Avance: 10 % → 45 %");
    expect(texts.some((t: string) => t.startsWith("Fecha objetivo:"))).toBe(true);
    expect(texts).toContain("Color cambiado");
    expect(texts).toContain("Prioridad: Media → Crítica");
    await call("PUT", `/personal-goals/${m.id}`, { status: "completed" });
    g = await call("GET", `/personal-goals/${m.id}`);
    expect(g).toMatchObject({ status: "completed", progress: 100, phase: "completed" });
    expect(g.completedAt).not.toBeNull();
    await call("PUT", `/personal-goals/${m.id}`, { progress: 90 });
    g = await call("GET", `/personal-goals/${m.id}`);
    expect(g).toMatchObject({ status: "in_progress", progress: 90, completedAt: null });
  });

  it("archivar, restaurar y eliminar definitivamente", async () => {
    const m = await goal();
    await call("POST", `/personal-goals/${m.id}/archive`);
    expect((await list()).items).toHaveLength(0);
    expect((await list("?archived=1")).items).toHaveLength(1);
    await call("POST", `/personal-goals/${m.id}/unarchive`);
    expect((await list()).items).toHaveLength(1);
    await call("DELETE", `/personal-goals/${m.id}`);
    expect(loadDb().personalGoals).toHaveLength(0);
    expect(loadDb().tombstones.some((t) => t.collection === "personalGoals" && t.id === m.id)).toBe(true);
  });

  it("búsqueda y filtro por categoría", async () => {
    await goal({ title: "Viaje a Japón", category: "Viajes" });
    await goal({ title: "Correr un maratón", category: "Salud" });
    expect((await list("?q=japon")).items.map((x: any) => x.title)).toEqual(["Viaje a Japón"]);
    expect((await list("?category=Salud")).items.map((x: any) => x.title)).toEqual(["Correr un maratón"]);
  });
});

describe("recuperar proyectos convertidos con la versión anterior", () => {
  /** Estado que dejaba la antigua «Convertir en meta personal»: meta resumida + proyecto en la papelera. */
  async function legacyConversion() {
    const p = await call("POST", "/projects", { title: "Aprender alemán", startDate: "2026-02-01", endDate: "2027-02-01", objectives: [{ text: "Aprobar examen", done: false }], stages: [{ title: "A1" }, { title: "A2" }] });
    await call("PUT", `/projects/${p.id}/stages/${p.stages[0].id}`, { progress: 100 });
    await call("DELETE", `/projects/${p.id}`);
    const g = await goal({ title: "Aprender alemán", targetDate: "2027-02-01" });
    mutate((db) => {
      db.personalGoals.find((x) => x.id === g.id)!.sourceProjectId = p.id;
    });
    return { p: loadDb().projects.find((x) => x.id === p.id)!, g };
  }

  it("el proyecto original vuelve íntegro a Personal y la meta se archiva (no se borra)", async () => {
    const { p, g } = await legacyConversion();
    const { stages, objectives, id, createdAt } = structuredClone(p);
    const r = await call("POST", `/personal-goals/${g.id}/recover-project`);
    const proj = loadDb().projects.find((x) => x.id === p.id)!;
    expect(r.project.id).toBe(id);
    expect(proj).toMatchObject({ id, createdAt, kind: "personal", deletedAt: null });
    expect(proj.stages).toEqual(stages);
    expect(proj.objectives).toEqual(objectives);
    expect(loadDb().projects).toHaveLength(1);
    const meta = loadDb().personalGoals.find((x) => x.id === g.id)!;
    expect(meta.archived).toBe(true);
    expect(meta.history[0].text).toMatch(/recuperado/);
  });

  it("si el proyecto se eliminó definitivamente, lo dice y no inventa nada", async () => {
    const { p, g } = await legacyConversion();
    await call("DELETE", `/projects/${p.id}/purge`);
    expect(await expectStatus(404, call("POST", `/personal-goals/${g.id}/recover-project`))).toMatch(/eliminó definitivamente/);
    expect(loadDb().projects).toHaveLength(0);
    expect(loadDb().personalGoals.find((x) => x.id === g.id)!.archived).toBe(false);
    const plain = await goal();
    await expectStatus(400, call("POST", `/personal-goals/${plain.id}/recover-project`));
  });
});

describe("sincronización", () => {
  it("las metas viajan validadas", async () => {
    const m = await goal();
    const offer = buildOffer(loadDb(), { deviceId: "pc", name: "PC" } as any, null, null);
    expect(validateOffer(offer).errors).toEqual([]);
    const tampered = structuredClone(offer);
    (tampered.entries.find((e: any) => e.key === `personalGoals:${m.id}`)!.row as any).targetDate = "mañana";
    expect(validateOffer(tampered).errors.join(" ")).toMatch(/datos no válidos/);
  });
});
