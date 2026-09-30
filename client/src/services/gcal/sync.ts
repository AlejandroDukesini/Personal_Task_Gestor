// Motor de sincronización hábitos ⇄ Google Calendar.
//
// Principios:
//  - La app es dueña de la PROGRAMACIÓN; Google solo recibe el horario.
//    Ningún dato de Google marca un hábito como realizado.
//  - Idempotente: ids de evento deterministas + vínculos por programación. Se
//    puede ejecutar N veces (o desde dos dispositivos) sin duplicar eventos.
//  - Detección de cambios a tres bandas: huella al último acuerdo (vínculo)
//    frente a la local y la remota. Si cambiaron ambas, es un conflicto y
//    decide el usuario: nunca se sobrescribe en silencio.
//  - Solo se tocan eventos marcados con la propiedad privada de la app.

import { api } from "@/services/api";
import type { GcalLinkRow, HabitRow, HabitScheduleRow } from "@/services/localDb";
import { addDays, wallClock, zonedToUtc } from "@/services/habits/schedule";
import { GcalError, type GcalApi } from "./client";
import {
  buildEvent,
  combinedHash,
  describeRemote,
  eventIdFor,
  isAppEvent,
  scheduleFromEvent,
  splitHash,
  summaryHash,
  timingHash,
  type GcalEvent,
} from "./payload";

type HabitWithSchedules = HabitRow & { schedules: HabitScheduleRow[] };

export interface SyncOptions {
  gcal: GcalApi;
  calendarId: string;
  scope: "all" | "selected";
  remoteChanges: "ask" | "apply";
  appName?: string;
  now?: Date;
}

export interface SyncReport {
  created: number;
  updated: number;
  deleted: number;
  adopted: number;
  remoteApplied: number;
  conflicts: number;
  remoteDeleted: number;
  unchanged: number;
  errors: string[];
}

const emptyReport = (): SyncReport => ({
  created: 0,
  updated: 0,
  deleted: 0,
  adopted: 0,
  remoteApplied: 0,
  conflicts: 0,
  remoteDeleted: 0,
  unchanged: 0,
  errors: [],
});

export const linkIdFor = (scheduleId: string) => `gcl-${scheduleId}`.slice(0, 128);

async function putLink(row: Omit<GcalLinkRow, "createdAt" | "updatedAt">): Promise<void> {
  await api.put(`/gcal/links/${encodeURIComponent(row.id)}`, row);
}

function syncedLink(s: HabitScheduleRow, calendarId: string, ev: GcalEvent, hash?: string): Omit<GcalLinkRow, "createdAt" | "updatedAt"> {
  return {
    id: linkIdFor(s.id),
    scheduleId: s.id,
    habitId: s.habitId,
    calendarId,
    eventId: ev.id,
    etag: ev.etag ?? null,
    syncedHash: hash ?? combinedHash(ev),
    remoteUpdated: ev.updated ?? null,
    syncedAt: new Date().toISOString(),
    state: "synced",
    lastError: null,
    remote: null,
    deleteMode: null,
  };
}

/** Crea el evento; si el id ya existe (reintento o evento borrado), lo restaura/actualiza. */
async function insertOrRestore(gcal: GcalApi, calendarId: string, ev: GcalEvent): Promise<GcalEvent> {
  try {
    return await gcal.insertEvent(calendarId, ev);
  } catch (e) {
    if (!(e instanceof GcalError) || e.kind !== "conflict") throw e;
    const existing = await gcal.getEvent(calendarId, ev.id);
    if (!isAppEvent(existing)) throw new GcalError("conflict", 409, "Existe en Google un evento ajeno con el mismo identificador; no se modificará.");
    return gcal.updateEvent(calendarId, ev);
  }
}

/**
 * Quita de Google las ocurrencias FUTURAS de un evento de la app. Las pasadas
 * se conservan recortando la repetición hasta ayer.
 */
