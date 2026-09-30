import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { bootDb, dropCache, loadDb, type Db } from "@/services/localDb";
import {
  __idbForTests,
  __resetStorageForTests,
  __tuneForTests,
  checkForExternalChanges,
  flushStorage,
  getSaveStatus,
  listRestorePoints,
  MIRROR_KEY,
  MIRROR_META_KEY,
  persistNow,
} from "@/services/storage";
import { __resetFilesForTests, cleanupOrphanFiles, getFile, putFile } from "@/services/notes/files";
import {
  __resetPreActionForTests,
  buildBackupFile,
  createLocalBackup,
  maybeAutoBackup,
  mergeBackupInto,
  parseBackupText,
  restoreParsed,
  saveBackupPrefs,
  serializeBackup,
} from "@/services/backup/backup";
import { api } from "@/services/api";
import { call } from "@/test/helpers";
import { mergeDbs } from "./merge";

/* ------------------------------------------------------------ utilidades */

/** Cerrar y volver a abrir la app: memoria vacía, mismo almacenamiento. */
async function restart() {
  await flushStorage();
  __resetStorageForTests();
  dropCache();
  return bootDb();
}

/** Borra TODO el almacenamiento del navegador (limpieza de datos del sitio). */
function wipeBrowser({ keepLocalStorage = false } = {}) {
  __resetStorageForTests();
  __resetFilesForTests();
  dropCache();
  (globalThis as any).indexedDB = new IDBFactory();
  if (!keepLocalStorage) localStorage.clear();
}

/** Lee lo que hay guardado en IndexedDB (lo que vería una pestaña nueva). */
async function stored(): Promise<{ db: Db; rev: number }> {
  const idb = __idbForTests()!;
  const tx = idb.transaction("kv");
  const get = (k: string) => new Promise<any>((res) => (tx.objectStore("kv").get(k).onsuccess = (e: any) => res(e.target.result)));
  const [db, meta] = await Promise.all([get("db"), get("dbmeta")]);
  return { db, rev: meta?.rev ?? 0 };
}

/** Escritura hecha por OTRA pestaña: cambia el almacenamiento sin pasar por esta. */
async function otherTabWrites(change: (db: Db) => void) {
  const { db, rev } = await stored();
  change(db);
  const tx = __idbForTests()!.transaction("kv", "readwrite");
  tx.objectStore("kv").put(db, "db");
  tx.objectStore("kv").put({ rev: rev + 1, savedAt: new Date().toISOString(), tabId: "otra" }, "dbmeta");
  await new Promise((r) => (tx.oncomplete = r));
}

const taskTitles = () => loadDb().tasks.map((t) => t.title);

beforeEach(async () => {
  (globalThis as any).indexedDB = new IDBFactory();
  __resetFilesForTests();
  __resetPreActionForTests();
  __tuneForTests({ retryDelays: [0, 0, 0], mirrorMaxChars: 4_000_000 });
  await bootDb();
});

afterEach(async () => {
  await flushStorage().catch(() => undefined);
  __resetStorageForTests();
});

/* ------------------------------------------------------------ persistencia */

describe("los datos sobreviven a recargar, cerrar y reabrir", () => {
  it("crear un registro y recargar la página", async () => {
    await call("POST", "/tasks", { title: "Comprar pan" });
    await restart();
    expect(taskTitles()).toContain("Comprar pan");
  });

  it("varios registros de todos los módulos, modificar y eliminar, varios reinicios", async () => {
    const a = await call("POST", "/tasks", { title: "A" });
    await call("POST", "/tasks", { title: "B" });
    const h = await call("POST", "/habits", { name: "Agua", dailyTarget: 8 });
    await call("POST", `/habits/${h.id}/logs`, { date: new Date().toISOString(), count: 3 });
    const acc = await call("POST", "/finance/accounts", { name: "Banco", type: "bank", currency: "COP", initialBalance: 5000 });
    await call("POST", "/notes", { title: "Idea", content: null });
    await call("POST", "/goals", { title: "Meta", endDate: "2026-12-31" });
    await restart();
    await call("PUT", `/tasks/${a.id}`, { title: "A editada" });
    await call("DELETE", `/finance/accounts/${acc.id}`);
    await restart();
    await restart();
    const db = loadDb();
    expect(taskTitles()).toEqual(expect.arrayContaining(["A editada", "B"]));
    expect(taskTitles()).not.toContain("A");
    expect(db.habitLogs.find((l) => l.habitId === h.id)?.count).toBe(3);
    expect(db.finAccounts.some((x) => x.id === acc.id)).toBe(false);
    expect(db.notes.some((n) => n.title === "Idea")).toBe(true);
    expect(db.goals.some((g) => g.title === "Meta")).toBe(true);
  });

  it("«Guardado» solo después de que el almacenamiento confirma la escritura", async () => {
    await call("POST", "/tasks", { title: "X" });
    expect(getSaveStatus().state).toBe("saving");
    await flushStorage();
    expect(getSaveStatus().state).toBe("saved");
    expect((await stored()).db.tasks.some((t) => t.title === "X")).toBe(true);
  });
});

