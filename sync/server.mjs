#!/usr/bin/env node
/**
 * Servicio local del PC para "Plan Gestor Task".
 *
 * Se arranca SOLO cuando quieres sincronizar (o usar la app del PC servida
 * desde aquí). El iPhone funciona igual con el PC apagado.
 *
 * QUÉ HACE
 *   - Sirve la app compilada (client/dist) en dos direcciones:
 *       https://<ip-del-pc>:4180   para el iPhone, en tu Wi-Fi
 *       http://localhost:4181      para el navegador del propio PC
 *                                  (localhost ya es "contexto seguro")
 *   - Hace de RELÉ entre dispositivos emparejados: reenvía mensajes CIFRADOS
 *     de extremo a extremo (AES-GCM con un secreto que solo conocen los dos
 *     dispositivos). No guarda datos, no los descifra y no entiende su formato.
 *   - Genera una autoridad de certificación LOCAL para que el iPhone confíe
 *     en https://<ip-del-pc>: Safari no abre conexiones seguras (wss) a un
 *     certificado autofirmado sin más. Se instala una vez en el iPhone desde
 *     la página de configuración http://<ip-del-pc>:4182.
 *
 * QUÉ **NO** HACE
 *   - No sincroniza nada por sí mismo ni guarda copias de tus datos: la
 *     sincronización la inicia el usuario desde la app, y la fusión y la
 *     resolución de conflictos ocurren en los dispositivos.
 *   - No publica nada en internet.
 *
 * USO
 *   node server.mjs                   # https :4180, local :4181, config :4182
 *   node server.mjs --new-code        # genera un código de emparejamiento nuevo
 *   node server.mjs --http            # (pruebas) el puerto principal en http
 */

import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { X509Certificate, createHash, createPrivateKey, randomInt, timingSafeEqual, webcrypto } from "node:crypto";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocketServer } from "ws";
import QRCode from "qrcode";
import * as x509 from "@peculiar/x509";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "..", "client", "dist");

/* ------------------------------------------------------------- argumentos */

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const PORT = Number(arg("port", 4180));
const LOCAL_PORT = Number(arg("local-port", PORT + 1));
const SETUP_PORT = Number(arg("setup-port", PORT + 2));
const USE_HTTPS = !flag("http");
const STATE_DIR = resolve(arg("state-dir", join(HERE, ".state")));
const CERT_DIR = resolve(arg("cert-dir", join(HERE, ".cert")));
/** Una oferta completa (primera sincronización) puede ocupar varios MB. */
const MAX_MESSAGE_BYTES = 24 * 1024 * 1024;

/* ------------------------------------------------ código de emparejamiento */

/**
 * Código de acceso a la sala: 8 caracteres Crockford base32 (40 bits),
 * generado con el CSPRNG y PERSISTENTE (no cambia en cada arranque, para no
 * tener que reemparejar). `--new-code` lo renueva y revoca el anterior.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const normCode = (c) => String(c ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");

async function loadCode() {
  const file = join(STATE_DIR, "code.txt");
  const forced = arg("code", null);
  if (forced) return normCode(forced);
  if (!flag("new-code") && existsSync(file)) {
    const saved = normCode(await readFile(file, "utf8"));
    if (saved.length >= 8) return saved;
  }
  let code = "";
  for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  await writeFile(file, code, { mode: 0o600 });
  return code;
}

const pretty = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;

/* -------------------------------------------------------------- red */

function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out.length ? out : ["127.0.0.1"];
}

const LAN = lanAddresses();
const HOSTNAME = hostname();

/* ------------------------------------------------ certificados (CA local) */

// Certificados X.509 con @peculiar/x509 sobre la WebCrypto de Node (antes
// node-forge, que tiene vulnerabilidades sin corregir). La lectura usa el
// X509Certificate nativo de Node.
x509.cryptoProvider.set(webcrypto);
const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 };
const DAY = 86400000;

const fingerprint = (certPem) => new X509Certificate(certPem).fingerprint256;

// Admite las claves PKCS#1 («RSA PRIVATE KEY») que escribía node-forge: así
// se conserva la CA ya instalada en los dispositivos emparejados.
function importPrivateKey(pem) {
  const der = createPrivateKey(pem).export({ type: "pkcs8", format: "der" });
  return webcrypto.subtle.importKey("pkcs8", der, RSA, true, ["sign"]);
}

async function exportPrivateKey(key) {
  const der = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", key));
  return x509.PemConverter.encode(der, "PRIVATE KEY");
}

const generateKeys = () => webcrypto.subtle.generateKey(RSA, true, ["sign", "verify"]);

/**
 * CA local (10 años) + certificado del servidor firmado por ella (825 días,
 * el máximo que acepta iOS) válido para todas las IP de la LAN, localhost y
 * el nombre del equipo. Si cambia la IP, se reemite el del servidor; la CA
 * se conserva, así que el iPhone no tiene que volver a instalar nada.
 */
