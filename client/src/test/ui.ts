// Utilidades para probar vistas completas en happy-dom: montar con router,
// esperar a que se resuelvan las lecturas de la API local, pulsar botones y
// escribir en campos como lo haría el usuario (eventos reales de React).
// El fichero de prueba debe declarar `// @vitest-environment happy-dom`.

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { MotionGlobalConfig } from "framer-motion";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// happy-dom no completa las animaciones web: sin ellas, los paneles aparecen y
// desaparecen al instante.
MotionGlobalConfig.skipAnimations = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

/** Monta `el` dentro de un router en memoria en la URL indicada. */
export async function mount(el: ReactElement, url = "/"): Promise<HTMLElement> {
  unmount();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(MemoryRouter, { initialEntries: [url] }, el)));
  await settle();
  return document.body;
}

export function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
}

/** Deja correr promesas y temporizadores pendientes (lecturas de la API, animaciones). */
export async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i++) await act(async () => new Promise((r) => setTimeout(r, 5)));
}

export function text(): string {
  return document.body.textContent ?? "";
}

/**
 * Elemento clicable cuyo texto o aria-label contiene `label`. Si hay varios,
 * el último: los diálogos y paneles se montan al final del documento.
 */
export function byText(label: string | RegExp, selector = "button, a, [role=menuitem]"): HTMLElement {
  const all = [...document.querySelectorAll<HTMLElement>(selector)];
  const hit = [...all].reverse().find((e) => {
    const texts = [(e.textContent ?? "").trim(), e.getAttribute("aria-label") ?? ""];
    return texts.some((t) => (typeof label === "string" ? t.includes(label) : label.test(t)));
  });
  if (!hit) throw new Error(`No se encontró «${label}» entre ${all.length} elementos`);
  return hit;
}

export async function click(target: HTMLElement | string | RegExp) {
  const el = typeof target === "string" || target instanceof RegExp ? byText(target) : target;
  await act(async () => el.click());
  await settle();
}

/** Campo por su etiqueta visible (`<Field label>`) o por aria-label. */
export function field(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  for (const l of document.querySelectorAll("label")) {
    if (l.textContent?.trim().startsWith(label) && l.htmlFor) {
      const el = document.getElementById(l.htmlFor);
      if (el) return el as HTMLInputElement;
    }
  }
  const aria = document.querySelector(`[aria-label="${label}"]`);
  if (aria) return aria as HTMLInputElement;
  throw new Error(`No se encontró el campo «${label}»`);
}

/** Escribe un valor disparando el evento que escucha React. */
export async function type(target: string | HTMLElement, value: string) {
  const el = (typeof target === "string" ? field(target) : target) as HTMLInputElement;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
  await settle(2);
}
