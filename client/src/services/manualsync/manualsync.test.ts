import { describe, expect, it } from "vitest";
import { dropCache, loadDb, type Db } from "@/services/localDb";
import { accountBalances } from "@/services/finance/calc";
import { call, expectStatus, makeAccount, makeTx } from "@/test/helpers";
import { entriesOf, manifestOf } from "./keyspace";
import type { Answer, Offer, Plan, Resolution } from "./engine";
import {
  buildBackup,
  commitPlan,
  createOffer,
  currentBase,
  getSelf,
  openFile,
  pendingFor,
  planIncoming,
  receiveAnswer,
  restoreBackup,
  rollbackTo,
  sealBackup,
  sealFile,
  setDeviceName,
  syncLog,
} from "./session";
import { listRestorePoints } from "@/services/storage";
import { seal, open } from "./crypto";

/**
 * Cada dispositivo tiene su PROPIO almacenamiento (datos, id de dispositivo,
 * bases, historial). `use()` lo activa, como si cambiáramos de aparato.
 */
class Device {
  store = new Map<string, string>();
  constructor(public name: string) {}
  use() {
    const s = this.store;
    (globalThis as any).localStorage = {
      get length() {
        return s.size;
      },
      clear: () => s.clear(),
      getItem: (k: string) => (s.has(k) ? s.get(k)! : null),
      key: (i: number) => [...s.keys()][i] ?? null,
      removeItem: (k: string) => s.delete(k),
      setItem: (k: string, v: string) => s.set(k, String(v)),
    };
    dropCache();
    return this;
  }
  async init() {
    this.use();
    loadDb();
    await setDeviceName(this.name);
    return this;
  }
  db(): Db {
    this.use();
    return loadDb();
  }
}

const allRemote = (p: Plan) => Object.fromEntries(p.conflicts.map((c) => [c.key, { choice: "remote" } as Resolution]));

/**
 * Sincronización completa por "archivos": `from` exporta oferta, `to` la
 * importa y resuelve, `from` aplica la respuesta. Devuelve el plan visto por `to`.
 */
async function syncFiles(from: Device, to: Device, resolve: (p: Plan) => Record<string, Resolution> = () => ({}), password = "clave-segura") {
  to.use();
  const toSelf = await getSelf();
  from.use();
  const offer = await createOffer(toSelf.deviceId);
  const offerFile = JSON.stringify(await sealFile(offer, password));

  to.use();
  const opened = await openFile(offerFile, password);
  expect(opened.kind).toBe("offer");
  const plan = await planIncoming(opened.payload);
  if (plan.errors.length) return { plan, offer, answer: null as Answer | null };
  const { answer } = await commitPlan(plan, resolve(plan), "archivo");
  const answerFile = JSON.stringify(await sealFile(answer, password));

  from.use();
  const got = await openFile(answerFile, password);
  expect(got.kind).toBe("answer");
  await receiveAnswer(got.payload, "archivo");
  return { plan, offer, answer };
}

function sameData(a: Device, b: Device) {
  const ma = manifestOf(entriesOf(a.db()));
  const mb = manifestOf(entriesOf(b.db()));
  const live = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([, h]) => h !== "†"));
  expect(live(ma)).toEqual(live(mb));
}

