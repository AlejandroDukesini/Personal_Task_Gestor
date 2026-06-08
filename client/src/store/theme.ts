import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Theme } from "@/types";
import { hexToRgb } from "@/lib/utils";

interface ThemeState {
  theme: Theme;
  primaryColor: string;
  fontScale: number;
  setTheme: (t: Theme) => void;
  setPrimaryColor: (c: string) => void;
  setFontScale: (s: number) => void;
  applyDom: () => void;
}

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "system",
      primaryColor: "#6366f1",
      fontScale: 1,
      setTheme: (theme) => { set({ theme }); get().applyDom(); },
      setPrimaryColor: (primaryColor) => { set({ primaryColor }); get().applyDom(); },
      setFontScale: (fontScale) => { set({ fontScale }); get().applyDom(); },
      applyDom: () => {
        const { theme, primaryColor, fontScale } = get();
        const root = document.documentElement;
        const isDark =
          theme === "dark" ||
          (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
        root.classList.toggle("dark", isDark);
        root.style.setProperty("--primary", hexToRgb(primaryColor));
        root.style.fontSize = `${16 * fontScale}px`;
      },
    }),
    { name: "gt-theme" }
  )
);

if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (useTheme.getState().theme === "system") useTheme.getState().applyDom();
  });
}
