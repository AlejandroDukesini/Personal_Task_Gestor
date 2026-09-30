import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { bootDb, dropCache, loadDb } from "@/services/localDb";
import { __resetStorageForTests, __tuneForTests, flushStorage, listRestorePoints } from "@/services/storage";
import { __resetFilesForTests, getFile, putFile } from "@/services/notes/files";
import { seal } from "@/services/manualsync/crypto";
import { openFile } from "@/services/manualsync/session";
import { call } from "@/test/helpers";
import {
  BACKUP_FORMAT,
  SEALED_BACKUP_FORMAT,
  buildBackupFile,
  inspectBackupText,
  parseBackupText,
  restoreParsed,
  serializeBackup,
} from "./backup";

/** Otro dispositivo: navegador vacío, sin acceso al almacenamiento del original. */
async function newDevice() {
  await flushStorage();
  __resetStorageForTests();
  __resetFilesForTests();
  dropCache();
  (globalThis as any).indexedDB = new IDBFactory();
  localStorage.clear();
  await bootDb();
}

async function sampleData() {
  await call("POST", "/tasks", { title: "Tarea del PC" });
  const h = await call("POST", "/habits", { name: "Leer", dailyTarget: 2 });
  await call("POST", `/habits/${h.id}/logs`, { date: new Date().toISOString(), count: 2 });
  await call("POST", `/habits/${h.id}/schedules`, { kind: "once", startTime: "07:00", startDate: "2026-10-01" });
  await call("POST", "/finance/accounts", { name: "Banco del PC", type: "bank", currency: "COP", initialBalance: 1000 });
  await call("POST", "/categories", { name: "Categoría del PC" });
  await call("POST", "/notes", { title: "Nota del PC", content: null });
  await call("PUT", "/settings", { appName: "Mi productividad" });
}

beforeEach(async () => {
  (globalThis as any).indexedDB = new IDBFactory();
  __resetFilesForTests();
  __tuneForTests({ retryDelays: [0, 0, 0] });
  await bootDb();
});

afterEach(async () => {
  await flushStorage().catch(() => undefined);
  __resetStorageForTests();
});

describe("copia SIN cifrar (caso A)", () => {
  it("lleva el indicador explícito, se detecta sin contraseña y se restaura en otro dispositivo sin pedirla", async () => {
    await sampleData();
    const text = await serializeBackup(await buildBackupFile());
    const json = JSON.parse(text);
    expect(json).toMatchObject({ format: BACKUP_FORMAT, v: 2, encrypted: false });
    expect(inspectBackupText(text)).toMatchObject({ status: "backup", encrypted: false, format: "v2" });

    await newDevice();
    expect(loadDb().tasks.some((t) => t.title === "Tarea del PC")).toBe(false);
    // Sin contraseña: funciona. Nunca se intenta descifrar.
    const parsed = await parseBackupText(text);
    const r = await restoreParsed(parsed, "replace");
    expect(r.safetyBackup.verified).toBe(true);
    const db = loadDb();
    expect(db.tasks.some((t) => t.title === "Tarea del PC")).toBe(true);
    expect(db.finAccounts.some((a) => a.name === "Banco del PC")).toBe(true);
    expect(db.categories.some((c) => c.name === "Categoría del PC")).toBe(true);
    expect(db.notes.some((n) => n.title === "Nota del PC")).toBe(true);
    expect(db.habitLogs[0]).toMatchObject({ count: 2 });
    expect(db.habitSchedules).toHaveLength(1);
    expect(db.settings.appName).toBe("Mi productividad");
  });

  it("una contraseña escrita por error en una copia sin cifrar se ignora", async () => {
    await sampleData();
    const text = await serializeBackup(await buildBackupFile());
    await expect(parseBackupText(text, "no-hacia-falta")).resolves.toBeTruthy();
  });

  it("tras reiniciar la app, los datos restaurados siguen ahí (el estado vacío no los pisa)", async () => {
    await sampleData();
    const text = await serializeBackup(await buildBackupFile());
    await newDevice();
    await restoreParsed(await parseBackupText(text), "replace");
    await flushStorage();
    __resetStorageForTests();
    dropCache();
    await bootDb();
    expect(loadDb().tasks.some((t) => t.title === "Tarea del PC")).toBe(true);
  });
});