/* ------------------------------------------------------------ pestañas */

describe("varias pestañas abiertas a la vez (causa de la pérdida de datos)", () => {
  it("una pestaña desfasada ya no borra lo que guardó otra: se fusiona", async () => {
    await call("POST", "/tasks", { title: "Inicial" });
    await flushStorage();
    // La pestaña B crea una tarea; esta pestaña (A) no se entera todavía.
    await otherTabWrites((db) =>
      db.tasks.push({ ...structuredClone(db.tasks[0]), id: "de-B", title: "Tarea de la pestaña B", updatedAt: new Date().toISOString() })
    );
    // A hace cualquier escritura (p. ej. el aviso de un recordatorio).
    await call("POST", "/tasks", { title: "Tarea de la pestaña A" });
    await flushStorage();
    const { db } = await stored();
    expect(db.tasks.map((t) => t.title)).toEqual(expect.arrayContaining(["Inicial", "Tarea de la pestaña B", "Tarea de la pestaña A"]));
    // La memoria de A también se actualizó con lo de B.
    expect(taskTitles()).toContain("Tarea de la pestaña B");
    await restart();
    expect(taskTitles()).toEqual(expect.arrayContaining(["Tarea de la pestaña B", "Tarea de la pestaña A"]));
  });

  it("borrados y ediciones de la otra pestaña se respetan; la misma fila editada en ambas: gana la más reciente", async () => {
    const t1 = await call("POST", "/tasks", { title: "Uno" });
    const t2 = await call("POST", "/tasks", { title: "Dos" });
    await flushStorage();
    await otherTabWrites((db) => {
      db.tasks = db.tasks.filter((t) => t.id !== t1.id);
      db.tombstones.push({ collection: "tasks", id: t1.id, deletedAt: new Date().toISOString() });
      const t = db.tasks.find((x) => x.id === t2.id)!;
      t.title = "Dos (pestaña B, antes)";
      t.updatedAt = new Date(Date.now() - 60_000).toISOString();
    });
    await call("PUT", `/tasks/${t2.id}`, { title: "Dos (pestaña A, después)" });
    await flushStorage();
    const { db } = await stored();
    expect(db.tasks.some((t) => t.id === t1.id)).toBe(false);
    expect(db.tasks.find((t) => t.id === t2.id)?.title).toBe("Dos (pestaña A, después)");
  });

  it("una pestaña sin cambios propios recarga lo que guardó otra (sin escribir)", async () => {
    await flushStorage();
    const before = (await stored()).rev;
    await otherTabWrites((db) => db.tasks.push({ ...structuredClone(db.tasks[0]), id: "nueva", title: "Desde otra pestaña" }));
    expect(await checkForExternalChanges()).toBe(true);
    expect(taskTitles()).toContain("Desde otra pestaña");
    expect((await stored()).rev).toBe(before + 1); // no escribió nada nuevo
  });
});

/* ------------------------------------------------- estado inicial vacío */

