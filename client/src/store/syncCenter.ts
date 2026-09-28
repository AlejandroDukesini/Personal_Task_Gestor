import { create } from "zustand";
import { onDbChange } from "@/services/localDb";
import { kvGet, kvSet } from "@/services/storage";
import type { PairedDevice } from "@/services/manualsync/session";
import type { Peer } from "@/services/manualsync/network";
import toast from "react-hot-toast";

// El motor de sincronización se carga bajo demanda: no hace falta para pintar
// la primera pantalla y así no engorda el arranque en el iPhone.
const session = () => import("@/services/manualsync/session");
const network = () => import("@/services/manualsync/network");

/**
 * Estado compartido de la sincronización manual:
 *  - cuántos cambios hay pendientes de sincronizar (para el indicador);
 *  - el modo «Recibir sincronizaciones» del PC.
 *
 * No sincroniza nada por su cuenta: solo observa y escucha si el usuario lo
 * activa. Toda sincronización la inicia el usuario.
 */

export interface LocalService {
  code: string;
  lanUrls: string[];
  localUrl: string;
  setupUrl: string;
  hostname: string;
  caFingerprint: string;
}

interface SyncCenterState {
  devices: PairedDevice[];
  /** Cambios locales desde la última sincronización con el dispositivo más reciente. null = nunca sincronizado. */
  pending: number | null;
  /** Servicio local detectado (la app se abrió desde el propio PC). */
  service: LocalService | null;
  listening: boolean;
  listenError: string | null;
  peers: Peer[];
  refresh: () => Promise<void>;
  detectService: () => Promise<void>;
  setListening: (on: boolean) => Promise<void>;
}

let stopListening: (() => void) | null = null;
let timer: number | undefined;

export const useSyncCenter = create<SyncCenterState>((set, get) => ({
  devices: [],
  pending: null,
  service: null,
  listening: false,
  listenError: null,
  peers: [],

  refresh: async () => {
    const { listDevices, pendingFor } = await session();
    const devices = await listDevices();
    const latest = [...devices].filter((d) => d.lastSyncAt).sort((a, b) => (b.lastSyncAt ?? "").localeCompare(a.lastSyncAt ?? ""))[0];
    const pending = latest ? (await pendingFor(latest.deviceId)).length : null;
    set({ devices, pending });
  },

  /**
   * Si la app la sirve el servicio local de ESTE equipo, `/pair` responde
   * (solo a loopback): entonces este dispositivo es el PC y puede escuchar.
   */
  detectService: async () => {
    try {
      const res = await fetch("/pair", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const service = (await res.json()) as LocalService;
      if (!service.code) throw new Error();
      set({ service });
      if (await kvGet("sync:listen", true)) await get().setListening(true);
    } catch {
      set({ service: null });
    }
  },

  setListening: async (on) => {
    stopListening?.();
    stopListening = null;
    await kvSet("sync:listen", on);
    const service = get().service;
    if (!on || !service) {
      set({ listening: false, peers: [] });
      return;
    }
    try {
      const { listen } = await network();
      stopListening = await listen(location.origin, service.code, {
        onPaired: (d) => {
          toast.success(`«${d.name}» emparejado`);
          void get().refresh();
        },
        onSynced: (peer, s) => {
          toast.success(`Sincronizado con «${peer}»: ${s.received} recibidos, ${s.sent} enviados`);
          void get().refresh();
        },
        onError: (m) => toast.error(m),
        onPeers: (peers) => set({ peers }),
      });
      set({ listening: true, listenError: null });
    } catch (e) {
      set({ listening: false, listenError: e instanceof Error ? e.message : String(e) });
    }
  },
}));

/** Recalcula el indicador de pendientes tras cada cambio (con respiro). */
export function startSyncCenter(): void {
  const { refresh, detectService } = useSyncCenter.getState();
  // Tras el primer pintado, sin competir con la carga inicial.
  setTimeout(() => {
    void refresh();
    void detectService();
  }, 800);
  onDbChange(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), 1500);
  });
}