async function ensureCertificates() {
  await mkdir(CERT_DIR, { recursive: true, mode: 0o700 });
  const caCertFile = join(CERT_DIR, "ca.pem");
  const caKeyFile = join(CERT_DIR, "ca-key.pem");
  let caCert;
  let caKey;
  if (existsSync(caCertFile) && existsSync(caKeyFile)) {
    caCert = new x509.X509Certificate(await readFile(caCertFile, "utf8"));
    caKey = await importPrivateKey(await readFile(caKeyFile, "utf8"));
  } else {
    const keys = await generateKeys();
    // Solo ASCII en los nombres (como con la versión anterior).
    const name = new x509.Name([
      { CN: [`Plan Gestor Task - CA local de ${HOSTNAME.replace(/[^ -~]/g, "")}`] },
      { O: ["Plan Gestor Task (uso personal)"] },
    ]);
    caCert = await x509.X509CertificateGenerator.create({
      serialNumber: randomSerial(),
      subject: name,
      issuer: name,
      notBefore: new Date(Date.now() - DAY),
      notAfter: new Date(Date.now() + 10 * 365 * DAY),
      publicKey: keys.publicKey,
      signingKey: keys.privateKey,
      signingAlgorithm: RSA,
      extensions: [
        new x509.BasicConstraintsExtension(true, undefined, true),
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
        await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      ],
    });
    caKey = keys.privateKey;
    await writeFile(caCertFile, caCert.toString("pem"));
    await writeFile(caKeyFile, await exportPrivateKey(caKey), { mode: 0o600 });
  }

  const leafFile = join(CERT_DIR, "server.pem");
  const leafKeyFile = join(CERT_DIR, "server-key.pem");
  const metaFile = join(CERT_DIR, "server.json");
  const wanted = [...new Set([...LAN, "127.0.0.1"])].sort();
  let reuse = false;
  if (existsSync(leafFile) && existsSync(leafKeyFile) && existsSync(metaFile)) {
    try {
      const meta = JSON.parse(await readFile(metaFile, "utf8"));
      reuse = JSON.stringify(meta.ips) === JSON.stringify(wanted) && Date.parse(meta.notAfter) > Date.now() + 30 * DAY;
    } catch {
      reuse = false;
    }
  }
  if (!reuse) {
    const keys = await generateKeys();
    const notAfter = new Date(Date.now() + 825 * DAY);
    const cert = await x509.X509CertificateGenerator.create({
      serialNumber: randomSerial(),
      subject: new x509.Name([{ CN: [LAN[0]] }]),
      // El emisor se copia byte a byte del sujeto de la CA para que la cadena encaje.
      issuer: new x509.Name(caCert.subjectName.toArrayBuffer()),
      notBefore: new Date(Date.now() - DAY),
      notAfter,
      publicKey: keys.publicKey,
      signingKey: caKey,
      signingAlgorithm: RSA,
      extensions: [
        new x509.BasicConstraintsExtension(false),
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment, true),
        new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
        new x509.SubjectAlternativeNameExtension([
          ...wanted.map((ip) => ({ type: "ip", value: ip })),
          { type: "dns", value: "localhost" },
          { type: "dns", value: HOSTNAME },
          { type: "dns", value: `${HOSTNAME}.local` },
        ]),
      ],
    });
    await writeFile(leafFile, cert.toString("pem"));
    await writeFile(leafKeyFile, await exportPrivateKey(keys.privateKey), { mode: 0o600 });
    await writeFile(metaFile, JSON.stringify({ ips: wanted, notAfter: notAfter.toISOString() }));
  }

  const caPem = caCert.toString("pem");
  return {
    key: await readFile(leafKeyFile, "utf8"),
    cert: `${await readFile(leafFile, "utf8")}\n${caPem}`,
    caPem,
    caDer: Buffer.from(caCert.rawData),
    caFingerprint: fingerprint(caPem),
  };
}

