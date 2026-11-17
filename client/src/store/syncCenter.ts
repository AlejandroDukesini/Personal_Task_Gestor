import { create } from "zustand";
import { onDbChange } from "@/services/localDb";
import type { PairedDevice } from "@/services/manualsync/session";

// El motor de sincronización se carga bajo demanda: no hace falta para pintar
// la primera pantalla y así no engorda el arranque.
const session = () => import("@/services/manualsync/session");

/**
 * Estado compartido de la sincronización por archivo: dispositivos con los
 * que se ha sincronizado y cuántos cambios hay pendientes de enviar al más
 * reciente (para el indicador). No sincroniza nada por su cuenta.
 */
interface SyncCenterState {
  devices: PairedDevice[];
  /** Cambios locales desde la última sincronización con el dispositivo más reciente. null = nunca sincronizado. */
  pending: number | null;
  refresh: () => Promise<void>;
}

let timer: number | undefined;

export const useSyncCenter = create<SyncCenterState>((set) => ({
  devices: [],
  pending: null,

  refresh: async () => {
    const { listDevices, pendingFor } = await session();
    const devices = await listDevices();
    const latest = [...devices].filter((d) => d.lastSyncAt).sort((a, b) => (b.lastSyncAt ?? "").localeCompare(a.lastSyncAt ?? ""))[0];
    const pending = latest ? (await pendingFor(latest.deviceId)).length : null;
    set({ devices, pending });
  },
}));

/** Recalcula el indicador de pendientes tras cada cambio (con respiro). */
export function startSyncCenter(): void {
  const { refresh } = useSyncCenter.getState();
  // Tras el primer pintado, sin competir con la carga inicial.
  setTimeout(() => void refresh(), 800);
  onDbChange(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), 1500);
  });
}
