import { create } from "zustand";
import { api } from "@/services/api";
import type { Settings } from "@/types";

const DEFAULTS = {
  appName: "Productividad",
  appLogo: null as string | null,
  userName: null as string | null,
  timezone: "America/Bogota",
  language: "es",
};

interface ConfigState {
  loaded: boolean;
  appName: string;
  appLogo: string | null;
  userName: string | null;
  timezone: string;
  language: string;
  dateFormat: string;
  pinEnabled: boolean;
  pinSet: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<Settings>;
}

function fromSettings(s: Settings) {
  return {
    appName: s.appName || DEFAULTS.appName,
    appLogo: s.appLogo ?? null,
    userName: s.userName ?? null,
    timezone: s.timezone || DEFAULTS.timezone,
    language: s.language || DEFAULTS.language,
    dateFormat: s.dateFormat || "dd/MM/yyyy",
    pinEnabled: s.pinEnabled,
    pinSet: s.pinSet,
  };
}

export const useConfig = create<ConfigState>((set, get) => ({
  loaded: false,
  ...DEFAULTS,
  dateFormat: "dd/MM/yyyy",
  pinEnabled: false,
  pinSet: false,
  load: async () => {
    try {
      const s = await api.get<Settings>("/settings");
      set({ loaded: true, ...fromSettings(s) });
    } catch {
      // Sin backend: renderizar con valores por defecto y sin bloqueo por PIN.
      set({ loaded: true, pinEnabled: false });
    }
  },
  update: async (patch) => {
    const s = await api.put<Settings>("/settings", patch);
    set(fromSettings(s));
    return s;
  },
}));

// Devuelve la hora (0-23) en la zona horaria configurada.
export function hourInTimezone(timezone: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: timezone,
      }).format(new Date())
    ) % 24;
  } catch {
    return new Date().getHours();
  }
}