export async function removeFuture(gcal: GcalApi, calendarId: string, ev: GcalEvent, now = new Date()): Promise<"deleted" | "truncated" | "kept"> {
  if (!isAppEvent(ev)) return "kept";
  const tz = ev.start?.timeZone ?? "UTC";
  const startWall = (ev.start?.dateTime ?? "").slice(0, 16);
  const startMs = /[zZ]|[+-]\d{2}:\d{2}$/.test(ev.start?.dateTime ?? "")
    ? new Date(ev.start!.dateTime!).getTime()
    : zonedToUtc(startWall.slice(0, 10), startWall.slice(11, 16) || "00:00", tz).getTime();
  if (startMs >= now.getTime()) {
    await gcal.deleteEvent(calendarId, ev.id, ev.etag);
    return "deleted";
  }
  if (!ev.recurrence?.length) return "kept"; // evento único ya pasado: es historia
  const yesterday = addDays(wallClock(now, tz).dateKey, -1);
  const until = new Date(zonedToUtc(addDays(yesterday, 1), "00:00", tz).getTime() - 1000)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const recurrence = ev.recurrence.map((r) =>
    r.startsWith("RRULE:")
      ? `RRULE:${r
          .slice(6)
          .split(";")
          .filter((p) => !/^(UNTIL|COUNT)=/i.test(p))
          .concat(`UNTIL=${until}`)
          .join(";")}`
      : r
  );
  await gcal.patchEvent(calendarId, ev.id, { recurrence }, ev.etag);
  return "truncated";
}

async function loadState() {
  const habits = await api.get<HabitWithSchedules[]>("/habits?includeArchived=true");
  const links = await api.get<GcalLinkRow[]>("/gcal/links");
  return { habits, links };
}

export async function runGcalSync(opts: SyncOptions): Promise<SyncReport> {
  const { gcal, calendarId } = opts;
  const now = opts.now ?? new Date();
  const report = emptyReport();
  const { habits, links } = await loadState();
  const remote = await gcal.listAppEvents(calendarId);
  const remoteById = new Map(remote.map((e) => [e.id, e]));
  const linkById = new Map(links.map((l) => [l.id, l]));

  const fail = async (link: Omit<GcalLinkRow, "createdAt" | "updatedAt"> | null, label: string, e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    report.errors.push(`${label}: ${msg}`);
    if (link) await putLink({ ...link, state: link.state === "pending_delete" ? "pending_delete" : "error", lastError: msg });
    if (e instanceof GcalError && e.kind === "auth") throw e; // sin token no tiene sentido seguir
  };

  // 1) Programaciones borradas cuyo evento el usuario pidió quitar de Google.
  for (const link of links.filter((l) => l.state === "pending_delete")) {
    try {
      let ev: GcalEvent | undefined = link.calendarId === calendarId ? remoteById.get(link.eventId) : undefined;
      if (!ev && link.calendarId !== calendarId) {
        try {
          ev = await gcal.getEvent(link.calendarId, link.eventId);
        } catch (e) {
          if (!(e instanceof GcalError) || (e.kind !== "not_found" && e.kind !== "gone")) throw e;
        }
      }
      if (ev && ev.status !== "cancelled") {
        const r = await removeFuture(gcal, link.calendarId, ev, now);
        if (r !== "kept") report.deleted++;
      }
      await api.delete(`/gcal/links/${encodeURIComponent(link.id)}`);
    } catch (e) {
      await fail(link, "Eliminar evento", e);
    }
  }

  // 2) Programaciones de los hábitos incluidos.
  const selected = habits.filter((h) => !h.archived && (opts.scope === "all" || h.gcalSync));
  for (const habit of selected) {
    for (const s of habit.schedules ?? []) {
      const link = linkById.get(linkIdFor(s.id));
      if (link?.state === "pending_delete") continue;
      try {
        await syncSchedule(opts, habit, s, link, remoteById.get(link?.eventId ?? eventIdFor(s.id)), report, now);
      } catch (e) {
        await fail(link ?? { ...syncedLink(s, calendarId, { id: eventIdFor(s.id) }), syncedHash: null, state: "error" }, habit.name, e);
      }
    }
  }
  return report;
}

