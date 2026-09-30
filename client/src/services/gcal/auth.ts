// Autorización OAuth 2.0 con Google Identity Services (modelo de token para
// aplicaciones sin servidor). El token de acceso:
//  - solo vive en memoria (ni localStorage, ni IndexedDB, ni registros);
//  - caduca en ~1 h; renovarlo exige un gesto del usuario (ventana de Google);
//  - se revoca al desconectar.
// No hay client secret en el cliente: el flujo de token no lo usa.

import { GcalError } from "./client";
import type { GcalMode } from "./prefs";

const GIS_SRC = "https://accounts.google.com/gsi/client";

/** Permisos mínimos por modo: nada de correo, contactos ni perfil. */
export const SCOPES: Record<GcalMode, string[]> = {
  // Crea y gestiona SOLO el calendario "Hábitos" que crea la app.
  dedicated: ["https://www.googleapis.com/auth/calendar.app.created"],
  // Elegir uno de tus calendarios: eventos de calendarios propios + lista de calendarios.
  existing: [
    "https://www.googleapis.com/auth/calendar.events.owned",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  ],
};

interface TokenState {
  token: string;
  expiresAt: number;
  scopes: string[];
}

let state: TokenState | null = null;
let gisPromise: Promise<any> | null = null;

function loadGis(): Promise<any> {
  const w = window as any;
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google);
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => (w.google?.accounts?.oauth2 ? resolve(w.google) : reject(new Error("gis")));
    s.onerror = () => {
      gisPromise = null;
      reject(new GcalError("network", 0, "No se pudo cargar el servicio de inicio de sesión de Google. Revisa tu conexión."));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

export function hasValidToken(): boolean {
  return !!state && state.expiresAt - 60_000 > Date.now();
}

export function tokenExpiresAt(): number | null {
  return state?.expiresAt ?? null;
}

/**
 * Pide un token (abre la ventana de Google). Debe llamarse desde un gesto del
 * usuario (clic), o el navegador bloqueará la ventana emergente.
 */
export async function authorize(clientId: string, mode: GcalMode): Promise<void> {
  if (!clientId) throw new GcalError("bad_request", 0, "Falta el Client ID de Google (configuración de la integración).");
  const google = await loadGis();
  const scopes = SCOPES[mode];
  await new Promise<void>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: scopes.join(" "),
      // Solo se piden los permisos del modo elegido (autorización incremental).
      include_granted_scopes: false,
      callback: (resp: any) => {
        if (resp?.error) {
          reject(new GcalError("permission", 0, resp.error === "access_denied" ? "Autorización cancelada." : "Google no concedió la autorización."));
          return;
        }
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, ...scopes)) {
          reject(new GcalError("permission", 0, "No se concedieron todos los permisos de calendario necesarios. Marca las casillas de Google Calendar."));
          return;
        }
        state = {
          token: resp.access_token,
          expiresAt: Date.now() + Number(resp.expires_in ?? 3600) * 1000,
          scopes,
        };
        resolve();
      },
      error_callback: (err: any) => {
        reject(
          new GcalError(
            "permission",
            0,
            err?.type === "popup_closed" ? "Se cerró la ventana de Google antes de terminar." : "No se pudo abrir la ventana de autorización de Google (¿ventanas emergentes bloqueadas?)."
          )
        );
      },
    });
    client.requestAccessToken({ prompt: state ? "" : "consent" });
  });
}

/**
 * Token para la API. Sin token válido falla con `auth`: la sincronización
 * automática no abre ventanas; el usuario renueva con "Sincronizar ahora".
 */
export async function getToken(force = false): Promise<string> {
  if (force) state = null;
  if (!state || !hasValidToken()) {
    state = null;
    throw new GcalError("auth", 401, "La sesión con Google caducó. Pulsa «Sincronizar ahora» para renovarla.");
  }
  return state.token;
}

/** Olvida el token y lo revoca en Google (desconexión). */
export async function revoke(): Promise<void> {
  const token = state?.token;
  state = null;
  if (!token) return;
  try {
    const google = await loadGis();
    google.accounts.oauth2.revoke(token, () => undefined);
  } catch {
    /* sin conexión: el token caduca solo en ~1 h */
  }
}

/** Solo para pruebas. */
export function __setTokenForTests(token: string | null, ttlMs = 3600_000): void {
  state = token ? { token, expiresAt: Date.now() + ttlMs, scopes: [] } : null;
}