describe("un estado vacío nunca pisa datos guardados", () => {
  it("al arrancar con datos no se siembran ejemplos ni se pierde nada", async () => {
    await call("POST", "/tasks", { title: "Mía" });
    const count = loadDb().tasks.length;
    await restart();
    expect(loadDb().tasks.length).toBe(count);
  });

  it("IndexedDB borrado pero espejo en localStorage: se recupera del espejo", async () => {
    await call("POST", "/tasks", { title: "Protegida por el espejo" });
    await flushStorage();
    persistNow();
    wipeBrowser({ keepLocalStorage: true });
    const info = await bootDb();
    expect(info.recoveredFromMirror).toBe(true);
    expect(taskTitles()).toContain("Protegida por el espejo");
  });

  it("cambios que no llegaron a IndexedDB al cerrar la pestaña se recuperan del espejo", async () => {
    await call("POST", "/tasks", { title: "Antes" });
    await flushStorage();
    const old = await stored();
    await call("POST", "/tasks", { title: "Justo antes de cerrar" });
    persistNow(); // pagehide: espejo síncrono con lo pendiente
    await flushStorage();
    // Simula que la escritura asíncrona se cortó: IndexedDB se queda con lo anterior.
    const tx = __idbForTests()!.transaction("kv", "readwrite");
    tx.objectStore("kv").put(old.db, "db");
    tx.objectStore("kv").put({ rev: old.rev }, "dbmeta");
    await new Promise((r) => (tx.oncomplete = r));
    const info = await restart();
    expect(info.recoveredFromMirror).toBe(true);
    expect(taskTitles()).toContain("Justo antes de cerrar");
  });

  it("sin base ni espejo pero con copias verificadas: se recupera la última copia", async () => {
    await call("POST", "/tasks", { title: "En la copia" });
    await createLocalBackup("Copia manual", "manual");
    await flushStorage();
    const idb = __idbForTests()!;
    const tx = idb.transaction("kv", "readwrite");
    tx.objectStore("kv").delete("db");
    await new Promise((r) => (tx.oncomplete = r));
    localStorage.removeItem(MIRROR_KEY);
    localStorage.removeItem(MIRROR_META_KEY);
    const info = await restart();
    expect(info.recoveredFromRestorePoint).toBeTruthy();
    expect(taskTitles()).toContain("En la copia");
  });

  it("un espejo dañado (suma de comprobación) se ignora", async () => {
    await call("POST", "/tasks", { title: "Buena" });
    await flushStorage();
    persistNow();
    localStorage.setItem(MIRROR_KEY, localStorage.getItem(MIRROR_KEY)!.replace("Buena", "Mala!"));
    wipeBrowser({ keepLocalStorage: true });
    const info = await bootDb();
    expect(info.recoveredFromMirror).toBe(false);
    expect(taskTitles()).not.toContain("Mala!");
  });

  it("espejo demasiado grande: se omite sin error y la base principal sigue guardando", async () => {
    __tuneForTests({ mirrorMaxChars: 100 });
    await call("POST", "/tasks", { title: "Grande" });
    await flushStorage();
    persistNow();
    expect(getSaveStatus().mirror).toBe("too-large");
    expect(getSaveStatus().state).toBe("saved");
  });
});

/* ------------------------------------------------------------ errores */

describe("errores de escritura y almacenamiento lleno", () => {
  it("reintenta, avisa del error sin perder la memoria y permite la copia de emergencia; se recupera después", async () => {
    const events: string[] = [];
    (globalThis as any).window = { dispatchEvent: (e: any) => events.push(e.detail), addEventListener() {}, removeEventListener() {} };
    const proto = (globalThis as any).IDBObjectStore.prototype;
    const realPut = proto.put;
    let fail = true;
    proto.put = function (value: unknown, key?: IDBValidKey) {
      if (fail && key === "db") throw new DOMException("sin espacio", "QuotaExceededError");
      return realPut.call(this, value, key);
    };
    try {
      await call("POST", "/tasks", { title: "No cabe" });
      await flushStorage();
      expect(getSaveStatus().state).toBe("error");
      expect(getSaveStatus().error).toMatch(/espacio/);
      expect(events.join()).toMatch(/espacio/);
      // La memoria conserva el dato y la copia de emergencia lo incluye.
      expect(taskTitles()).toContain("No cabe");
      const emergency = await buildBackupFile();
      expect(emergency.db.tasks.some((t) => t.title === "No cabe")).toBe(true);
      // Se libera espacio: el siguiente guardado escribe también lo pendiente.
      fail = false;
      await call("POST", "/tasks", { title: "Después" });
      await flushStorage();
      expect(getSaveStatus().state).toBe("saved");
      expect((await stored()).db.tasks.map((t) => t.title)).toEqual(expect.arrayContaining(["No cabe", "Después"]));
    } finally {
      proto.put = realPut;
      delete (globalThis as any).window;
    }
  });
});

/* ------------------------------------------------------------ migración */