async function syncSchedule(
  opts: SyncOptions,
  habit: HabitRow,
  s: HabitScheduleRow,
  link: GcalLinkRow | undefined,
  remote: GcalEvent | undefined,
  report: SyncReport,
  now: Date
): Promise<void> {
  const { gcal, calendarId } = opts;
  const desired = buildEvent(s, habit, opts.appName);
  const sameCalendar = !!link && link.calendarId === calendarId;

  // Sin ocurrencias (desactivada antes de empezar, o ya terminada sin ninguna).
  if (!desired) {
    if (remote && remote.status !== "cancelled" && isAppEvent(remote)) {
      if ((await removeFuture(gcal, calendarId, remote, now)) !== "kept") report.deleted++;
    }
    if (link) await api.delete(`/gcal/links/${encodeURIComponent(link.id)}`);
    return;
  }

  const alive = !!remote && remote.status !== "cancelled";
  if (!alive) {
    // Existía, estaba sincronizado y ya no: lo borró el usuario en Google.
    if (remote && sameCalendar && link!.syncedHash) {
      if (link!.state !== "remote_deleted") {
        await putLink({ ...link!, state: "remote_deleted", lastError: null, remote: describeRemote(remote) });
      }
      report.remoteDeleted++;
      return;
    }
    const res = await insertOrRestore(gcal, calendarId, desired);
    await putLink(syncedLink(s, calendarId, res, combinedHash(desired)));
    report.created++;
    return;
  }
  if (!isAppEvent(remote!)) throw new GcalError("conflict", 409, "El evento vinculado no pertenece a la app; no se modificará.");

  const localT = timingHash(desired);
  const localS = summaryHash(desired);
  const remoteT = timingHash(remote!);
  const remoteS = summaryHash(remote!);
  const saved = splitHash(sameCalendar ? link!.syncedHash : null);

  // Sin acuerdo previo (vínculo perdido o creado desde otro dispositivo): se adopta.
  if (!saved.timing) {
    if (localT === remoteT && localS === remoteS) {
      await putLink(syncedLink(s, calendarId, remote!, combinedHash(desired)));
      report.adopted++;
    } else {
      const res = await gcal.updateEvent(calendarId, desired, remote!.etag);
      await putLink(syncedLink(s, calendarId, res, combinedHash(desired)));
      report.updated++;
    }
    return;
  }

  const localChanged = localT !== saved.timing;
  const remoteChanged = remoteT !== saved.timing;

  if (!localChanged && !remoteChanged) {
    if (localS !== saved.summary) {
      // Se renombró el hábito: el título viaja a Google.
      const res = await gcal.updateEvent(calendarId, desired, remote!.etag);
      await putLink(syncedLink(s, calendarId, res, combinedHash(desired)));
      report.updated++;
    } else if (remoteS !== saved.summary) {
      // Se renombró en Google: se respeta allí (no renombra el hábito).
      await putLink({ ...syncedLink(s, calendarId, remote!), syncedHash: `${saved.timing}.${remoteS}` });
      report.unchanged++;
    } else if (link!.state !== "synced" || link!.etag !== (remote!.etag ?? null)) {
      await putLink({ ...syncedLink(s, calendarId, remote!), syncedHash: link!.syncedHash });
      report.unchanged++;
    } else {
      report.unchanged++;
    }
    return;
  }

  if (localChanged && !remoteChanged) {
    try {
      const res = await gcal.updateEvent(calendarId, desired, remote!.etag);
      await putLink(syncedLink(s, calendarId, res, combinedHash(desired)));
      report.updated++;
    } catch (e) {
      if (e instanceof GcalError && e.kind === "precondition") {
        await putLink({ ...link!, state: "conflict", lastError: e.message, remote: describeRemote(remote!) });
        report.conflicts++;
        return;
      }
      throw e;
    }
    return;
  }

  if (!localChanged && remoteChanged && opts.remoteChanges === "apply") {
    const parsed = scheduleFromEvent(remote!, s);
    if (parsed.ok) {
      await applyRemote(opts, habit, s, remote!, parsed.schedule);
      report.remoteApplied++;
      return;
    }
    await putLink({ ...link!, state: "remote_changed", lastError: parsed.reason, remote: describeRemote(remote!) });
    report.conflicts++;
    return;
  }

  // Cambio solo remoto en modo "preguntar", o cambios en ambos lados.
  await putLink({
    ...link!,
    state: localChanged ? "conflict" : "remote_changed",
    lastError: null,
    remote: describeRemote(remote!),
  });
  report.conflicts++;
}