describe("sincronización manual bidireccional", () => {
  it("primera sincronización: une los datos de ambos sin duplicar los de ejemplo", async () => {
    const phone = await new Device("iPhone").init();
    const pc = await new Device("PC").init();
    phone.use();
    await makeAccount({ name: "Efectivo iPhone", initialBalance: 1000 });
    await call("POST", "/tasks", { title: "Tarea creada en el iPhone" });
    pc.use();
    await makeAccount({ name: "Banco PC", initialBalance: 5000 });

    const { plan } = await syncFiles(phone, pc);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.incoming.map((i) => i.label)).toContain("Tarea creada en el iPhone");
    sameData(phone, pc);
    // Los datos de ejemplo (ids fijos) existen una sola vez.
    expect(pc.db().tasks.filter((t) => t.title === "Enviar reporte semanal")).toHaveLength(1);
    expect(pc.db().finAccounts.map((a) => a.name).sort()).toEqual(["Banco PC", "Efectivo iPhone"]);
  });

  it("después solo viaja lo que cambió (delta), en ambos sentidos", async () => {
    const phone = await new Device("iPhone").init();
    const pc = await new Device("PC").init();
    await syncFiles(phone, pc);

    phone.use();
    const acc = await makeAccount({ name: "Cuenta", initialBalance: 0 });
    await makeTx({ accountId: acc.id, kind: "income", amount: 700, concept: "Del iPhone" });
    pc.use();
    await call("POST", "/tasks", { title: "Del PC" });

    // PC -> iPhone esta vez.
    const { plan, offer } = await syncFiles(pc, phone);
    // La oferta del PC lleva su tarea (y su conjunto de etiquetas), no toda la base.
    expect(offer.entries.length).toBeLessThanOrEqual(3);
    expect(plan.incoming.some((i) => i.label === "Del PC")).toBe(true);
    expect(plan.outgoing.some((i) => i.label === "Del iPhone")).toBe(true);
    sameData(phone, pc);
    expect(accountBalances(pc.db()).get(acc.id)).toBe(700);

    // Sin cambios: nada pendiente y la siguiente oferta va vacía.
    pc.use();
    const phoneId = (phone.use(), await getSelf()).deviceId;
    pc.use();
    expect(await pendingFor(phoneId)).toHaveLength(0);
    expect((await createOffer(phoneId)).entries).toHaveLength(0);
  });

  it("conflicto normal: se muestran las diferencias y se puede elegir o combinar", async () => {
    const phone = await new Device("iPhone").init();
    const pc = await new Device("PC").init();
    phone.use();
    const task = await call("POST", "/tasks", { title: "Original", priority: "low" });
    await syncFiles(phone, pc);

    phone.use();
    await call("PUT", `/tasks/${task.id}`, { title: "Título desde el iPhone" });
    await new Promise((r) => setTimeout(r, 3));
    pc.use();
    await call("PUT", `/tasks/${task.id}`, { priority: "high" });

    const { plan } = await syncFiles(phone, pc, (p) => {
      const c = p.conflicts.find((x) => x.key === `tasks:${task.id}`)!;
      expect(c.canCombine).toBe(true);
      expect(c.suggestion).toBe("local"); // el PC editó después
      expect(c.fields.map((f) => f.field).sort()).toEqual(["priority", "title"]);
      // Combinar: título del iPhone (remoto para el PC) y prioridad del PC.
      return { [c.key]: { choice: "combine", fields: { title: "remote", priority: "local" } } };
    });
    expect(plan.conflicts).toHaveLength(1);
    for (const d of [phone, pc]) {
      const t = d.db().tasks.find((x) => x.id === task.id)!;
      expect([t.title, t.priority]).toEqual(["Título desde el iPhone", "high"]);
    }
    sameData(phone, pc);
  });

  it("conflicto financiero: sin sugerencia por fecha, sin combinar y obligatorio decidir", async () => {
    const phone = await new Device("iPhone").init();
    const pc = await new Device("PC").init();
    phone.use();
    const acc = await makeAccount({ initialBalance: 0 });
    const tx = await makeTx({ accountId: acc.id, amount: 1000, date: "2026-09-10", concept: "Mercado" });
    await syncFiles(phone, pc);

    const body = { kind: "expense", accountId: acc.id, date: "2026-09-10", concept: "Mercado" };
    phone.use();
    await call("PUT", `/finance/transactions/${tx.id}`, { ...body, amount: 1200 });
    pc.use();
    await call("PUT", `/finance/transactions/${tx.id}`, { ...body, amount: 900 });

    // Sin resolver: no se aplica nada.
    phone.use();
    const pcId = (pc.use(), await getSelf()).deviceId;
    phone.use();
    const offer = await createOffer(pcId);
    pc.use();
    const plan = await planIncoming(JSON.parse(JSON.stringify(offer)));
    const c = plan.conflicts.find((x) => x.key === `finTransactions:${tx.id}`)!;
    expect(c.finance).toBe(true);
    expect(c.suggestion).toBeNull();
    expect(c.canCombine).toBe(false);
    await expect(commitPlan(plan, {}, "archivo")).rejects.toThrow(/conflicto/);
    expect(pc.db().finTransactions[0].amount).toBe(900);

    // El usuario elige la versión del iPhone.
    const { answer } = await commitPlan(plan, { [c.key]: { choice: "remote" } }, "archivo");
    phone.use();
    await receiveAnswer(JSON.parse(JSON.stringify(answer)), "archivo");
    for (const d of [phone, pc]) expect(accountBalances(d.db()).get(acc.id)).toBe(-1200);
  });

  it("borrar en un lado se propaga; borrar vs modificar es conflicto", async () => {
    const phone = await new Device("iPhone").init();
    const pc = await new Device("PC").init();
    phone.use();
    const a = await call("POST", "/tasks", { title: "Se borrará" });
    const b = await call("POST", "/tasks", { title: "Borrada y editada" });
    await syncFiles(phone, pc);

    phone.use();
    await call("DELETE", `/tasks/${a.id}`);
    await call("DELETE", `/tasks/${b.id}`);
    pc.use();
    await call("PUT", `/tasks/${b.id}`, { title: "Editada en el PC" });

    const { plan } = await syncFiles(phone, pc, (p) => {
      const c = p.conflicts.find((x) => x.key === `tasks:${b.id}`)!;
      expect(c.remote).toBeNull(); // borrada en el iPhone
      return { [c.key]: { choice: "local" }, ...Object.fromEntries(p.conflicts.filter((x) => x.key !== c.key).map((x) => [x.key, { choice: "local" } as Resolution])) };
    });
    expect(plan.incoming.some((i) => i.key === `tasks:${a.id}` && i.kind === "delete")).toBe(true);
    expect(pc.db().tasks.some((t) => t.id === a.id)).toBe(false);
    // Se conservó la edición: vuelve a existir también en el iPhone.
    expect(phone.db().tasks.find((t) => t.id === b.id)?.title).toBe("Editada en el PC");
  });

  it("relaciones: una cuenta borrada en un lado mientras el otro le añadía movimientos se conserva", async () => {
    const phone = await new Device("iPhone").init();
    const pc = await new Device("PC").init();
    phone.use();
    const acc = await makeAccount({ name: "Temporal", initialBalance: 0 });
    await syncFiles(phone, pc);

    pc.use();
    await call("DELETE", `/finance/accounts/${acc.id}`);
    phone.use();
    await makeTx({ accountId: acc.id, kind: "income", amount: 500 });

    const { answer } = await syncFiles(phone, pc);
    expect(answer!.summary.repaired).toBeGreaterThan(0);
    for (const d of [phone, pc]) {
      expect(d.db().finAccounts.some((x) => x.id === acc.id)).toBe(true);
      expect(accountBalances(d.db()).get(acc.id)).toBe(500);
    }
    sameData(phone, pc);
  });

  it("sin duplicados: pago recurrente confirmado en ambos y reimportar el mismo paquete", async () => {
    const phone = await new Device("iPhone").init();
    const pc = await new Device("PC").init();
    phone.use();
    const acc = await makeAccount({ initialBalance: 0 });
    const r = await call("POST", "/finance/recurring", { name: "Salario", kind: "income", amount: 3000, accountId: acc.id, frequency: "monthly", startDate: "2026-09-01" });
    await syncFiles(phone, pc);
    phone.use();
    await call("POST", `/finance/recurring/${r.id}/confirm`, { date: "2026-09-01" });
    await new Promise((res) => setTimeout(res, 3)); // marcas distintas: ejercita la resolución automática
    pc.use();
    await call("POST", `/finance/recurring/${r.id}/confirm`, { date: "2026-09-01" });

    const { plan } = await syncFiles(phone, pc);
    expect(plan.conflicts).toHaveLength(0); // mismo contenido: resuelto solo
    expect(plan.auto.length).toBeGreaterThan(0);
    for (const d of [phone, pc]) {
      expect(d.db().finTransactions).toHaveLength(1);
      expect(accountBalances(d.db()).get(acc.id)).toBe(3000);
    }

    // Reimportar un paquete ya aplicado no duplica nada.
    pc.use();
    const pcId = (await getSelf()).deviceId;
    phone.use();
    const offer = await createOffer(pcId, { full: true });
    pc.use();
    const again = await planIncoming(JSON.parse(JSON.stringify(offer)));
    expect(again.incoming).toHaveLength(0);
    expect(again.conflicts).toHaveLength(0);
  });

  it("la respuesta no se aplica si el dispositivo cambió esos datos mientras tanto", async () => {
    const phone = await new Device("iPhone").init();
    const pc = await new Device("PC").init();
    phone.use();
    const t = await call("POST", "/tasks", { title: "A" });
    await syncFiles(phone, pc);
    pc.use();
    await call("PUT", `/tasks/${t.id}`, { title: "B (PC)" });
    const pcId = (await getSelf()).deviceId;

    phone.use();
    const offer = await createOffer(pcId);
    pc.use();
    const plan = await planIncoming(JSON.parse(JSON.stringify(offer)));
    const { answer } = await commitPlan(plan, {}, "archivo");
    // El iPhone edita la misma tarea ANTES de aplicar la respuesta.
    phone.use();
    await call("PUT", `/tasks/${t.id}`, { title: "C (iPhone, tarde)" });
    await expect(receiveAnswer(JSON.parse(JSON.stringify(answer)), "archivo")).rejects.toThrow(/No se aplicó nada/);
    expect(phone.db().tasks.find((x) => x.id === t.id)?.title).toBe("C (iPhone, tarde)");
    // Volver a sincronizar lo resuelve como conflicto normal.
    const { plan: p2 } = await syncFiles(phone, pc, allRemote);
    expect(p2.conflicts.length).toBe(1);
    sameData(phone, pc);
  });

  it("si la respuesta se pierde, la siguiente sincronización sigue encontrando la base común", async () => {
    const phone = await new Device("iPhone").init();
    const pc = await new Device("PC").init();
    await syncFiles(phone, pc);
    phone.use();
    await call("POST", "/tasks", { title: "Perdida" });
    const pcId = (pc.use(), await getSelf()).deviceId;
    phone.use();
    const offer = await createOffer(pcId);
    pc.use();
    await commitPlan(await planIncoming(JSON.parse(JSON.stringify(offer))), {}, "archivo");
    // ... la respuesta nunca llega al iPhone. Más tarde:
    const { plan } = await syncFiles(phone, pc);
    expect(plan.errors).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
    sameData(phone, pc);
  });

  it("rechaza paquetes con datos financieros inválidos sin aplicar nada", async () => {
    const pc = await new Device("PC").init();
    const bad: Offer = {
      protocol: 1,
      kind: "offer",
      id: "x",
      createdAt: new Date().toISOString(),
      from: { deviceId: "otro", name: "Otro" },
      to: null,
      baseId: null,
      full: true,
      manifest: { "finTransactions:t1": "h" },
      entries: [{ key: "finTransactions:t1", row: { id: "t1", kind: "income", amount: 10.5 } }],
    };
    pc.use();
    const plan = await planIncoming(bad);
    expect(plan.errors.length).toBeGreaterThan(0);
    await expect(commitPlan(plan, {}, "archivo")).rejects.toThrow();
  });

  it("un delta sin base común pide un paquete completo", async () => {
    const phone = await new Device("iPhone").init();
    const pc = await new Device("PC").init();
    await syncFiles(phone, pc);
    const other = await new Device("Otro PC").init();
    phone.use();
    const pcId = (pc.use(), await getSelf()).deviceId;
    phone.use();
    const offer = await createOffer(pcId);
    other.use();
    const plan = await planIncoming(JSON.parse(JSON.stringify(offer)));
    expect(plan.needFull).toBe(true);
  });

  it("los ajustes compartidos viajan; el PIN y el tema no", async () => {
    const phone = await new Device("iPhone").init();
    const pc = await new Device("PC").init();
    phone.use();
    await call("PUT", "/settings", { userName: "Santiago", currency: "USD", theme: "dark" });
    await call("POST", "/settings/pin", { pin: "4321" });
    await syncFiles(phone, pc);
    const s = pc.db().settings;
    expect([s.userName, s.currency]).toEqual(["Santiago", "USD"]);
    expect(s.pinHash).toBeNull();
    expect(s.theme).not.toBe("dark");
  });

  it("registra el historial y la base común en ambos", async () => {
    const phone = await new Device("iPhone").init();
    const pc = await new Device("PC").init();
    await syncFiles(phone, pc);
    for (const [d, peer] of [
      [phone, pc],
      [pc, phone],
    ] as const) {
      const peerId = (peer.use(), await getSelf()).deviceId;
      d.use();
      expect((await syncLog())[0]).toMatchObject({ peer: peerId, status: "ok", method: "archivo" });
      expect(await currentBase(peerId)).not.toBeNull();
    }
  });
});

