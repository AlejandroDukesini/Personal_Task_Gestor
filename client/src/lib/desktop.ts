/**
 * Integración con la versión de escritorio (Tauri).
 *
 * La app es la misma que en el navegador: aquí solo se ajusta lo que cambia
 * al ejecutarse dentro de la ventana nativa de Windows.
 */

/** true dentro de la app de escritorio (Tauri 2 inyecta este objeto). */
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Solo estos esquemas salen al navegador del sistema (coincide con capabilities/default.json). */
const EXTERNAL = /^(https?:|mailto:)/i;

/**
 * En escritorio, los enlaces externos (`target="_blank"` o a otro origen) se
 * abren en el navegador predeterminado y no dentro de la ventana de la app,
 * que no tiene barra de direcciones ni forma de volver atrás.
 */
export function setupDesktop(): void {
  if (!isDesktop) return;
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