/** Aplica a la programación el horario de Google y deja ambos lados alineados. */
async function applyRemote(
  opts: SyncOptions,
  habit: HabitRow,
  s: HabitScheduleRow,
  remote: GcalEvent,
  schedule: import("@/services/habits/schedule").ScheduleInput
): Promise<void> {
  const updated = await api.put<HabitScheduleRow>(`/habit-schedules/${encodeURIComponent(s.id)}/from-remote`, schedule);
  const desired = buildEvent(updated, habit, opts.appName);
  if (desired && timingHash(desired) !== timingHash(remote)) {
    // Misma serie expresada distinto (p. ej. inicio): se normaliza en Google.
    const res = await opts.gcal.updateEvent(opts.calendarId, desired, remote.etag);
    await putLink(syncedLink(updated, opts.calendarId, res, combinedHash(desired)));
  } else {
    await putLink({ ...syncedLink(updated, opts.calendarId, remote), syncedHash: `${timingHash(remote)}.${summaryHash(desired ?? remote)}` });
  }
}

export type Resolution = "local" | "remote" | "recreate";

/** Decisión del usuario sobre un vínculo en conflicto o borrado en Google. */
export async function resolveLink(opts: SyncOptions, linkId: string, choice: Resolution): Promise<void> {
  const { habits, links } = await loadState();
  const link = links.find((l) => l.id === linkId);
  if (!link) throw new Error("Vínculo no encontrado");
  const habit = habits.find((h) => h.id === link.habitId);
  const s = habit?.schedules?.find((x) => x.id === link.scheduleId);
  if (!habit || !s) throw new Error("La programación vinculada ya no existe");
  const desired = buildEvent(s, habit, opts.appName);
  if (!desired) throw new Error("La programación no tiene ocurrencias que sincronizar");

  if (choice === "remote") {
    const remote = await opts.gcal.getEvent(link.calendarId, link.eventId);
    const parsed = scheduleFromEvent(remote, s);
    if (!parsed.ok) throw new Error(`No se puede aplicar la versión de Google: ${parsed.reason}`);
    await applyRemote({ ...opts, calendarId: link.calendarId }, habit, s, remote, parsed.schedule);
    return;
  }
  // "local" o "recreate": la versión de la app prevalece (decisión explícita).
  const res = await insertOrRestoreOrUpdate(opts.gcal, link.calendarId, desired);
  await putLink(syncedLink(s, link.calendarId, res, combinedHash(desired)));
}

async function insertOrRestoreOrUpdate(gcal: GcalApi, calendarId: string, ev: GcalEvent): Promise<GcalEvent> {
  try {
    const current = await gcal.getEvent(calendarId, ev.id);
    if (!isAppEvent(current)) throw new GcalError("conflict", 409, "El evento no pertenece a la app; no se modificará.");
    return await gcal.updateEvent(calendarId, ev);
  } catch (e) {
    if (e instanceof GcalError && (e.kind === "not_found" || e.kind === "gone")) return insertOrRestore(gcal, calendarId, ev);
    throw e;
  }
}
