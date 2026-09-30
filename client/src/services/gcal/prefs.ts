// Preferencias de Google Calendar de ESTE dispositivo. Viven en localStorage y
// no se sincronizan: cada dispositivo decide si se conecta. Nunca contienen
// tokens (el token de acceso solo existe en memoria, ver auth.ts).

const KEY = "gestion-tareas:gcal";
const ACTIVITY_LIMIT = 60;

export type GcalMode = "dedicated" | "existing";

export interface GcalActivity {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface GcalPrefs {
  /** El usuario completó la conexión en este dispositivo. */
  connected: boolean;
  /** Client ID propio (opcional); por defecto, el configurado en el build. */
  clientId: string;
  /** `dedicated`: calendario "Hábitos" creado por la app (permiso mínimo). */
  mode: GcalMode;
  calendarId: string | null;
  calendarName: string | null;
  /** Sincronizar tras cada cambio y periódicamente mientras la app está abierta. */
  autoSync: boolean;
  /** `all`: todos los hábitos programados · `selected`: solo los marcados. */
  scope: "all" | "selected";
  /** Cambios de horario hechos en Google: aplicarlos solos o preguntar antes. */
  remoteChanges: "ask" | "apply";
  lastSyncAt: string | null;
  activity: GcalActivity[];
}

export const DEFAULT_PREFS: GcalPrefs = {
  connected: false,
  clientId: "",
  mode: "dedicated",
  calendarId: null,
  calendarName: null,
  autoSync: true,
  scope: "all",
  remoteChanges: "ask",
  lastSyncAt: null,
  activity: [],
};

type Listener = (p: GcalPrefs) => void;
const listeners = new Set<Listener>();

export function loadPrefs(): GcalPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(patch: Partial<GcalPrefs>): GcalPrefs {
  const next = { ...loadPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* sin almacenamiento: las preferencias viven en esta sesión */
  }
  for (const fn of listeners) fn(next);
  return next;
}

export function onPrefsChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Traza de las acciones automáticas de la sincronización. */
export function logActivity(level: GcalActivity["level"], message: string): void {
  const p = loadPrefs();
  savePrefs({ activity: [{ at: new Date().toISOString(), level, message: message.slice(0, 300) }, ...p.activity].slice(0, ACTIVITY_LIMIT) });
}

/** Client ID efectivo: el propio del usuario o el del build (VITE_GOOGLE_CLIENT_ID). */
export function effectiveClientId(p: GcalPrefs = loadPrefs()): string {
  const fromBuild = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ?? "";
  return (p.clientId || fromBuild || "").trim();
}

export const CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
