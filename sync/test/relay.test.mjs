// Prueba de integración del servicio local: se arranca server.mjs de verdad
// y se habla con él por HTTP(S) y WebSocket como lo hace la app.
// Ejecutar: npm test -w gestion-tareas-sync

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import { WebSocket } from "ws";
import forge from "node-forge";

const HERE = dirname(fileURLToPath(import.meta.url));
const CODE = "TEST-C0DE";
const tmp = mkdtempSync(join(tmpdir(), "gt-relay-"));
const procs = [];

function start(port, extra = []) {
  const p = spawn(
    process.execPath,
    [join(HERE, "..", "server.mjs"), "--port", String(port), "--code", CODE, "--state-dir", join(tmp, "state"), "--cert-dir", join(tmp, "cert"), ...extra],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  procs.push(p);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no arrancó")), 60000);
    let out = "";
    p.stdout.on("data", (d) => {
      out += d;
      if (out.includes("Código emparejar")) {
        clearTimeout(t);
        resolve(out);
      }
    });
    p.stderr.on("data", (d) => (out += d));
    p.on("exit", (c) => reject(new Error(`salió ${c}: ${out}`)));
  });
}

const PORT = 42000 + Math.floor(Math.random() * 1500);
const TLS_PORT = PORT + 10;
let banner;

before(async () => {
  banner = await start(PORT, ["--http"]);
});

after(() => {
  for (const p of procs) p.kill();
  rmSync(tmp, { recursive: true, force: true });
});

function client(port = PORT) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    const i = waiters.findIndex((w) => w.type === m.type);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
    else inbox.push(m);
  });
  const next = (type, ms = 3000) => {
    const i = inbox.findIndex((m) => m.type === type);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`sin ${type}`)), ms);
      waiters.push({ type, resolve: (m) => (clearTimeout(t), resolve(m)) });
    });
  };
  const opened = new Promise((r) => ws.on("open", r));
  return { ws, next, opened, send: (m) => ws.send(JSON.stringify(m)) };
}

async function join_(name, code = CODE) {
  const c = client();
  await c.opened;
  c.send({ type: "hello", code, deviceId: name, name });
  return c;
}

test("el banner muestra el código y la dirección para el iPhone", () => {
  assert.match(banner, /TEST-C0DE/);
  assert.match(banner, /localhost:\d+/);
});

test("un código incorrecto no entra", async () => {
  const c = await join_("intruso", "XXXX-XXXX");
  assert.equal((await c.next("denied")).type, "denied");
});

test("el código admite minúsculas y sin guion", async () => {
  const c = await join_("flex", "testc0de");
  await c.next("welcome");
  c.ws.close();
});

test("presencia y mensajes dirigidos; el relé no guarda nada", async () => {
  const pc = await join_("pc");
  await pc.next("welcome");
  const phone = await join_("iphone");
  const w = await phone.next("welcome");
  assert.deepEqual(w.peers.map((p) => p.deviceId).sort(), ["iphone", "pc"]);
  // La primera presencia que recibe el PC es la de su propia entrada.
  let pres = await pc.next("presence");
  while (!pres.peers.some((p) => p.deviceId === "iphone")) pres = await pc.next("presence");
  assert.ok(pres.peers.some((p) => p.deviceId === "iphone"));

  phone.send({ type: "send", to: "pc", id: "m1", payload: { cifrado: "AAAA" } });
  assert.equal((await phone.next("sent")).id, "m1");
  const got = await pc.next("msg");
  assert.deepEqual([got.from, got.id, got.payload.cifrado], ["iphone", "m1", "AAAA"]);

  phone.send({ type: "send", to: "nadie", id: "m2", payload: {} });
  assert.equal((await phone.next("undeliverable")).id, "m2");

  // No hay instantáneas ni copias de datos en disco: solo el código.
  const stateFiles = existsSync(join(tmp, "state")) ? readdirSync(join(tmp, "state")) : [];
  assert.ok(stateFiles.every((f) => f === "code.txt"), `ficheros inesperados: ${stateFiles}`);
  pc.ws.close();
  phone.ws.close();
});

test("datos de emparejamiento solo desde loopback; CA descargable y válida", async () => {
  const pair = await (await fetch(`http://127.0.0.1:${PORT}/pair`)).json();
  assert.equal(pair.code, "TEST-C0DE");
  assert.match(pair.caFingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  const der = Buffer.from(await (await fetch(`http://127.0.0.1:${PORT + 2}/ca.crt`)).arrayBuffer());
  const ca = forge.pki.certificateFromAsn1(forge.asn1.fromDer(der.toString("binary")));
  assert.equal(ca.getExtension("basicConstraints").cA, true);
  // La página de configuración (accesible en la LAN) NO muestra el código.
  const page = await (await fetch(`http://127.0.0.1:${PORT + 2}/`)).text();
  assert.match(page, /Descargar certificado/);
  assert.doesNotMatch(page, /TEST-C0DE/);
});

test("HTTPS: un cliente que solo confía en la CA local acepta el servidor (como el iPhone)", async () => {
  await start(TLS_PORT);
  const caPem = readFileSync(join(tmp, "cert", "ca.pem"), "utf8");
  const body = await new Promise((resolve, reject) => {
    https
      .get({ host: "127.0.0.1", port: TLS_PORT, path: "/health", ca: caPem }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(d));
      })
      .on("error", reject);
  });
  assert.equal(JSON.parse(body).ok, true);
  // Y sin la CA, la conexión se rechaza (no es un certificado cualquiera).
  await assert.rejects(
    new Promise((resolve, reject) => https.get({ host: "127.0.0.1", port: TLS_PORT, path: "/health" }, resolve).on("error", reject))
  );
  // iOS exige como máximo 825 días de validez en el certificado del servidor.
  const leaf = forge.pki.certificateFromPem(readFileSync(join(tmp, "cert", "server.pem"), "utf8"));
  const days = (leaf.validity.notAfter - leaf.validity.notBefore) / 86400000;
  assert.ok(days <= 826, `validez ${days} días`);
  assert.ok(existsSync(join(tmp, "cert", "ca-key.pem")));
});

test("bloquea la fuerza bruta del código tras 10 intentos", async () => {
  for (let i = 0; i < 10; i++) {
    const c = await join_(`b${i}`, `MAL${i}`);
    await c.next("denied");
  }
  const c = await join_("b-ok");
  assert.equal((await c.next("denied")).reason, "rate");
});
