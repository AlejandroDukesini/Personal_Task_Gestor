/**
 * Prueba de extremo a extremo de la sincronización por red, con piezas reales:
 *  - el servicio local del PC (sync/server.mjs) en su propio proceso;
 *  - un "PC" en otro proceso con su propio almacenamiento, ejecutando el
 *    código de la app en modo «Recibir sincronizaciones»;
 *  - el "iPhone" en este proceso.
 * Empareja con el código, sincroniza en ambos sentidos con un conflicto y
 * comprueba que los dos quedan con los mismos datos.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadDb } from "@/services/localDb";
import { call } from "@/test/helpers";
import { entriesOf, manifestOf } from "./keyspace";
import { listDevices, setDeviceName, syncLog } from "./session";
import { pairWith, startNetworkSync } from "./network";

const ROOT = path.resolve(__dirname, "../../../..");
const PORT = 43000 + Math.floor(Math.random() * 1500);
const CODE = "K7M2-9QXA";
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync(path.join(tmpdir(), "gt-e2e-"));
let relay: ChildProcess;
let pc: ChildProcess;
const events: any[] = [];
const waiters: ((e: any) => boolean)[] = [];

function waitEvent(pred: (e: any) => boolean, ms = 20000): Promise<any> {
  const hit = events.find(pred);
  if (hit) {
    events.splice(events.indexOf(hit), 1);
    return Promise.resolve(hit);
  }
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout esperando al PC")), ms);
    waiters.push((e) => {
      if (!pred(e)) return false;
      clearTimeout(t);
      resolve(e);
      return true;
    });
  });
}

function pcCommand(cmd: object) {
  pc.stdin!.write(`${JSON.stringify(cmd)}\n`);
}

beforeAll(async () => {
  relay = spawn(process.execPath, [path.join(ROOT, "sync/server.mjs"), "--http", "--port", String(PORT), "--code", CODE, "--state-dir", path.join(tmp, "s"), "--cert-dir", path.join(tmp, "c")], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("relé no arrancó")), 60000);
    relay.stdout!.on("data", (d) => String(d).includes("Código emparejar") && (clearTimeout(t), resolve()));
  });
  pc = spawn(process.execPath, [path.join(ROOT, "node_modules/vite-node/vite-node.mjs"), "--root", path.join(ROOT, "client"), "src/test/pc-device.ts", URL_, CODE], {
    cwd: path.join(ROOT, "client"),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  pc.stdout!.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.startsWith("@@")) continue;
      const e = JSON.parse(line.slice(2));
      const w = waiters.findIndex((fn) => fn(e));
      if (w >= 0) waiters.splice(w, 1);
      else events.push(e);
    }
  });
  pc.stderr!.on("data", (d) => process.stderr.write(`[pc] ${d}`));
  await waitEvent((e) => e.ev === "ready", 90000);
}, 120000);

afterAll(() => {
  pc?.kill();
  relay?.kill();
  rmSync(tmp, { recursive: true, force: true });
});

async function pcManifest() {
  pcCommand({ do: "manifest" });
  return (await waitEvent((e) => e.ev === "manifest")).manifest as Record<string, string>;
}

const live = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([, h]) => h !== "†"));

describe("sincronización por red local (extremo a extremo)", () => {
  it("empareja con el código y sincroniza en ambos sentidos con un conflicto financiero", async () => {
    loadDb();
    await setDeviceName("iPhone de prueba");
    await expect(pairWith(URL_, "XXXX-XXXX")).rejects.toThrow(/código/);
    const pcDevice = await pairWith(URL_, CODE.toLowerCase());
    expect(pcDevice.name).toBe("PC de prueba");
    expect(pcDevice.secret).toBeTruthy();
    expect((await waitEvent((e) => e.ev === "paired")).name).toBe("iPhone de prueba");

    // --- Sincronizar ahora: iPhone <-> PC en ambos sentidos, con conflicto financiero.
    const [stored] = await listDevices();
    expect(stored.deviceId).toBe(pcDevice.deviceId); // el emparejamiento quedó guardado
    // Datos del iPhone.
    const acc = await call("POST", "/finance/accounts", { name: "Efectivo", type: "cash", currency: "COP", initialBalance: 1000 });
    const tx = await call("POST", "/finance/transactions", { kind: "expense", amount: 200, accountId: acc.id, date: "2026-09-10", concept: "Café" });

    // Primera sincronización.
    let session = await startNetworkSync(pcDevice);
    expect(session.plan.incoming.some((i) => i.label === "Creada en el PC")).toBe(true);
    expect(session.plan.outgoing.some((i) => i.label === "Efectivo")).toBe(true);
    let res = await session.finish({});
    expect(res.summary.sent).toBeGreaterThan(0);
    await waitEvent((e) => e.ev === "synced");
    expect(live(await pcManifest())).toEqual(live(manifestOf(entriesOf(loadDb()))));

    // Cambios concurrentes sobre el mismo movimiento + uno nuevo en el PC.
    const body = { kind: "expense", accountId: acc.id, date: "2026-09-10", concept: "Café" };
    await call("PUT", `/finance/transactions/${tx.id}`, { ...body, amount: 250 });
    pcCommand({ do: "request", method: "PUT", path: `/finance/transactions/${tx.id}`, body: { ...body, amount: 300 } });
    await waitEvent((e) => e.ev === "response");
    pcCommand({ do: "request", method: "POST", path: "/tasks", body: { title: "Segunda del PC" } });
    await waitEvent((e) => e.ev === "response");

    session = await startNetworkSync(pcDevice);
    const conflict = session.plan.conflicts.find((c) => c.key === `finTransactions:${tx.id}`)!;
    expect(conflict.finance).toBe(true);
    expect(conflict.suggestion).toBeNull();
    // Solo viajan los cambios (delta), no toda la base.
    expect(session.plan.offer.entries.length).toBeLessThan(10);
    res = await session.finish({ [conflict.key]: { choice: "remote" } });
    await waitEvent((e) => e.ev === "synced");

    expect(loadDb().finTransactions.find((t) => t.id === tx.id)?.amount).toBe(300);
    expect(loadDb().tasks.some((t) => t.title === "Segunda del PC")).toBe(true);
    expect(live(await pcManifest())).toEqual(live(manifestOf(entriesOf(loadDb()))));
    expect((await syncLog())[0]).toMatchObject({ method: "red", status: "ok" });
  }, 120000);
});
