/**
 * Transporte por red local (Wi-Fi) de la sincronización manual.
 *
 * El servicio del PC (`sync/server.mjs`) solo reenvía mensajes. Todo lo que
 * viaja va CIFRADO de extremo a extremo con un secreto que comparten los dos
 * dispositivos emparejados: ni el relé ni nadie en la red puede leer ni
 * alterar los datos (AES-GCM autentica cada mensaje).
 *
 * Emparejamiento: el PC muestra un código (p. ej. `K7M2-9QXA`). El iPhone lo
 * usa para entrar en la sala y para cifrar su saludo, que incluye un secreto
 * nuevo y aleatorio. A partir de ahí, cada par usa su propio secreto.
 *
 * Sincronizar ahora (lo inicia el usuario):
 *   iniciador --sync-request--> otro
 *   iniciador <--sync-offer---- otro      (sus cambios desde la base común)
 *   [el usuario revisa el plan y los conflictos en el iniciador]
 *   iniciador --sync-answer---> otro      (lo que le falta + nueva base)
 *   iniciador <--sync-done----- otro
 */

import { newId } from "@/services/localDb";
import { open, randomSecret, seal, type Envelope } from "./crypto";
import {
  commitPlan,
  createOffer,
  currentBase,
  getSelf,
  listDevices,
  planIncoming,
  receiveAnswer,
  upsertDevice,
  addLog,
  type PairedDevice,
} from "./session";
import type { Answer, DeviceRef, Offer, Plan, Resolution, SyncSummary } from "./engine";

type Inner =
  | { t: "pair-hello"; device: DeviceRef; secret: string }
  | { t: "pair-ok"; device: DeviceRef }
  | { t: "sync-request"; rid: string; baseId: string | null; full?: boolean }
  | { t: "sync-offer"; rid: string; offer: Offer }
  | { t: "sync-answer"; rid: string; answer: Answer }
  | { t: "sync-done"; rid: string; ok: boolean; error?: string; summary?: SyncSummary }
  | { t: "sync-error"; rid: string; error: string };

export interface Peer {
  deviceId: string;
  name: string;
}

/** `https://192.168.1.50:4180` -> `wss://192.168.1.50:4180/ws` */
export function relayWsUrl(base: string): string {
  const u = new URL(base.includes("://") ? base : `https://${base}`);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws";
  u.search = "";
  u.hash = "";
  return u.toString();
}

export const normCode = (c: string) =>
  c.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");

const pairingSecret = (code: string) => `pairing:${normCode(code)}`;

/* -------------------------------------------------------------- conexión */

type Raw = { type: string; [k: string]: any };

export class Link {
  peers: Peer[] = [];
  private listeners = new Set<(m: Raw) => void>();

  private constructor(private ws: WebSocket, public self: DeviceRef) {
    ws.onmessage = (ev) => {
      let m: Raw;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.type === "presence" || m.type === "welcome") this.peers = (m.peers as Peer[]).filter((p) => p.deviceId !== self.deviceId);
      for (const fn of this.listeners) fn(m);
    };
  }

  static open(baseUrl: string, code: string, self: DeviceRef, timeoutMs = 8000): Promise<Link> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(relayWsUrl(baseUrl));
      } catch {
        reject(new Error("Dirección del PC no válida"));
        return;
      }
      const link = new Link(ws, self);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(connectionHint(baseUrl)));
      }, timeoutMs);
      ws.onopen = () => ws.send(JSON.stringify({ type: "hello", code: normCode(code), deviceId: self.deviceId, name: self.name }));
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(connectionHint(baseUrl)));
      };
      link.on((m) => {
        if (m.type === "welcome") {
          clearTimeout(timer);
          resolve(link);
        } else if (m.type === "denied") {
          clearTimeout(timer);
          reject(new Error(m.reason === "rate" ? "Demasiados intentos. Espera 10 minutos." : "El código de emparejamiento no es correcto."));
        }
      });
    });
  }

  on(fn: (m: Raw) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Envía un mensaje cifrado a un dispositivo de la sala. */
  async send(to: string, inner: Inner, secret: string): Promise<void> {
    const payload = await seal(inner, secret, "message", "secret");
    this.ws.send(JSON.stringify({ type: "send", to, id: newId(), payload }));
  }

  /** Espera el primer mensaje de `from` que cumpla `match` (descifrado con `secret`). */
  waitFor<T extends Inner>(from: string, secret: string, match: (m: Inner) => m is T, timeoutMs: number, what: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`Sin respuesta del otro dispositivo (${what}).`));
      }, timeoutMs);
      const off = this.on(async (m) => {
        if (m.type === "undeliverable") {
          clearTimeout(timer);
          off();
          reject(new Error("El otro dispositivo se ha desconectado."));
          return;
        }
        if (m.type !== "msg" || m.from !== from) return;
        try {
          const inner = await open<Inner>(m.payload as Envelope, secret);
          if (inner.t === "sync-error") {
            clearTimeout(timer);
            off();
            reject(new Error(inner.error));
          } else if (match(inner)) {
            clearTimeout(timer);
            off();
            resolve(inner);
          }
        } catch {
          /* mensaje que no es para este intercambio: se ignora */
        }
      });
    });
  }

  waitPeer(deviceId: string, timeoutMs: number): Promise<void> {
    if (this.peers.some((p) => p.deviceId === deviceId)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error("El otro dispositivo no está conectado. Abre la app en él y activa «Recibir sincronizaciones»."));
      }, timeoutMs);
      const off = this.on(() => {
        if (this.peers.some((p) => p.deviceId === deviceId)) {
          clearTimeout(timer);
          off();
          resolve();
        }
      });
    });
  }

  close() {
    this.ws.close();
  }
}