describe("cifrado y copias", () => {
  it("contraseña incorrecta o archivo alterado: error claro, nunca datos parciales", async () => {
    const env = await seal({ secreto: 42 }, "correcta", "backup");
    await expect(open(env, "incorrecta")).rejects.toThrow(/contraseña/);
    const tampered = { ...env, data: env.data.slice(0, -4) + (env.data.endsWith("AAAA") ? "BBBB" : "AAAA") };
    await expect(open(tampered, "correcta")).rejects.toThrow();
    // Cambiar el tipo de contenido rompe la autenticación.
    await expect(open({ ...env, content: "answer" }, "correcta")).rejects.toThrow();
    expect(await open(env, "correcta")).toEqual({ secreto: 42 });
    expect(JSON.stringify(env)).not.toContain("secreto");
  });

  it("copia cifrada: restaurar reemplaza los datos y deja un punto de restauración para deshacer", async () => {
    const d = await new Device("iPhone").init();
    d.use();
    await makeAccount({ name: "Antes de la copia", initialBalance: 100 });
    const sealed = await sealBackup("pw");
    expect(sealed).not.toContain("Antes de la copia");
    await makeAccount({ name: "Después de la copia" });
    const { kind, payload } = await openFile(sealed, "pw");
    expect(kind).toBe("backup");
    await restoreBackup(payload as any);
    expect(loadDb().finAccounts.map((a) => a.name)).toEqual(["Antes de la copia"]);
    const points = await listRestorePoints();
    expect(points[0].reason).toMatch(/restaurar/);
    await rollbackTo(points[0].id);
    expect(loadDb().finAccounts.map((a) => a.name).sort()).toEqual(["Antes de la copia", "Después de la copia"]);
    // La copia nunca incluye el hash del PIN.
    await call("POST", "/settings/pin", { pin: "1234" });
    expect((await buildBackup()).db.settings.pinHash).toBeNull();
    await expectStatus(404, call("GET", "/nope"));
  });
});
