// Fachada de Google Calendar para la interfaz: conexión, sincronización manual
// y automática, y resolución de conflictos. Guarda estado solo en `prefs`
// (sin tokens) y en los vínculos de la base local.

import { loadDb, onDbChange } from "@/services/localDb";
import { deviceTimeZone } from "@/services/habits/schedule";
import { authorize, hasValidToken, getToken, revoke } from "./auth";
import { GcalError, createGcalClient, type CalendarListItem, type GcalApi } from "./client";
import { effectiveClientId, loadPrefs, logActivity, savePrefs, type GcalMode } from "./prefs";
import { resolveLink, runGcalSync, type Resolution, type SyncReport } from "./sync";

export const DEDICATED_CALENDAR_NAME = "Hábitos";

let client: GcalApi | null = null;
function gcal(): GcalApi {
  client ??= createGcalClient({ getToken });
  return client;
}

/** Permite sustituir el cliente (pruebas). */
export function __setClientForTests(c: GcalApi | null): void {
  client = c;
}

export function isConnected(): boolean {
  return loadPrefs().connected;
}

export function sessionActive(): boolean {
  return hasValidToken();
}

/** Conecta (abre la ventana de Google). Llamar desde un clic del usuario. */
export async function connect(mode: GcalMode): Promise<void> {
  const prefs = loadPrefs();
  await authorize(effectiveClientId(prefs), mode);
  const modeChanged = prefs.mode !== mode;
  savePrefs({
    connected: true,
    mode,
    ...(modeChanged ? { calendarId: null, calendarName: null } : {}),
  });
  if (mode === "dedicated") await ensureDedicatedCalendar();
  logActivity("info", mode === "dedicated" ? "Conectado a Google Calendar (calendario «Hábitos»)." : "Conectado a Google Calendar.");
}

/** Renueva la sesión si caducó (requiere clic del usuario). */
export async function renewSession(): Promise<void> {
  if (hasValidToken()) return;
  const p = loadPrefs();
  await authorize(effectiveClientId(p), p.mode);
}

/**
 * Desconecta este dispositivo: revoca el token y olvida el calendario elegido.
 * Los horarios, el historial y los vínculos se conservan: si vuelves a
 * conectar, se reutilizan los mismos eventos (sin duplicados).
 */
export async function disconnect(): Promise<void> {
  await revoke();
  savePrefs({ connected: false });
  logActivity("info", "Google Calendar desconectado. Los horarios e historial de la app se conservan.");
}

export async function listCalendars(): Promise<CalendarListItem[]> {
  const items = await gcal().listCalendars();
  return items.filter((c) => c.accessRole === "owner" || c.accessRole === "writer");
}

export function chooseCalendar(c: Pick<CalendarListItem, "id" | "summary">): void {
  savePrefs({ calendarId: c.id, calendarName: c.summary });
  logActivity("info", `Calendario de destino: «${c.summary}».`);
}

async function ensureDedicatedCalendar(force = false): Promise<string> {
  const p = loadPrefs();
  if (p.calendarId && !force) return p.calendarId;
  const cal = await gcal().createCalendar(DEDICATED_CALENDAR_NAME, deviceTimeZone());
  savePrefs({ calendarId: cal.id, calendarName: DEDICATED_CALENDAR_NAME });
  logActivity("info", "Se creó el calendario «Hábitos» en tu cuenta de Google.");
  return cal.id;
}

let running: Promise<SyncReport> | null = null;

/**
 * Sincroniza. `interactive` permite abrir la ventana de Google si la sesión
 * caducó (solo desde un clic). Nunca hay dos sincronizaciones a la vez.
 */
export function syncNow(interactive = false): Promise<SyncReport> {
  if (running) return running;
  running = (async () => {
    const p = loadPrefs();
    if (!p.connected) throw new GcalError("auth", 0, "Google Calendar no está conectado.");
    if (!hasValidToken()) {
      if (!interactive) throw new GcalError("auth", 401, "La sesión con Google caducó. Pulsa «Sincronizar ahora» para renovarla.");
      await authorize(effectiveClientId(p), p.mode);
    }
    let calendarId = p.mode === "dedicated" ? await ensureDedicatedCalendar() : p.calendarId;
    if (!calendarId) throw new GcalError("bad_request", 0, "Elige el calendario de destino antes de sincronizar.");
    const opts = () => ({
      gcal: gcal(),
      calendarId: calendarId!,
      scope: p.scope,
      remoteChanges: p.remoteChanges,
      appName: loadDb().settings.appName,
    });
    let report: SyncReport;
    try {
      report = await runGcalSync(opts());
    } catch (e) {
      // El calendario dedicado se borró en Google: se crea otro y se reintenta.
      if (p.mode === "dedicated" && e instanceof GcalError && (e.kind === "not_found" || e.kind === "gone")) {
        calendarId = await ensureDedicatedCalendar(true);
        report = await runGcalSync(opts());
      } else throw e;
    }
    savePrefs({ lastSyncAt: new Date().toISOString() });
    logActivity(report.errors.length ? "warn" : "info", summarize(report));
    for (const err of report.errors.slice(0, 5)) logActivity("error", err);
    return report;
  })();
  running
    .catch((e) => logActivity("error", e instanceof Error ? e.message : String(e)))
    .finally(() => {
      running = null;
    });
  return running;
}

export async function resolve(linkId: string, choice: Resolution): Promise<void> {
  const p = loadPrefs();
  if (!hasValidToken()) await authorize(effectiveClientId(p), p.mode);
  await resolveLink(
    { gcal: gcal(), calendarId: p.calendarId ?? "", scope: p.scope, remoteChanges: p.remoteChanges, appName: loadDb().settings.appName },
    linkId,
    choice
  );
  logActivity("info", choice === "remote" ? "Se aplicó el horario de Google Calendar." : "Se mantuvo el horario de la app en Google Calendar.");
}

export function summarize(r: SyncReport): string {
  const parts = [
    r.created && `${r.created} creado(s)`,
    r.updated && `${r.updated} actualizado(s)`,
    r.deleted && `${r.deleted} retirado(s)`,
    r.adopted && `${r.adopted} vinculado(s)`,
    r.remoteApplied && `${r.remoteApplied} cambio(s) de Google aplicado(s)`,
    r.conflicts && `${r.conflicts} pendiente(s) de revisar`,
    r.remoteDeleted && `${r.remoteDeleted} borrado(s) en Google`,
  ].filter(Boolean);
  return parts.length ? `Sincronización: ${parts.join(", ")}.` : "Sincronización: todo al día.";
}

/* ------------------------------------------------ sincronización automática */

const DEBOUNCE_MS = 4000;
const PERIOD_MS = 10 * 60 * 1000;

/**
 * Tras cada cambio local (y cada 10 min) sincroniza si hay sesión válida y la
 * sincronización automática está activa. Sin sesión no abre ventanas: la
 * integración queda en "requiere renovar" hasta el siguiente clic.
 */
export function startAutoSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const trigger = () => {
    const p = loadPrefs();
    if (!p.connected || !p.autoSync || !hasValidToken()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      syncNow(false).catch(() => undefined);
    }, DEBOUNCE_MS);
  };
  const off = onDbChange((origin) => {
    // Los propios vínculos que escribe la sincronización también disparan el
    // evento; el debounce + el bloqueo de `running` evita bucles.
    if (origin === "local" && !running) trigger();
  });
  const interval = setInterval(trigger, PERIOD_MS);
  return () => {
    off();
    clearInterval(interval);
    if (timer) clearTimeout(timer);
  };
}
