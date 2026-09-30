// Cliente mínimo de Google Calendar API v3 sobre fetch. Reintenta solo lo
// recuperable (red, 429, 5xx) con espera exponencial; la creación es segura de
// reintentar porque los ids de evento son deterministas (ver payload.ts).
// Los mensajes de error nunca incluyen el token.

import { APP_TAG, type GcalEvent } from "./payload";

const BASE = "https://www.googleapis.com/calendar/v3";

export type GcalErrorKind =
  | "auth"
  | "permission"
  | "not_found"
  | "gone"
  | "conflict"
  | "precondition"
  | "rate"
  | "network"
  | "server"
  | "bad_request";

export class GcalError extends Error {
  status: number;
  kind: GcalErrorKind;
  constructor(kind: GcalErrorKind, status: number, message: string) {
    super(message);
    this.name = "GcalError";
    this.kind = kind;
    this.status = status;
  }
  get retryable(): boolean {
    return this.kind === "network" || this.kind === "rate" || this.kind === "server";
  }
}

const KIND_MESSAGE: Record<GcalErrorKind, string> = {
  auth: "La autorización de Google caducó o fue revocada. Vuelve a conectar Google Calendar.",
  permission: "Google Calendar no concedió permiso para esta operación.",
  not_found: "El evento o calendario ya no existe en Google Calendar.",
  gone: "El evento fue eliminado en Google Calendar.",
  conflict: "Ya existe un evento con ese identificador.",
  precondition: "El evento cambió en Google Calendar mientras se sincronizaba.",
  rate: "Google Calendar limitó temporalmente las peticiones. Se reintentará más tarde.",
  network: "Sin conexión con Google Calendar. Tus datos locales están a salvo.",
  server: "Google Calendar no respondió correctamente. Se reintentará más tarde.",
  bad_request: "Google Calendar rechazó los datos del evento.",
};

/** Clasifica una respuesta de error de la API sin filtrar datos sensibles. */
export function classify(status: number, body: any): GcalError {
  const reason: string = body?.error?.errors?.[0]?.reason ?? "";
  const detail = typeof body?.error?.message === "string" ? body.error.message.slice(0, 200) : "";
  let kind: GcalErrorKind;
  if (status === 401) kind = "auth";
  else if (status === 403 && /rateLimit|quota/i.test(reason)) kind = "rate";
  else if (status === 403) kind = "permission";
  else if (status === 404) kind = "not_found";
  else if (status === 410) kind = "gone";
  else if (status === 409) kind = "conflict";
  else if (status === 412) kind = "precondition";
  else if (status === 429) kind = "rate";
  else if (status >= 500) kind = "server";
  else kind = "bad_request";
  const msg = kind === "bad_request" && detail ? `${KIND_MESSAGE[kind]} (${detail})` : KIND_MESSAGE[kind];
  return new GcalError(kind, status, msg);
}

export interface CalendarListItem {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  backgroundColor?: string;
}

export interface GcalApi {
  listCalendars(): Promise<CalendarListItem[]>;
  createCalendar(summary: string, timeZone: string): Promise<CalendarListItem>;
  /** Todos los eventos creados por la app en el calendario (incluidos los borrados). */
  listAppEvents(calendarId: string): Promise<GcalEvent[]>;
  getEvent(calendarId: string, eventId: string): Promise<GcalEvent>;
  insertEvent(calendarId: string, ev: GcalEvent): Promise<GcalEvent>;
  updateEvent(calendarId: string, ev: GcalEvent, etag?: string): Promise<GcalEvent>;
  patchEvent(calendarId: string, eventId: string, patch: Partial<GcalEvent>, etag?: string): Promise<GcalEvent>;
  deleteEvent(calendarId: string, eventId: string, etag?: string): Promise<void>;
}

export interface ClientOptions {
  /** Devuelve un token válido; con `force` debe renovarlo (tras un 401). */
  getToken: (force?: boolean) => Promise<string>;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const enc = encodeURIComponent;

export function createGcalClient(opts: ClientOptions): GcalApi {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const maxRetries = opts.maxRetries ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  async function request<T>(method: string, path: string, body?: unknown, etag?: string): Promise<T> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await opts.getToken(false);
      let res: Response;
      try {
        res = await doFetch(`${BASE}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...(etag ? { "If-Match": etag } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch {
        const err = new GcalError("network", 0, KIND_MESSAGE.network);
        if (attempt < maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw err;
      }
      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }
      let payload: unknown = null;
      try {
        payload = await res.json();
      } catch {
        /* cuerpo no JSON */
      }
      const err = classify(res.status, payload);
      if (err.kind === "auth" && !refreshed) {
        refreshed = true;
        await opts.getToken(true);
        continue;
      }
      if (err.retryable && attempt < maxRetries) {
        await sleep(backoff(attempt));
        continue;
      }
      throw err;
    }
  }

  return {
    async listCalendars() {
      const out: CalendarListItem[] = [];
      let pageToken: string | undefined;
      do {
        const q = `minAccessRole=writer&maxResults=250${pageToken ? `&pageToken=${enc(pageToken)}` : ""}`;
        const page = await request<{ items?: CalendarListItem[]; nextPageToken?: string }>("GET", `/users/me/calendarList?${q}`);
        out.push(...(page.items ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return out;
    },
    createCalendar(summary, timeZone) {
      return request<CalendarListItem>("POST", "/calendars", { summary, timeZone });
    },
    async listAppEvents(calendarId) {
      const out: GcalEvent[] = [];
      let pageToken: string | undefined;
      do {
        const q =
          `privateExtendedProperty=${enc(`gtApp=${APP_TAG}`)}&showDeleted=true&maxResults=2500` +
          (pageToken ? `&pageToken=${enc(pageToken)}` : "");
        const page = await request<{ items?: GcalEvent[]; nextPageToken?: string }>(
          "GET",
          `/calendars/${enc(calendarId)}/events?${q}`
        );
        out.push(...(page.items ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return out;
    },
    getEvent(calendarId, eventId) {
      return request<GcalEvent>("GET", `/calendars/${enc(calendarId)}/events/${enc(eventId)}`);
    },
    insertEvent(calendarId, ev) {
      return request<GcalEvent>("POST", `/calendars/${enc(calendarId)}/events`, ev);
    },
    updateEvent(calendarId, ev, etag) {
      return request<GcalEvent>("PUT", `/calendars/${enc(calendarId)}/events/${enc(ev.id)}`, { ...ev, status: "confirmed" }, etag);
    },
    patchEvent(calendarId, eventId, patch, etag) {
      return request<GcalEvent>("PATCH", `/calendars/${enc(calendarId)}/events/${enc(eventId)}`, patch, etag);
    },
    async deleteEvent(calendarId, eventId, etag) {
      await request<void>("DELETE", `/calendars/${enc(calendarId)}/events/${enc(eventId)}`, undefined, etag);
    },
  };
}

function backoff(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}
