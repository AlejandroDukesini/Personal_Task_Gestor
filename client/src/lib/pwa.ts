/**
 * Integración PWA: registro del Service Worker y control del prompt de
 * instalación.
 *
 * El SW solo se registra en producción. En desarrollo interceptaría los
 * módulos que Vite sirve con HMR y acabarías depurando una versión cacheada.
 */

import { flushStorage } from "@/services/storage";
import { isDesktop } from "@/lib/desktop";

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
let updateReady = false;
let reloading = false;
const updateListeners = new Set<(ready: boolean) => void>();

function setUpdateReady(v: boolean) {
  updateReady = v;
  updateListeners.forEach((fn) => fn(v));
}

/** Avisa cuando hay una versión nueva de la app esperando a activarse. */
export function onUpdateReady(fn: (ready: boolean) => void): () => void {
  updateListeners.add(fn);
  fn(updateReady);
  return () => updateListeners.delete(fn);
}

/**
 * Activa la versión nueva: primero termina de guardar los datos pendientes
 * y después pide al Service Worker que tome el control; al hacerlo, se
 * recarga la página (una sola vez). Los datos no se tocan: viven aparte.
 */
export async function applyUpdate(): Promise<void> {
  const waiting = registration?.waiting;
  if (!waiting) return;
  await flushStorage();
  reloading = true;
  waiting.postMessage("SKIP_WAITING");
}

/** Comprueba si hay versión nueva (iOS no lo hace solo mientras la app está abierta). */
export function checkForUpdate(): void {
  registration?.update().catch(() => undefined);
}
const installListeners = new Set<(available: boolean) => void>();

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // Escritorio: los archivos ya vienen en el instalador y las versiones nuevas
  // llegan con él; un SW solo añadiría una caché que podría quedar desfasada.
  if (isDesktop) return;

  // Chrome guarda el evento para que la app decida CUÁNDO ofrecer instalar,
  // en lugar de mostrar un banner que el usuario descarta por reflejo.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    installListeners.forEach((fn) => fn(true));
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installListeners.forEach((fn) => fn(false));
  });

  if (!import.meta.env.PROD) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      // updateViaCache "none": el navegador nunca usa una copia cacheada de sw.js
      // para decidir si hay versión nueva.
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        registration = reg;
        if (reg.waiting && navigator.serviceWorker.controller) setUpdateReady(true);
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          sw?.addEventListener("statechange", () => {
            // Instalada y ya había una versión controlando: hay actualización.
            if (sw.state === "installed" && navigator.serviceWorker.controller) setUpdateReady(true);
          });
        });
        // Al volver a primer plano (lo habitual en iOS), se busca versión nueva.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") checkForUpdate();
        });
      })
      .catch(() => {
        // Falla en contexto no seguro (http por IP de red local) o si el fichero
        // no está publicado. La app sigue funcionando, solo sin modo offline.
      });
  });
}

/** true si el navegador puede ofrecer la instalación ahora mismo. */
export function canInstall(): boolean {
  return deferredPrompt !== null;
}

export function onInstallAvailability(fn: (available: boolean) => void): () => void {
  installListeners.add(fn);
  fn(canInstall());
  return () => installListeners.delete(fn);
}

/** Lanza el diálogo nativo de instalación. Devuelve true si el usuario aceptó. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const evt = deferredPrompt;
  // El evento es de un solo uso: se descarta pase lo que pase.
  deferredPrompt = null;
  installListeners.forEach((fn) => fn(false));
  try {
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    return outcome === "accepted";
  } catch {
    return false;
  }
}

/** true cuando la app corre ya instalada (standalone). */
/** iPhone/iPad con Safari: la instalación es manual (Compartir → Añadir a pantalla de inicio). */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari no implementa display-mode y expone este flag propietario.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * Las notificaciones y el Service Worker exigen contexto seguro. Servida por
 * IP de red local sobre http, la PWA no se instala ni avisa: por eso el
 * servidor de sincronización sirve https.
 */
export function isSecureContextForPwa(): boolean {
  return typeof window !== "undefined" && window.isSecureContext;
}
