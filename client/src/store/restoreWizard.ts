import { create } from "zustand";

/**
 * Asistente de restauración único para toda la app. Se abre desde
 * Configuración, desde Sincronización o al detectar una copia en cualquier
 * importación, con el archivo ya elegido si lo hay.
 */
export type RestoreOrigin = "settings" | "other-device" | "detected";

interface RestoreWizardState {
  open: boolean;
  file: File | null;
  origin: RestoreOrigin;
  /** Aumenta en cada apertura para reiniciar el asistente. */
  session: number;
  openWizard: (opts?: { file?: File | null; origin?: RestoreOrigin }) => void;
  close: () => void;
}

export const useRestoreWizard = create<RestoreWizardState>((set) => ({
  open: false,
  file: null,
  origin: "settings",
  session: 0,
  openWizard: (opts) => set((s) => ({ open: true, file: opts?.file ?? null, origin: opts?.origin ?? "settings", session: s.session + 1 })),
  close: () => set({ open: false, file: null }),
}));
