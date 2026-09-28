import type { Skin } from "@/types";

/**
 * Registro de skins. Es la única fuente de verdad de la UI de temas: la pantalla
 * de Configuración y la paleta de comandos iteran sobre este array, así que
 * añadir un skin es añadir un bloque en `skins.css` y una entrada aquí.
 */
export interface SkinMeta {
  id: Skin;
  name: string;
  description: string;
  /** El skin solo tiene cara oscura; el selector claro/oscuro se desactiva. */
  forceDark?: boolean;
  /** Muestra de color para la tarjeta de previsualización. */
  swatch: { bg: string; surface: string; accent: string; text: string };
}

export const SKINS: SkinMeta[] = [
  {
    id: "default",
    name: "Clásico",
    description: "Interfaz neutra, sans-serif y sombras suaves. Claro y oscuro.",
    swatch: { bg: "#f8fafc", surface: "#ffffff", accent: "#6366f1", text: "#0f172a" },
  },
  {
    id: "brutalist",
    name: "Neobrutalismo",
    description: "Mono, bordes gruesos, esquinas rectas y sombra sólida.",
    swatch: { bg: "#fff6e0", surface: "#ffffff", accent: "#ff4e00", text: "#111111" },
  },
  {
    id: "glass",
    name: "Glassmorfismo",
    description: "Cristal esmerilado, degradados y profundidad por desenfoque.",
    swatch: { bg: "#e8ecf8", surface: "#ffffffaa", accent: "#635bff", text: "#181b2e" },
  },
  {
    id: "terminal",
    name: "Terminal / Dev",
    description: "Consola: monoespaciada, fondo carbón y fósforo verde.",
    forceDark: true,
    swatch: { bg: "#080c0a", surface: "#0d1310", accent: "#00ff8c", text: "#d0f0da" },
  },
];

export const skinMeta = (id: Skin): SkinMeta => SKINS.find((s) => s.id === id) ?? SKINS[0];