function connectionHint(url: string): string {
  const https = url.startsWith("https") || !url.includes("://");
  return https
    ? "No se pudo conectar con el PC. Comprueba que el servicio está arrancado (npm run sync), que ambos estáis en la misma Wi-Fi y que el iPhone confía en el certificado del PC (paso de configuración)."
    : "No se pudo conectar con el servicio local. ¿Está arrancado (npm run sync)?";
}

/* ---------------------------------------------------------- emparejar */

/** Desde el iPhone: empareja con el PC usando su dirección y el código que muestra. */
export async function pairWith(url: string, code: string): Promise<PairedDevice> {
  const self = await getSelf();
  const link = await Link.open(url, code, self);
  try {
    // Esperamos a que aparezca algún dispositivo que escuche (el PC).
    if (link.peers.length === 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          off();
          reject(new Error("No hay ningún dispositivo escuchando. En el PC abre la app → Sincronización y activa «Recibir sincronizaciones»."));
        }, 8000);
        const off = link.on(() => {
          if (link.peers.length) {
            clearTimeout(t);
            off();
            resolve();
          }
        });
      });
    }
    const secret = randomSecret();
    const key = pairingSecret(code);
    for (const peer of link.peers) await link.send(peer.deviceId, { t: "pair-hello", device: self, secret }, key);
    // Responde el que tiene el código (el PC), cifrando con el secreto nuevo.
    const ok = await new Promise<{ from: string; device: DeviceRef }>((resolve, reject) => {
      const t = setTimeout(() => {
        off();
        reject(new Error("El PC no confirmó el emparejamiento."));
      }, 15000);
      const off = link.on(async (m) => {
        if (m.type !== "msg") return;
        try {
          const inner = await open<Inner>(m.payload, secret);
          if (inner.t === "pair-ok") {
            clearTimeout(t);
            off();
            resolve({ from: m.from, device: inner.device });
          }
        } catch {
          /* otro mensaje */
        }
      });
    });
    return upsertDevice({
      deviceId: ok.device.deviceId,
      name: ok.device.name,
      secret,
      relayUrl: url.replace(/\/+$/, ""),
      relayToken: normCode(code),
      pairedAt: new Date().toISOString(),
    });
  } finally {
    link.close();
  }
}

/* ------------------------------------------------------ sincronizar ahora */

export interface NetworkSession {
  plan: Plan;
  peer: PairedDevice;
  /** Aplica las decisiones del usuario y cierra la sincronización en ambos. */
  finish: (resolutions: Record<string, Resolution>) => Promise<{ summary: SyncSummary; warnings: string[] }>;
  cancel: () => void;
}

/**
 * Inicia la sincronización con un dispositivo emparejado y devuelve el plan
 * para que el usuario lo revise. Nada se aplica hasta llamar a `finish`.
 */