describe("copia CIFRADA (caso B)", () => {
  it("indica que está cifrada y con qué, pide la contraseña, rechaza la incorrecta y restaura con la correcta", async () => {
    await sampleData();
    const text = await serializeBackup(await buildBackupFile(), "clave-segura-123");
    const json = JSON.parse(text);
    expect(json).toMatchObject({ format: SEALED_BACKUP_FORMAT, v: 2, encrypted: true, cipher: { alg: "AES-256-GCM", kdf: "PBKDF2-SHA256" } });
    expect(text).not.toContain("Tarea del PC");
    expect(text).not.toContain("clave-segura-123");
    expect(inspectBackupText(text)).toMatchObject({ status: "backup", encrypted: true });

    await newDevice();
    const before = JSON.stringify(loadDb());
    await expect(parseBackupText(text)).rejects.toMatchObject({ code: "password", message: expect.stringMatching(/Copia cifrada detectada/) });
    await expect(parseBackupText(text, "otra")).rejects.toMatchObject({ code: "password", message: expect.stringMatching(/no es correcta/) });
    expect(JSON.stringify(loadDb())).toBe(before); // nada cambió
    // Reintento con la buena, con el mismo archivo.
    await restoreParsed(await parseBackupText(text, "clave-segura-123"), "replace");
    expect(loadDb().tasks.some((t) => t.title === "Tarea del PC")).toBe(true);
  });

  it("Sincronización (versión anterior) también reconoce el nuevo formato cifrado", async () => {
    await sampleData();
    const text = await serializeBackup(await buildBackupFile(), "clave-segura-123");
    const { kind } = await openFile(text, "clave-segura-123");
    expect(kind).toBe("backup");
  });
});

