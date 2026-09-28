import { create } from "zustand";

interface PaletteState {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

/** Estado mínimo compartido para que cualquier vista pueda abrir la paleta. */
export const usePalette = create<PaletteState>((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open }),
}));
