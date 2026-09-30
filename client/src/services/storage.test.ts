import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { bootDb, DB_VERSION, dropCache, loadDb } from "@/services/localDb";
import {
  __resetStorageForTests,
  createRestorePoint,
  flushStorage,
  kvGet,
  kvSet,
  listRestorePoints,
  readRestorePoint,
  storageKind,
} from "./storage";
import { call } from "@/test/helpers";

/** Simula cerrar y volver a abrir la app: memoria vacía, mismo IndexedDB. */
async function restart() {
  await flushStorage();
  __resetStorageForTests();
  dropCache();
  return bootDb();
}

afterEach(async () => {
  await flushStorage();
  __resetStorageForTests();
  (globalThis as any).indexedDB = new IDBFactory();
});

describe("almacenamiento en IndexedDB", () => {
  it("usa IndexedDB y los datos sobreviven a cerrar y abrir la app", async () => {
    const info = await bootDb();
    expect(info.kind).toBe("indexeddb");
    expect(storageKind()).toBe("indexeddb");
    await call("POST", "/tasks", { title: "Persistente" });
    await call("POST", "/finance/accounts", { name: "Banco", type: "bank", currency: "COP", initialBalance: 100 });
    await restart();
    expect(loadDb().tasks.some((t) => t.title === "Persistente")).toBe(true);
    expect(loadDb().finAccounts[0].name).toBe("Banco");
    // No se escribe en localStorage: no hay límite de 5 MB.
    expect(localStorage.getItem("gestion-tareas:db")).toBeNull();
  });

  it("la primera vez copia los datos de localStorage y deja la copia antigua intacta", async () => {
    const legacy = { version: 4, tasks: [], finAccounts: [{ id: "a1", name: "De antes" }] };
    localStorage.setItem("gestion-tareas:db", JSON.stringify(legacy));
    const info = await bootDb();
    expect(info.migratedFromLocalStorage).toBe(true);
    expect(loadDb().finAccounts[0].name).toBe("De antes");
    expect(localStorage.getItem("gestion-tareas:db")).not.toBeNull();
    await restart();
    expect(loadDb().finAccounts[0].name).toBe("De antes");
  });

  it("antes de migrar a una versión nueva guarda un punto de restauración", async () => {
    localStorage.setItem("gestion-tareas:db", JSON.stringify({ version: 2, tasks: [{ id: "t", title: "v2" }] }));
    await bootDb();
    expect(loadDb().version).toBe(DB_VERSION);
    const points = await listRestorePoints();
    expect(points[0].reason).toMatch(/v2 a v/);
    const data = (await readRestorePoint(points[0].id)) as any;
    expect(data.version).toBe(2);
    expect(data.tasks[0].title).toBe("v2");
  });

  it("los puntos de restauración se limitan y el almacén clave-valor persiste", async () => {
    await bootDb();
    for (let i = 0; i < 16; i++) await createRestorePoint({ version: DB_VERSION, i }, `p${i}`);
    const points = await listRestorePoints();
    // Retención por defecto: 12 copias automáticas/previas (configurable).
    expect(points.length).toBe(12);
    expect(points[0].reason).toBe("p15");
    expect(points.every((p) => p.verified)).toBe(true);
    await kvSet("sync:test", { a: 1 });
    await restart();
    expect(await kvGet("sync:test", null)).toEqual({ a: 1 });
  });
});