describe("copias antiguas (caso C)", () => {
  it("v1 sin cifrar (sin indicador): se detecta como NO cifrada y se restaura sin contraseña", async () => {
    await sampleData();
    const v1 = { format: BACKUP_FORMAT, v: 1, exportedAt: new Date().toISOString(), device: { deviceId: "d", name: "PC viejo" }, db: structuredClone(loadDb()) };
    const text = JSON.stringify(v1);
    expect(inspectBackupText(text)).toMatchObject({ status: "backup", encrypted: false, format: "v1" });
    await newDevice();
    await restoreParsed(await parseBackupText(text), "replace");
    expect(loadDb().tasks.some((t) => t.title === "Tarea del PC")).toBe(true);
  });

  it("v1 cifrada con el envoltorio antiguo ({ envelope, meta }): se detecta como cifrada", async () => {
    await sampleData();
    const v1 = { format: BACKUP_FORMAT, v: 1, exportedAt: new Date().toISOString(), device: { deviceId: "d", name: "PC viejo" }, db: structuredClone(loadDb()) };
    const text = JSON.stringify({ envelope: await seal(v1, "vieja-clave", "backup"), meta: { fromName: "PC viejo", createdAt: v1.exportedAt, content: "backup" } });
    expect(inspectBackupText(text)).toMatchObject({ status: "backup", encrypted: true, device: "PC viejo" });
    await expect(parseBackupText(text)).rejects.toMatchObject({ code: "password" });
    const ok = await parseBackupText(text, "vieja-clave");
    expect(ok.db.tasks.some((t) => t.title === "Tarea del PC")).toBe(true);
  });

  it("exportación JSON antigua de Ajustes: sin cifrar, se restaura", async () => {
    await sampleData();
    const legacy = await call("GET", "/backup/export");
    const text = JSON.stringify(legacy);
    expect(inspectBackupText(text)).toMatchObject({ status: "backup", encrypted: false, format: "export" });
    await newDevice();
    await restoreParsed(await parseBackupText(text), "replace");
    expect(loadDb().finAccounts.some((a) => a.name === "Banco del PC")).toBe(true);
  });

  it("un archivo con aspecto cifrado pero de formato desconocido no se adivina ni se intenta descifrar", async () => {
    const text = JSON.stringify({ iv: "abc", ciphertext: "zzz", salt: "q" });
    expect(inspectBackupText(text).status).toBe("uncertain");
    await expect(parseBackupText(text, "lo-que-sea")).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("archivos dañados o no admitidos (caso D)", () => {
  it("JSON roto = dañado (nunca «cifrado»); estructuras contradictorias o ajenas se rechazan", async () => {
    await sampleData();
    const good = await serializeBackup(await buildBackupFile());
    const cases: [string, string][] = [
      ["truncado", good.slice(0, 200)],
      ["binario", "\u0000\u0001PK\u0003\u0004 no es json"],
      ["dice cifrado sin serlo", JSON.stringify({ ...JSON.parse(good), encrypted: true })],
      ["envoltorio roto", JSON.stringify({ format: SEALED_BACKUP_FORMAT, v: 2, encrypted: true, envelope: { format: "gestion-tareas/sealed", data: 1 } })],
      ["formato futuro", JSON.stringify({ format: BACKUP_FORMAT, v: 9 })],
      ["ajeno", JSON.stringify({ hola: "mundo" })],
      ["lista", "[1,2,3]"],
    ];
    const before = JSON.stringify(loadDb());
    for (const [name, text] of cases) {
      const r = inspectBackupText(text);
      expect(r.status, name).toBe("invalid");
      await expect(parseBackupText(text), name).rejects.toMatchObject({ code: "invalid" });
    }
    // Contenido alterado: la suma de comprobación lo detecta.
    await expect(parseBackupText(good.replace("Tarea del PC", "Tarea falsa"))).rejects.toMatchObject({ code: "damaged" });
    expect(JSON.stringify(loadDb())).toBe(before);
  });

  it("los paquetes de sincronización se reconocen y se indica dónde abrirlos", async () => {
    const pkg = JSON.stringify({ envelope: await seal({ kind: "offer" }, "x", "offer"), meta: { content: "offer" } });
    expect(inspectBackupText(pkg)).toMatchObject({ status: "sync-package", encrypted: true });
    await expect(parseBackupText(pkg)).rejects.toThrow(/Sincronización/);
  });

  it("la detección nunca ejecuta nada del archivo (claves peligrosas descartadas)", async () => {
    await sampleData();
    const file = JSON.parse(await serializeBackup(await buildBackupFile()));
    delete file.checksum;
    file.v = 1;
    // Clave "__proto__" literal en el JSON (como la escribiría un archivo manipulado).
    const text = JSON.stringify(file).replace('"title":', '"__proto__":{"polluted":true},"title":');
    expect(text).toContain('"__proto__"');
    const parsed = await parseBackupText(text);
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(parsed.db.tasks[0], "__proto__")).toBe(false);
    expect(parsed.db.tasks.length).toBeGreaterThan(0);
  });
});

describe("seguridad de la restauración", () => {
  it("crea antes una copia verificada del estado actual", async () => {
    await call("POST", "/tasks", { title: "Lo que había" });
    const text = await serializeBackup(await buildBackupFile());
    await call("POST", "/tasks", { title: "Añadida después" });
    const r = await restoreParsed(await parseBackupText(text), "replace");
    const points = await listRestorePoints();
    expect(points.find((p) => p.id === r.safetyBackup.id)).toMatchObject({ verified: true, reason: "Antes de restaurar una copia de seguridad" });
  });

  it("si falla al guardar, se vuelve al estado anterior y se puede reintentar", async () => {
    await call("POST", "/tasks", { title: "Estado anterior" });
    await flushStorage();
    const incoming = await buildBackupFile();
    incoming.db.tasks = [{ ...structuredClone(incoming.db.tasks[0]), id: "nueva", title: "De la copia" }];
    const { checksumOf } = await import("@/services/storage");
    incoming.checksum = checksumOf(incoming.db);
    const parsed = await parseBackupText(JSON.stringify(incoming));

    const proto = (globalThis as any).IDBObjectStore.prototype;
    const realPut = proto.put;
    proto.put = function (value: unknown, key?: IDBValidKey) {
      if (key === "db") throw new DOMException("sin espacio", "QuotaExceededError");
      return realPut.call(this, value, key);
    };
    try {
      await expect(restoreParsed(parsed, "replace")).rejects.toMatchObject({ code: "storage", message: expect.stringMatching(/se deshizo/) });
    } finally {
      proto.put = realPut;
    }
    expect(loadDb().tasks.map((t) => t.title)).toContain("Estado anterior");
    expect(loadDb().tasks.map((t) => t.title)).not.toContain("De la copia");
    // Reintento, ahora con espacio.
    await restoreParsed(parsed, "replace");
    expect(loadDb().tasks.map((t) => t.title)).toEqual(["De la copia"]);
  });

  it("los adjuntos viajan de un dispositivo a otro", async () => {
    const bytes = new TextEncoder().encode("PDF simulado");
    const key = await putFile(bytes);
    const note = await call("POST", "/notes", { title: "Con adjunto", content: null });
    loadDb().notes.find((n) => n.id === note.id)!.attachments.push({ id: "a", fileKey: key, name: "f.pdf", label: null, kind: "pdf", mime: "application/pdf", size: bytes.length, addedAt: new Date().toISOString() });
    const text = await serializeBackup(await buildBackupFile({ includeFiles: true }));
    await newDevice();
    const r = await restoreParsed(await parseBackupText(text), "replace");
    expect(r.filesRestored).toBe(1);
    expect(new TextDecoder().decode((await getFile(key))!)).toBe("PDF simulado");
  });

  it("combinar datos: no duplica y conserva lo más reciente", async () => {
    const t = await call("POST", "/tasks", { title: "Compartida" });
    const text = await serializeBackup(await buildBackupFile());
    await call("PUT", `/tasks/${t.id}`, { title: "Compartida (editada aquí después)" });
    const r = await restoreParsed(await parseBackupText(text), "merge");
    expect(r.added).toBe(0);
    const titles = loadDb().tasks.map((x) => x.title);
    expect(titles.filter((x) => x.startsWith("Compartida"))).toEqual(["Compartida (editada aquí después)"]);
  });
});