function randomSerial() {
  // Positivo y de 16 bytes, como exige X.509.
  return "01" + [...Array(15)].map(() => randomInt(256).toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------ control de acceso */

const MAX_FAILED = 10;
const FAILED_WINDOW_MS = 10 * 60 * 1000;
const failed = new Map();

function isBlocked(ip) {
  const f = failed.get(ip);
  if (!f) return false;
  if (Date.now() - f.since > FAILED_WINDOW_MS) {
    failed.delete(ip);
    return false;
  }
  return f.count >= MAX_FAILED;
}

function recordFailure(ip) {
  const f = failed.get(ip);
  if (!f || Date.now() - f.since > FAILED_WINDOW_MS) failed.set(ip, { count: 1, since: Date.now() });
  else f.count++;
}

/** Comparación en tiempo constante (resúmenes de igual longitud). */
function codeMatches(candidate, code) {
  const a = createHash("sha256").update(normCode(candidate)).digest();
  const b = createHash("sha256").update(code).digest();
  return timingSafeEqual(a, b);
}

function isLoopback(req) {
  const ip = req.socket.remoteAddress ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/* ------------------------------------------------------------- HTTP */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}

async function serveStatic(req, res) {
  if (!existsSync(DIST)) return false;
  const url = new URL(req.url, "http://x");
  let requested;
  try {
    requested = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  // `normalize` colapsa `..`; después se comprueba que siga dentro de dist/.
  const candidate = resolve(DIST, `.${normalize(requested)}`);
  const inside = candidate === DIST || candidate.startsWith(DIST + sep);
  const target = inside && existsSync(candidate) && extname(candidate) ? candidate : join(DIST, "index.html");
  if (!existsSync(target)) return false;
  const body = await readFile(target);
  const name = target.split(sep).pop();
  res.writeHead(200, {
    "content-type": MIME[extname(target)] ?? "application/octet-stream",
    // HTML y Service Worker sin caché: así se detectan las versiones nuevas.
    "cache-control": extname(target) === ".html" || name === "sw.js" ? "no-cache" : "public, max-age=31536000, immutable",
    "service-worker-allowed": "/",
    ...SECURITY_HEADERS,
  });
  res.end(body);
  return true;
}

function setupPage(ctx) {
  const https = `https://${LAN[0]}:${PORT}`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Configurar el iPhone</title><style>
body{font:17px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:24px max(20px,env(safe-area-inset-left));background:#0f172a;color:#e2e8f0}
h1{font-size:22px}a.btn{display:block;text-align:center;background:#6366f1;color:#fff;padding:14px;border-radius:12px;text-decoration:none;font-weight:600;margin:12px 0}
ol li{margin:10px 0}code{background:#1e293b;padding:2px 6px;border-radius:6px;word-break:break-all}small{color:#94a3b8}
</style></head><body>
<h1>Conectar el iPhone con tu PC</h1>
<p>Solo hace falta una vez. Permite que la app del iPhone se comunique de forma segura con este PC en tu Wi-Fi.</p>
<ol>
<li>Pulsa el botón y acepta descargar el perfil.<a class="btn" href="/ca.crt">Descargar certificado del PC</a></li>
<li>Abre <b>Ajustes → General → VPN y gestión de dispositivos</b> e instala el perfil descargado.</li>
<li>Ve a <b>Ajustes → General → Información → Ajustes de confianza de certificados</b> y activa la confianza total para «Plan Gestor Task - CA local».</li>
<li>Comprueba que la huella coincide con la que muestra el PC:<br><code>${ctx.caFingerprint}</code></li>
<li>En la app del iPhone: <b>Sincronización → Emparejar con el PC</b>. Dirección: <code>${https}</code> y el código que ves en la pantalla del PC.</li>
</ol>
<p><small>El código de emparejamiento NO aparece aquí a propósito: solo se muestra en la pantalla del PC.</small></p>
</body></html>`;
}

function makeHandler(ctx, role) {
  return async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/ca.crt") {
      res.writeHead(200, {
        "content-type": "application/x-x509-ca-cert",
        "content-disposition": 'attachment; filename="plan-gestor-ca.crt"',
        ...SECURITY_HEADERS,
      });
      return res.end(ctx.caDer);
    }
    if (url.pathname === "/health") return json(res, 200, { ok: true, peers: peers.size });
    if (role === "setup") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS });
      return res.end(setupPage(ctx));
    }
    // Datos de emparejamiento: solo al propio PC (loopback).
    if (url.pathname === "/pair" || url.pathname === "/qr.png") {
      if (!isLoopback(req)) return json(res, 403, { error: "Solo disponible desde este equipo" });
      if (url.pathname === "/pair") {
        return json(res, 200, {
          code: pretty(ctx.code),
          lanUrls: LAN.map((ip) => `${USE_HTTPS ? "https" : "http"}://${ip}:${PORT}`),
          localUrl: `http://localhost:${LOCAL_PORT}`,
          setupUrl: `http://${LAN[0]}:${SETUP_PORT}`,
          hostname: HOSTNAME,
          caFingerprint: ctx.caFingerprint,
        });
      }
      const text = String(url.searchParams.get("text") ?? "").slice(0, 500);
      const png = await QRCode.toBuffer(text || `http://${LAN[0]}:${SETUP_PORT}`, { type: "png", width: 480, margin: 1 });
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store", ...SECURITY_HEADERS });
      return res.end(png);
    }
    if (await serveStatic(req, res)) return;
    json(res, 404, { error: "No encontrado", hint: "Compila la app con `npm run build`." });
  };
}

/* ---------------------------------------------------------- relé */

/** deviceId -> socket. Un dispositivo reconectado sustituye a su socket anterior. */
const peers = new Map();

function presence() {
  return [...peers.values()].map((ws) => ({ deviceId: ws.deviceId, name: ws.deviceName }));
}

function broadcastPresence() {
  const payload = JSON.stringify({ type: "presence", peers: presence() });
  for (const ws of peers.values()) if (ws.readyState === ws.OPEN) ws.send(payload);
}

function attachRelay(server, ctx) {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: MAX_MESSAGE_BYTES });
  wss.on("connection", (ws, req) => {
    const ip = req.socket.remoteAddress ?? "?";
    ws.authenticated = false;
    const authTimer = setTimeout(() => !ws.authenticated && ws.close(), 10000);

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg?.type === "hello") {
        if (isBlocked(ip)) {
          ws.send(JSON.stringify({ type: "denied", reason: "rate" }));
          return ws.close();
        }
        if (!codeMatches(msg.code, ctx.code)) {
          recordFailure(ip);
          ws.send(JSON.stringify({ type: "denied" }));
          return ws.close();
        }
        failed.delete(ip);
        clearTimeout(authTimer);
        ws.authenticated = true;
        ws.deviceId = String(msg.deviceId ?? "").slice(0, 64) || `anon-${randomInt(1e9)}`;
        ws.deviceName = String(msg.name ?? "Dispositivo").slice(0, 40);
        const old = peers.get(ws.deviceId);
        if (old && old !== ws) old.close();
        peers.set(ws.deviceId, ws);
        ws.send(JSON.stringify({ type: "welcome", peers: presence() }));
        broadcastPresence();
        return;
      }
      if (!ws.authenticated) return;

      if (msg?.type === "send") {
        const target = peers.get(String(msg.to));
        const id = typeof msg.id === "string" ? msg.id.slice(0, 64) : null;
        if (!target || target.readyState !== target.OPEN) {
          return ws.send(JSON.stringify({ type: "undeliverable", id, to: msg.to }));
        }
        // El contenido va cifrado de extremo a extremo: el relé no lo mira.
        target.send(JSON.stringify({ type: "msg", from: ws.deviceId, fromName: ws.deviceName, id, payload: msg.payload }));
        ws.send(JSON.stringify({ type: "sent", id }));
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      if (ws.deviceId && peers.get(ws.deviceId) === ws) {
        peers.delete(ws.deviceId);
        broadcastPresence();
      }
    });
    ws.on("error", () => ws.close());
  });
}