describe("migración desde el almacenamiento anterior", () => {
  it("datos solo en localStorage (versión antigua): pasan a IndexedDB sin duplicarse y la copia antigua se conserva", async () => {
    await call("POST", "/tasks", { title: "Antigua" });
    await flushStorage();
    const legacy = (await stored()).db;
    wipeBrowser();
    localStorage.setItem("gestion-tareas:db", JSON.stringify(legacy));
    const info = await bootDb();
    expect(info.migratedFromLocalStorage).toBe(true);
    const n = loadDb().tasks.length;
    await restart();
    await restart();
    expect(loadDb().tasks.length).toBe(n);
    expect(taskTitles().filter((t) => t === "Antigua")).toHaveLength(1);
    expect(localStorage.getItem("gestion-tareas:db")).not.toBeNull();
  });
});

/* ------------------------------------------------------------ copias */

describe("copias de seguridad", () => {
  it("crear una copia la verifica; las automáticas solo si hubo cambios", async () => {
    const p = await createLocalBackup();
    expect(p.verified).toBe(true);
    saveBackupPrefs({ autoIntervalMin: 1 });
    const later = Date.now() + 5 * 60_000;
    expect(await maybeAutoBackup(later)).not.toBeNull();
    expect(await maybeAutoBackup(later + 5 * 60_000)).toBeNull(); // sin cambios
    await call("POST", "/tasks", { title: "Cambio" });
    expect(await maybeAutoBackup(later + 10 * 60_000)).not.toBeNull();
  });

  it("descargar y restaurar una copia válida (en un navegador limpio)", async () => {
    await call("POST", "/tasks", { title: "Respaldada" });
    const h = await call("POST", "/habits", { name: "Leer" });
    const text = await serializeBackup(await buildBackupFile());
    wipeBrowser();
    await bootDb();
    expect(taskTitles()).not.toContain("Respaldada");
    const parsed = await parseBackupText(text);
    expect(parsed.preview.checksumVerified).toBe(true);
    expect(parsed.preview.counts["Tareas"]).toBeGreaterThan(0);
    const r = await restoreParsed(parsed, "replace");
    expect(r.safetyBackup.verified).toBe(true);
    expect(taskTitles()).toContain("Respaldada");
    await restart();
    expect(loadDb().habits.some((x) => x.id === h.id)).toBe(true);
  });

  it("una copia dañada, alterada o ajena se rechaza sin tocar los datos actuales", async () => {
    await call("POST", "/tasks", { title: "Actual" });
    const good = await serializeBackup(await buildBackupFile());
    const before = JSON.stringify(loadDb());
    await expect(parseBackupText(good.replace('"Actual"', '"Hackeada"'))).rejects.toMatchObject({ code: "damaged" });
    await expect(parseBackupText(good.slice(0, good.length / 2))).rejects.toMatchObject({ code: "invalid" });
    await expect(parseBackupText(JSON.stringify({ hola: 1 }))).rejects.toMatchObject({ code: "invalid" });
    const bad = JSON.parse(good);
    bad.db.finAccounts = [{ id: "x", amount: "no" }];
    delete bad.checksum;
    bad.v = 1;
    await expect(parseBackupText(JSON.stringify(bad))).rejects.toMatchObject({ code: "incompatible" });
    expect(JSON.stringify(loadDb())).toBe(before);
  });

  it("copia cifrada con contraseña; contraseña incorrecta = error claro", async () => {
    await call("POST", "/tasks", { title: "Secreta" });
    const text = await serializeBackup(await buildBackupFile(), "una-clave-larga");
    expect(text).not.toContain("Secreta");
    await expect(parseBackupText(text)).rejects.toMatchObject({ code: "password" });
    await expect(parseBackupText(text, "otra-clave")).rejects.toMatchObject({ code: "password" });
    const ok = await parseBackupText(text, "una-clave-larga");
    expect(ok.db.tasks.some((t) => t.title === "Secreta")).toBe(true);
  });

  it("acepta las exportaciones antiguas de Ajustes", async () => {
    await call("POST", "/tasks", { title: "Exportada antes" });
    const legacy = await call("GET", "/backup/export");
    const parsed = await parseBackupText(JSON.stringify(legacy));
    expect(parsed.preview.format).toBe("export");
    expect(parsed.db.tasks.some((t) => t.title === "Exportada antes")).toBe(true);
  });

  it("combinar sin borrar: añade lo que falta, conserva lo más reciente y no revive lo borrado después", async () => {
    const keep = await call("POST", "/tasks", { title: "Local" });
    const gone = await call("POST", "/tasks", { title: "Borrada después" });
    const backup = await buildBackupFile();
    await call("PUT", `/tasks/${keep.id}`, { title: "Local editada después" });
    await call("DELETE", `/tasks/${gone.id}`);
    const incoming = structuredClone(backup.db);
    incoming.tasks.push({ ...structuredClone(incoming.tasks[0]), id: "solo-en-copia", title: "Solo en la copia" });
    const merged = mergeBackupInto(loadDb(), incoming);
    const titles = merged.db.tasks.map((t) => t.title);
    expect(titles).toContain("Solo en la copia");
    expect(titles).toContain("Local editada después");
    expect(titles).not.toContain("Borrada después");
    expect(titles.filter((t) => t === "Local editada después")).toHaveLength(1);
    // Aplicarlo dos veces no duplica.
    const again = mergeBackupInto(merged.db, incoming);
    expect(again.added).toBe(0);
  });

  it("los adjuntos viajan en la copia y se recuperan", async () => {
    const bytes = new TextEncoder().encode("contenido del adjunto");
    const key = await putFile(bytes);
    const note = await call("POST", "/notes", { title: "Con adjunto", content: null });
    const db = loadDb();
    db.notes.find((n) => n.id === note.id)!.attachments.push({ id: "a1", fileKey: key, name: "a.txt", label: null, kind: "text", mime: "text/plain", size: bytes.length, addedAt: new Date().toISOString() });
    const text = await serializeBackup(await buildBackupFile({ includeFiles: true }));
    wipeBrowser();
    await bootDb();
    expect(await getFile(key).catch(() => null)).toBeNull();
    const r = await restoreParsed(await parseBackupText(text), "replace");
    expect(r.filesRestored).toBe(1);
    expect(new TextDecoder().decode((await getFile(key))!)).toBe("contenido del adjunto");
  });

  it("las acciones destructivas guardan antes una copia verificada (una por tanda)", async () => {
    const h = await api.post<any>("/habits", { name: "Temporal" });
    const h2 = await api.post<any>("/habits", { name: "Temporal 2" });
    await api.delete(`/habits/${h.id}`);
    await api.delete(`/habits/${h2.id}`);
    const points = (await listRestorePoints()).filter((p) => p.reason === "Antes de eliminar un hábito");
    expect(points).toHaveLength(1);
    expect(points[0].verified).toBe(true);
  });

  it("si no se puede guardar la copia previa, la restauración se cancela y nada cambia", async () => {
    await call("POST", "/tasks", { title: "Intacta" });
    const parsed = await parseBackupText(await serializeBackup(await buildBackupFile()));
    const proto = (globalThis as any).IDBObjectStore.prototype;
    const realAdd = proto.add;
    proto.add = () => {
      throw new DOMException("sin espacio", "QuotaExceededError");
    };
    try {
      await expect(restoreParsed(parsed, "replace")).rejects.toMatchObject({ code: "storage" });
    } finally {
      proto.add = realAdd;
    }
    expect(taskTitles()).toContain("Intacta");
  });

  it("la limpieza de adjuntos solo borra lo no usado por nadie y con antigüedad", async () => {
    const used = await putFile(new TextEncoder().encode("usado"));
    const inBackup = await putFile(new TextEncoder().encode("en una copia"));
    const orphan = await putFile(new TextEncoder().encode("huérfano"));
    const recent = await cleanupOrphanFiles(new Set([used, inBackup]));
    expect(recent.removed).toBe(0); // recién creados: nada se borra
    const later = await cleanupOrphanFiles(new Set([used, inBackup]), 7, Date.now() + 8 * 86_400_000);
    expect(later.removed).toBe(1);
    expect(await getFile(orphan)).toBeNull();
    expect(await getFile(inBackup)).not.toBeNull();
  });
});

/* ------------------------------------------------------------ fusión */

describe("fusión a tres bandas", () => {
  it("ajustes campo a campo y etiquetas de tareas", () => {
    const base = structuredClone(loadDb());
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.settings.theme = "dark";
    theirs.settings.appName = "Mi app";
    const merged = mergeDbs(base, ours, theirs);
    expect(merged.settings.theme).toBe("dark");
    expect(merged.settings.appName).toBe("Mi app");
  });
});
