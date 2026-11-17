/**
 * Capa sobre la Notification API del navegador.
 *
 * Dos detalles que condicionan el diseño:
 *
 * 1. En Android/Chrome, `new Notification()` lanza `TypeError` dentro de una
 *    PWA instalada: allí las notificaciones DEBEN emitirse desde el Service
 *    Worker. Por eso se intenta primero `registration.showNotification()` y
 *    solo se cae al constructor si no hay SW (escritorio, pestaña suelta).
 *
 * 2. La API solo existe en contextos seguros: https o localhost. Servida por
 *    IP de red local sobre http, `window.Notification` es `undefined`. De ahí
 *    que el servidor de sincronización ofrezca https (ver `sync/server.mjs`).
 *
 * 3. En la app de escritorio (Tauri) la WebView2 deniega la Notification API:
 *    allí se usan notificaciones nativas de Windows (plugin `notification`).
 *    En Windows no hay permiso por app que pedir en tiempo de ejecución: el
 *    usuario las controla en Configuración › Sistema › Notificaciones.
 *
 * 4. En la app de Android (APK) también se usa el plugin, pero Android 13+
 *    exige pedir el permiso POST_NOTIFICATIONS en tiempo de ejecución. Su
 *    estado se consulta al plugin y se guarda en `androidPermission`.
 */

import { isAndroid, isTauri } from "@/lib/desktop";

/** Último estado conocido del permiso en Android (se refresca al arrancar y al pedirlo). */
let androidPermission: NotificationPermission = "default";
if (isAndroid) {
  void import("@tauri-apps/plugin-notification")
    .then((m) => m.isPermissionGranted())
    .then((ok) => {
      if (ok) androidPermission = "granted";
    })
    .catch(() => {});
}

export const notificationsSupported = (): boolean =>
  isTauri || (typeof window !== "undefined" && "Notification" in window);

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (isAndroid) return androidPermission;
  if (isTauri) return "granted";
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

/** Pide permiso. Debe invocarse desde un gesto del usuario (click). */
export async function requestNotificationPermission(): Promise<boolean> {
  if (isAndroid) {
    try {
      const m = await import("@tauri-apps/plugin-notification");
      const ok = (await m.isPermissionGranted()) || (await m.requestPermission()) === "granted";
      androidPermission = ok ? "granted" : "denied";
      return ok;
    } catch {
      return false;
    }
  }
  if (isTauri) return true;
  if (!notificationsSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export interface NotifyOptions {
  body?: string;
  tag?: string;
  /** Ruta de la app a abrir al pulsar la notificación. */
  url?: string;
  silent?: boolean;
  requireInteraction?: boolean;
}

/** Muestra una notificación. Devuelve false si no se pudo (sin permiso, etc.). */
export async function notify(title: string, options: NotifyOptions = {}): Promise<boolean> {
  if (isTauri) {
    try {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      sendNotification({ title, body: options.body });
      return true;
    } catch {
      return false;
    }
  }
  if (!notificationsSupported() || Notification.permission !== "granted") return false;

  const payload: NotificationOptions & { data?: unknown } = {
    body: options.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: options.tag,
    silent: options.silent,
    requireInteraction: options.requireInteraction,
    data: { url: options.url ?? "/" },
  };

  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) {
      await reg.showNotification(title, payload);
      return true;
    }
  } catch {
    // Sin SW listo: se intenta la vía directa.
  }

  try {
    const n = new Notification(title, payload);
    n.onclick = () => {
      window.focus();
      if (options.url) window.location.assign(options.url);
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------
   Disparo diario "una sola vez"
   ------------------------------------------------------------------------- */

const FIRED_KEY = "gestion-tareas:notified";

type FiredMap = Record<string, string>; // clave -> "YYYY-MM-DD"

function readFired(): FiredMap {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) ?? "{}") as FiredMap;
  } catch {
    return {};
  }
}

export function todayKey(d = new Date()): string {
  // Fecha local, no UTC: a las 22:00 en Bogotá ya sería "mañana" en UTC y el
  // aviso de rutina se dispararía dos veces la misma noche.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * ¿Toca lanzar hoy el aviso `key`, programado a las `hhmm`?
 * Marca el disparo para que no se repita, aunque la pestaña se recargue.
 */
export function shouldFireDaily(key: string, hhmm: string, now = new Date()): boolean {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;

  const scheduled = new Date(now);
  scheduled.setHours(h, m, 0, 0);
  if (now < scheduled) return false;

  // Si la app estuvo cerrada varias horas no se lanza un aviso rancio: solo se
  // recupera dentro de una ventana de 2 h desde la hora programada.
  if (now.getTime() - scheduled.getTime() > 2 * 60 * 60 * 1000) {
    markFired(key, now);
    return false;
  }

  const fired = readFired();
  if (fired[key] === todayKey(now)) return false;

  markFired(key, now);
  return true;
}

function markFired(key: string, now: Date): void {
  const fired = readFired();
  fired[key] = todayKey(now);
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
  } catch {
    /* cuota llena: se reintentará mañana */
  }
}