/* ------------------------------------------------------------ arranque */

async function main() {
  const code = await loadCode();
  const certs = await ensureCertificates();
  const ctx = { code, ...certs };

  const main = USE_HTTPS
    ? createHttpsServer({ key: certs.key, cert: certs.cert }, makeHandler(ctx, "app"))
    : createHttpServer(makeHandler(ctx, "app"));
  attachRelay(main, ctx);

  // Para el navegador del propio PC: http en loopback es contexto seguro.
  const local = createHttpServer(makeHandler(ctx, "app"));
  attachRelay(local, ctx);

  const setup = createHttpServer(makeHandler(ctx, "setup"));

  const listen = (srv, port, host) =>
    new Promise((ok, fail) => {
      srv.once("error", fail);
      srv.listen(port, host, ok);
    });

  try {
    await listen(main, PORT, "0.0.0.0");
    await listen(local, LOCAL_PORT, "127.0.0.1");
    await listen(setup, SETUP_PORT, "0.0.0.0");
  } catch (err) {
    console.error(err.code === "EADDRINUSE" ? `\n  Un puerto (${PORT}-${SETUP_PORT}) está ocupado. Usa --port <otro>.\n` : `\n  Error al arrancar: ${err.message}\n`);
    process.exit(1);
  }

  const setupUrl = `http://${LAN[0]}:${SETUP_PORT}`;
  const qr = await QRCode.toString(setupUrl, { type: "terminal", small: true });
  console.log(`
┌──────────────────────────────────────────────────────────────┐
│  Plan Gestor Task — servicio local del PC                    │
└──────────────────────────────────────────────────────────────┘

  App en este PC     : http://localhost:${LOCAL_PORT}
  Dirección iPhone   : ${LAN.map((ip) => `${USE_HTTPS ? "https" : "http"}://${ip}:${PORT}`).join("  ")}
  Código emparejar   : ${pretty(code)}
  Huella del CA      : ${certs.caFingerprint}
  ${existsSync(DIST) ? "" : "AVISO: client/dist no existe. Ejecuta `npm run build`.\n"}
  Primera vez en el iPhone: escanea para instalar el certificado del PC
${qr}
  ${setupUrl}

  La sincronización la inicias tú desde la app ("Sincronizar ahora").
  Ctrl+C para detener. El iPhone sigue funcionando sin este servicio.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
