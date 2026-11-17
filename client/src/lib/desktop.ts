/**
 * Integración con las apps nativas (Tauri): Windows y Android.
 *
 * La app es la misma que en el navegador: aquí solo se ajusta lo que cambia
 * al ejecutarse dentro de la ventana nativa.
 */

/** true dentro de la app nativa, Windows o Android (Tauri 2 inyecta este objeto). */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** true dentro de la app de Android (APK). */
export const isAndroid = isTauri && typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/** true dentro de la app de escritorio (Windows). */
export const isDesktop = isTauri && !isAndroid;

/** Solo estos esquemas salen al navegador del sistema (coincide con capabilities/default.json). */
const EXTERNAL = /^(https?:|mailto:)/i;

/**
 * En la app nativa, los enlaces externos (`target="_blank"` o a otro origen)
 * se abren en el navegador predeterminado y no dentro de la ventana de la
 * app, que no tiene barra de direcciones ni forma de volver atrás.
 */
export function setupDesktop(): void {
  if (!isTauri) return;
  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin === location.origin || !EXTERNAL.test(url.protocol)) return;
      e.preventDefault();
      void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url.href));
    },
    true
  );
}