export async function startNetworkSync(peer: PairedDevice, onStep: (s: string) => void = () => {}): Promise<NetworkSession> {
  if (!peer.secret || !peer.relayUrl || !peer.relayToken) {
    throw new Error("Este dispositivo no está emparejado por red. Usa la sincronización por archivo o vuelve a emparejar.");
  }
  const self = await getSelf();
  onStep("Conectando con el PC…");
  const link = await Link.open(peer.relayUrl, peer.relayToken, self);
  try {
    onStep(`Buscando «${peer.name}»…`);
    await link.waitPeer(peer.deviceId, 6000);

    const ask = async (full: boolean) => {
      const rid = newId();
      const base = await currentBase(peer.deviceId);
      await link.send(peer.deviceId, { t: "sync-request", rid, baseId: full ? null : base?.id ?? null, full }, peer.secret!);
      onStep("Comparando cambios…");
      const res = await link.waitFor(peer.deviceId, peer.secret!, (m): m is Extract<Inner, { t: "sync-offer" }> => m.t === "sync-offer" && m.rid === rid, 60000, "oferta");
      return { rid, plan: await planIncoming(res.offer) };
    };

    let { rid, plan } = await ask(false);
    if (plan.needFull) ({ rid, plan } = await ask(true));
    onStep("Listo para revisar");

    return {
      plan,
      peer,
      cancel: () => link.close(),
      finish: async (resolutions) => {
        try {
          onStep("Aplicando cambios…");
          const { answer, warnings } = await commitPlan(plan, resolutions, "red");
          await link.send(peer.deviceId, { t: "sync-answer", rid, answer }, peer.secret!);
          onStep(`Enviando a «${peer.name}»…`);
          const done = await link.waitFor(peer.deviceId, peer.secret!, (m): m is Extract<Inner, { t: "sync-done" }> => m.t === "sync-done" && m.rid === rid, 60000, "confirmación");
          if (!done.ok) throw new Error(`«${peer.name}» no pudo aplicar los cambios: ${done.error}`);
          return { summary: answer.summary, warnings };
        } finally {
          link.close();
        }
      },
    };
  } catch (e) {
    link.close();
    await addLog({ peer: peer.deviceId, peerName: peer.name, method: "red", status: "error", message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/* ----------------------------------------------------------- escuchar */

export interface ListenerEvents {
  onPaired?: (d: PairedDevice) => void;
  onSynced?: (peer: string, summary: SyncSummary) => void;
  onError?: (message: string) => void;
  onPeers?: (peers: Peer[]) => void;
}

/**
 * Modo "Recibir sincronizaciones" (el PC mientras está abierto): atiende
 * emparejamientos con el código y las peticiones de dispositivos autorizados.
 * Responde solo a quien tiene el secreto: un dispositivo no emparejado no
 * puede ni pedir ni leer nada.
 */
export async function listen(baseUrl: string, code: string, ev: ListenerEvents = {}): Promise<() => void> {
  const self = await getSelf();
  const link = await Link.open(baseUrl, code, self);
  ev.onPeers?.(link.peers);
  link.on(async (m) => {
    if (m.type === "presence") ev.onPeers?.(link.peers);
    if (m.type !== "msg") return;
    const from = String(m.from);
    const devices = await listDevices();
    const known = devices.find((d) => d.deviceId === from && d.secret);

    // 1) Emparejamiento: solo descifra quien conoce el código.
    if (!known) {
      try {
        const inner = await open<Inner>(m.payload, pairingSecret(code));
        if (inner.t !== "pair-hello" || inner.device.deviceId !== from || !inner.secret) return;
        const d = await upsertDevice({ deviceId: from, name: inner.device.name, secret: inner.secret, pairedAt: new Date().toISOString() });
        await link.send(from, { t: "pair-ok", device: self }, inner.secret);
        ev.onPaired?.(d);
      } catch {
        /* no es un saludo válido */
      }
      return;
    }

    // 2) Mensajes de un dispositivo autorizado.
    let inner: Inner;
    try {
      inner = await open<Inner>(m.payload, known.secret!);
    } catch {
      return;
    }
    try {
      if (inner.t === "sync-request") {
        const offer = await createOffer(from, inner.full ? { full: true } : { baseId: inner.baseId });
        await link.send(from, { t: "sync-offer", rid: inner.rid, offer }, known.secret!);
      } else if (inner.t === "sync-answer") {
        try {
          const summary = await receiveAnswer(inner.answer, "red");
          await link.send(from, { t: "sync-done", rid: inner.rid, ok: true, summary }, known.secret!);
          ev.onSynced?.(known.name, summary);
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          await link.send(from, { t: "sync-done", rid: inner.rid, ok: false, error }, known.secret!);
          await addLog({ peer: from, peerName: known.name, method: "red", status: "error", message: error });
          ev.onError?.(error);
        }
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if ("rid" in inner) await link.send(from, { t: "sync-error", rid: inner.rid, error }, known.secret!).catch(() => {});
      ev.onError?.(error);
    }
  });
  return () => link.close();
}
