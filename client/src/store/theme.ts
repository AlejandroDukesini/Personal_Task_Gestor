import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Skin, Theme } from "@/types";
import { skinMeta } from "@/themes/registry";
import { hexToRgb, lightenHexToRgb } from "@/lib/utils";

interface ThemeState {
  /** Modo claro/oscuro/sistema. */
  theme: Theme;
  /** Lenguaje visual activo (ver `themes/skins.css`). */
  skin: Skin;
  primaryColor: string;
  /** true: manda el acento del skin. false: manda `primaryColor`. */
  useSkinAccent: boolean;
  fontScale: number;
  setTheme: (t: Theme) => void;
  setSkin: (s: Skin) => void;
  setPrimaryColor: (c: string) => void;
  useThemeAccent: () => void;
  setFontScale: (s: number) => void;
  applyDom: () => void;
}

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "system",
      skin: "default",
      primaryColor: "#6366f1",
      useSkinAccent: false,
      fontScale: 1,
      setTheme: (theme) => { set({ theme }); get().applyDom(); },
      setSkin: (skin) => { set({ skin }); get().applyDom(); },
      // Elegir un color es, implícitamente, renunciar al acento del skin.
      setPrimaryColor: (primaryColor) => { set({ primaryColor, useSkinAccent: false }); get().applyDom(); },
      useThemeAccent: () => { set({ useSkinAccent: true }); get().applyDom(); },
      setFontScale: (fontScale) => { set({ fontScale }); get().applyDom(); },
      applyDom: () => {
        const { theme, skin, primaryColor, useSkinAccent, fontScale } = get();
        const root = document.documentElement;
        const meta = skinMeta(skin);

        const isDark =
          meta.forceDark ||
          theme === "dark" ||
          (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

        root.classList.toggle("dark", isDark);
        root.dataset.skin = skin;

        if (useSkinAccent) {
          // Se retira la variable en línea para que gane el token del skin:
          // una declaración en el atributo style vence a cualquier hoja.
          root.style.removeProperty("--primary");
        } else {
          // En modo oscuro se aclara el primario para asegurar contraste AA del
          // texto/enlaces primarios sobre superficies oscuras (WCAG 4.5:1).
          root.style.setProperty(
            "--primary",
            isDark ? lightenHexToRgb(primaryColor) : hexToRgb(primaryColor)
          );
        }

        root.style.fontSize = `${16 * fontScale}px`;

        // La barra del navegador/PWA sigue el fondo real del skin activo.
        const meta_ = document.querySelector('meta[name="theme-color"]');
        if (meta_) {
          meta_.setAttribute(
            "content",
            `rgb(${getComputedStyle(root).getPropertyValue("--bg").trim().replace(/\s+/g, ",")})`
          );
        }
      },
    }),
    {
      name: "gt-theme",
      version: 2,
      // Los ajustes guardados por la versión anterior no tenían skin: se
      // adoptan con el skin clásico y su color primario como acento propio.
      migrate: (state: any, version) =>
        version >= 2 ? state : { ...state, skin: "default", useSkinAccent: false },
    }
  )
);

if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (useTheme.getState().theme === "system") useTheme.getState().applyDom();
  });
}
