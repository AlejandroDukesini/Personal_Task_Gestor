// Rutas locales del módulo de hábitos ampliado: contador de realizaciones,
// programación horaria, ocurrencias para el calendario, vínculos con Google
// Calendar e importación de capturas.

import { z } from "zod";
import {
  ApiError,
  loadDb,
  localDateKey,
  mutate,
  newId,
  nowIso,
  tombstone,
  type Db,
  type GcalLinkRow,
  type HabitImportRow,
  type HabitLogRow,
  type HabitLogSource,
  type HabitRow,
  type HabitScheduleRow,
} from "@/services/localDb";
import { created, find, noContent, ok, parse, type Route } from "@/services/routeKit";
import { appendTrail, habitStats, logDateOf, logTarget, nextCount, progressOf } from "./progress";
import {
  addDays,
  expandSchedule,
  lastActiveDay,
  normalizeSchedule,
  occursOn,
  scheduleInputSchema,
  timingChanged,
  wallClock,
  withStatus,
  type ScheduleInput,
} from "./schedule";
import { normalizeText, stableHash } from "./hash";

/* ---------------------------------------------------------- realizaciones */

export interface LogChange {
  count?: number;
  delta?: number;
  note?: string;
}

/**
 * Único punto que modifica el contador de un día. Guarda la meta vigente en
 * el registro (la historia no cambia si luego cambia la meta), deja traza del
 * origen y, si el contador llega a 0, borra el registro con lápida.
 */
export function applyLogChange(
  db: Db,
  habit: HabitRow,
  date: string | Date,
  change: LogChange,
  source: HabitLogSource = "manual",
  ref?: string
): HabitLogRow | null {
  const dayStart = logDateOf(date);
  const id = `hl-${habit.id}-${dayStart.slice(0, 10)}`.slice(0, 128);
  // Puede haber registros antiguos del mismo día con otro id: se toma el mayor.
  const sameDay = db.habitLogs.filter((l) => l.habitId === habit.id && l.date === dayStart);
  const existing = sameDay.sort((a, b) => b.count - a.count)[0];
  const current = existing?.count ?? 0;
  const value = nextCount(current, change);
  const op = change.count !== undefined ? "set" : (change.delta ?? 1) < 0 ? "dec" : "inc";
  const ts = nowIso();

  if (value === 0) {
    for (const l of sameDay) tombstone(db, "habitLogs", l.id);
    db.habitLogs = db.habitLogs.filter((l) => !(l.habitId === habit.id && l.date === dayStart));
    return null;
  }

  // La meta del día: la que ya tenía registrada; si es hoy o no tenía, la vigente.
  const isToday = localDateKey(new Date(dayStart)) === localDateKey();
  const target = !existing || isToday || existing.target === undefined ? Math.max(1, habit.dailyTarget) : existing.target;

  if (existing) {
    // Duplicados del mismo día se unifican en el registro que se conserva.
    for (const l of sameDay) {
      if (l !== existing) {
        tombstone(db, "habitLogs", l.id);
        db.habitLogs = db.habitLogs.filter((x) => x !== l);
      }
    }
    existing.count = value;
    existing.target = target;
    if (change.note !== undefined) existing.note = change.note;
    existing.trail = appendTrail(existing.trail, { at: ts, op, value, source, ...(ref ? { ref } : {}) });
    existing.updatedAt = ts;
    return existing;
  }

  const row: HabitLogRow = {
    // Id determinista por (hábito, día): el PC y el móvil producen la misma fila.
    id,
    habitId: habit.id,
    date: dayStart,
    count: value,
    note: change.note ?? null,
    target,
    trail: [{ at: ts, op, value, source, ...(ref ? { ref } : {}) }],
    createdAt: ts,
    updatedAt: ts,
  };
  // Si el id quedó con lápida (se desmarcó antes), la nueva marca la supera.
  db.habitLogs = db.habitLogs.filter((l) => l.id !== row.id);
  db.habitLogs.push(row);
  return row;
}

export const logChangeSchema = z.object({
  date: z.string().min(1),
  count: z.number().int().min(0).optional(),
  delta: z.number().int().min(-1000).max(1000).optional(),
  note: z.string().max(500).optional(),
  source: z.enum(["manual", "calendar", "import", "dashboard"]).optional(),
});

/* ---------------------------------------------------------- programación */

function todayIn(tz: string): string {
  return wallClock(new Date(), tz).dateKey;
}

function newScheduleRow(db: Db, habitId: string, input: ScheduleInput): HabitScheduleRow {
  const ts = nowIso();
  const row: HabitScheduleRow = {
    id: newId(),
    habitId,
    ...normalizeSchedule(input),
    inactiveFrom: null,
    createdAt: ts,
    updatedAt: ts,
  };
  if (!row.active) row.inactiveFrom = todayIn(row.timezone);
  db.habitSchedules.push(row);
  return row;
}

/**
 * Actualiza una programación. Si cambia el HORARIO de una regla que ya generó
 * ocurrencias pasadas, se parte en dos (como "este y los siguientes" en Google
 * Calendar): la regla antigua termina ayer y una nueva empieza hoy. Así el
 * calendario de días pasados sigue mostrando lo que estaba previsto entonces.
 */
export function updateSchedule(
  db: Db,
  row: HabitScheduleRow,
  input: ScheduleInput,
  applyFrom: "today" | "all" = "today"
): HabitScheduleRow {
  const next = normalizeSchedule({ ...input, timezone: input.timezone ?? row.timezone });
  const today = todayIn(next.timezone);
  const last = lastActiveDay(row);
  const hasPast = row.startDate < today && (!last || last >= addDays(today, -1));
  const split =
    applyFrom === "today" && row.kind === "recurring" && next.kind === "recurring" && hasPast && timingChanged(row, next);
  const ts = nowIso();

  if (split) {
    row.endDate = addDays(today, -1);
    row.updatedAt = ts;
    const fresh: HabitScheduleRow = {
      ...row,
      ...next,
      id: newId(),
      startDate: next.startDate > today ? next.startDate : today,
      inactiveFrom: null,
      createdAt: ts,
      updatedAt: ts,
    };
    if (!fresh.active) fresh.inactiveFrom = today;
    db.habitSchedules.push(fresh);
    return fresh;
  }

  const wasActive = row.active;
  Object.assign(row, next);
  if (wasActive && !row.active) row.inactiveFrom = today;
  if (row.active) row.inactiveFrom = null;
  row.updatedAt = ts;
  return row;
}

/**
 * Borra una programación. El historial del hábito no se toca. Si estaba
 * vinculada a Google Calendar: `keep` deja el evento remoto como está y
 * `future` encarga a la sincronización quitar las ocurrencias futuras (solo
 * del evento creado por la app).
 */
export function deleteSchedule(db: Db, id: string, remote: "keep" | "future"): void {
  db.habitSchedules = db.habitSchedules.filter((s) => s.id !== id);
  tombstone(db, "habitSchedules", id);
  for (const link of db.gcalLinks.filter((l) => l.scheduleId === id)) {
    if (remote === "future") {
      link.state = "pending_delete";
      link.deleteMode = "future";
      link.updatedAt = nowIso();
    } else {
      db.gcalLinks = db.gcalLinks.filter((l) => l !== link);
      tombstone(db, "gcalLinks", link.id);
    }
  }
}

const remoteMode = (q: URLSearchParams): "keep" | "future" => (q.get("remote") === "future" ? "future" : "keep");

/* ------------------------------------------------------------- serializado */

export function serializeHabit(db: Db, habit: HabitRow) {
  const logs = db.habitLogs
    .filter((l) => l.habitId === habit.id)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 60);
  const stats = habitStats(habit, db.habitLogs);
  return {
    ...habit,
    unit: habit.unit ?? null,
    showInCalendar: habit.showInCalendar ?? true,
    gcalSync: habit.gcalSync ?? false,
    category: db.categories.find((c) => c.id === habit.categoryId) ?? null,
    logs,
    stats,
    schedules: db.habitSchedules
      .filter((s) => s.habitId === habit.id)
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.createdAt.localeCompare(b.createdAt)),
  };
}

/* --------------------------------------------------------------- imports */

const importItemSchema = z.object({
  title: z.string().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  habitId: z.string().max(128).nullable().optional(),
  createHabit: z
    .object({
      name: z.string().min(1).max(120),
      color: z.string().max(16).optional(),
      dailyTarget: z.number().int().min(1).max(1000).optional(),
    })
    .nullable()
    .optional(),
  /** `scheduled`: estaba previsto · `done`: el usuario confirma que lo hizo. */
  action: z.enum(["scheduled", "done", "ignored"]),
  /** Añadir la ocurrencia como programación del hábito. */
  addSchedule: z.boolean().optional(),
  count: z.number().int().min(1).max(100).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type ImportItemInput = z.infer<typeof importItemSchema>;

/** Id determinista de un evento importado: la misma captura no duplica nada. */
export function importId(habitId: string | null, item: Pick<ImportItemInput, "title" | "date" | "startTime">): string {
  return `imp-${stableHash(`${habitId ?? ""}|${item.date}|${item.startTime ?? ""}|${normalizeText(item.title)}`)}`;
}

/** Fecha de un evento importado en la zona del dispositivo, a mediodía (evita saltos de día). */
function importDate(date: string, time: string | null | undefined): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time ?? "12:00").split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

/* ------------------------------------------------------------------ rutas */

const gcalLinkSchema = z.object({
  scheduleId: z.string().min(1).max(128),
  habitId: z.string().min(1).max(128),
  calendarId: z.string().min(1).max(300),
  eventId: z.string().min(1).max(1024),
  etag: z.string().max(200).nullable().optional(),
  syncedHash: z.string().max(200).nullable().optional(),
  remoteUpdated: z.string().max(64).nullable().optional(),
  syncedAt: z.string().max(64).nullable().optional(),
  state: z.enum(["pending", "synced", "error", "conflict", "remote_changed", "remote_deleted", "pending_delete"]),
  lastError: z.string().max(500).nullable().optional(),
  remote: z.record(z.unknown()).nullable().optional(),
  deleteMode: z.enum(["future"]).nullable().optional(),
});

export const habitRoutes: Route[] = [
  /** Ocurrencias de los hábitos programados en un rango, con su estado. */
  ["GET", "/habits/calendar", ({ query }) => {
    const db = loadDb();
    const from = new Date(query.get("from") ?? Date.now() - 7 * 86400000);
    const to = new Date(query.get("to") ?? Date.now() + 35 * 86400000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
      throw new ApiError(400, "Rango de fechas no válido");
    }
    if (to.getTime() - from.getTime() > 400 * 86400000) throw new ApiError(400, "Rango demasiado amplio (máx. 400 días)");
    const habits = db.habits.filter((h) => !h.archived && (h.showInCalendar ?? true));
    const visible = new Set(habits.map((h) => h.id));
    const occurrences = db.habitSchedules
      .filter((s) => visible.has(s.habitId))
      .flatMap((s) => expandSchedule(s, from, to));
    const withState = withStatus(occurrences, habits, db.habitLogs);
    return ok(
      withState.map((o) => {
        const h = habits.find((x) => x.id === o.habitId)!;
        return {
          ...o,
          habit: { id: h.id, name: h.name, color: h.color, icon: h.icon, unit: h.unit ?? null, dailyTarget: h.dailyTarget },
        };
      })
    );
  }],

  /** Progreso de un día concreto (por defecto hoy). */
  ["GET", "/habits/:id/progress", ({ params, query }) => {
    const db = loadDb();
    const habit = find(db.habits, params.id, "Hábito");
    const date = query.get("date") ?? new Date().toISOString();
    const dayStart = logDateOf(date);
    const log = db.habitLogs
      .filter((l) => l.habitId === habit.id && l.date === dayStart)
      .sort((a, b) => b.count - a.count)[0];
    const key = localDateKey(new Date(dayStart));
    return ok({
      ...(log ? progressOf(log.count, logTarget(log, habit), key) : progressOf(0, habit.dailyTarget, key)),
      trail: log?.trail ?? [],
    });
  }],

  // Programaciones
  ["GET", "/habits/:id/schedules", ({ params }) => {
    const db = loadDb();
    find(db.habits, params.id, "Hábito");
    return ok(db.habitSchedules.filter((s) => s.habitId === params.id));
  }],
  ["POST", "/habits/:id/schedules", ({ params, body }) => {
    const input = parse(scheduleInputSchema, body);
    return created(
      mutate((db) => {
        find(db.habits, params.id, "Hábito");
        return newScheduleRow(db, params.id, input);
      })
    );
  }],
  /**
   * Sustituye el conjunto de programaciones del hábito (lo que envía el
   * formulario). Las que traen id se actualizan, las nuevas se crean y las
   * ausentes se borran. Idempotente: reenviar lo mismo no crea duplicados.
   */
  ["PUT", "/habits/:id/schedules", ({ params, body }) => {
    const data = parse(
      z.object({
        schedules: z.array(scheduleInputSchema).max(48),
        remote: z.enum(["keep", "future"]).optional(),
        applyFrom: z.enum(["today", "all"]).optional(),
      }),
      body
    );
    return ok(
      mutate((db) => {
        find(db.habits, params.id, "Hábito");
        const mine = db.habitSchedules.filter((s) => s.habitId === params.id);
        const keep = new Set(data.schedules.map((s) => s.id).filter(Boolean) as string[]);
        for (const s of mine) if (!keep.has(s.id)) deleteSchedule(db, s.id, data.remote ?? "keep");
        for (const input of data.schedules) {
          const row = input.id ? db.habitSchedules.find((s) => s.id === input.id && s.habitId === params.id) : undefined;
          if (row) {
            const before = JSON.stringify(row);
            const probe = { ...row, ...normalizeSchedule({ ...input, timezone: input.timezone ?? row.timezone }) };
            // Sin cambios reales no se toca la fila (ni su marca de tiempo).
            if (JSON.stringify({ ...probe, inactiveFrom: row.inactiveFrom }) !== before) {
              updateSchedule(db, row, input, data.applyFrom ?? "today");
            }
          } else {
            newScheduleRow(db, params.id, input);
          }
        }
        return db.habitSchedules.filter((s) => s.habitId === params.id);
      })
    );
  }],
  ["PUT", "/habit-schedules/:id", ({ params, body }) => {
    const { applyFrom, ...rest } = (body ?? {}) as Record<string, unknown>;
    const input = parse(scheduleInputSchema, rest);
    const mode = applyFrom === "all" ? "all" : "today";
    return ok(
      mutate((db) => {
        const row = find(db.habitSchedules, params.id, "Programación");
        return updateSchedule(db, row, input, mode);
      })
    );
  }],
  ["PATCH", "/habit-schedules/:id/active", ({ params, body }) => {
    const { active } = parse(z.object({ active: z.boolean() }), body);
    return ok(
      mutate((db) => {
        const row = find(db.habitSchedules, params.id, "Programación");
        if (row.active === active) return row;
        row.active = active;
        // Desactivar conserva las ocurrencias pasadas; solo corta las futuras.
        row.inactiveFrom = active ? null : todayIn(row.timezone);
        row.updatedAt = nowIso();
        return row;
      })
    );
  }],
  ["DELETE", "/habit-schedules/:id", ({ params, query }) => {
    mutate((db) => {
      find(db.habitSchedules, params.id, "Programación");
      deleteSchedule(db, params.id, remoteMode(query));
    });
    return noContent();
  }],

  // Vínculos con Google Calendar (los escribe el motor de sincronización)
  ["GET", "/gcal/links", () => ok(loadDb().gcalLinks)],
  ["PUT", "/gcal/links/:id", ({ params, body }) => {
    const data = parse(gcalLinkSchema, body);
    return ok(
      mutate((db) => {
        const ts = nowIso();
        const existing = db.gcalLinks.find((l) => l.id === params.id);
        const row: GcalLinkRow = {
          id: params.id,
          scheduleId: data.scheduleId,
          habitId: data.habitId,
          calendarId: data.calendarId,
          eventId: data.eventId,
          etag: data.etag ?? null,
          syncedHash: data.syncedHash ?? null,
          remoteUpdated: data.remoteUpdated ?? null,
          syncedAt: data.syncedAt ?? null,
          state: data.state,
          lastError: data.lastError ?? null,
          remote: data.remote ?? null,
          deleteMode: data.deleteMode ?? null,
          createdAt: existing?.createdAt ?? ts,
          updatedAt: ts,
        };
        if (existing) Object.assign(existing, row);
        else db.gcalLinks.push(row);
        return row;
      })
    );
  }],
  ["DELETE", "/gcal/links/:id", ({ params }) => {
    mutate((db) => {
      if (!db.gcalLinks.some((l) => l.id === params.id)) return;
      db.gcalLinks = db.gcalLinks.filter((l) => l.id !== params.id);
      tombstone(db, "gcalLinks", params.id);
    });
    return noContent();
  }],
  /** Aplica a una programación la versión que llegó de Google (decisión del usuario o modo automático). */
  ["PUT", "/habit-schedules/:id/from-remote", ({ params, body }) => {
    const input = parse(scheduleInputSchema, body);
    return ok(
      mutate((db) => {
        const row = find(db.habitSchedules, params.id, "Programación");
        // Se aplica a toda la regla: es la misma serie que ya existe en Google.
        return updateSchedule(db, row, input, "all");
      })
    );
  }],

  // Importación de capturas
  ["GET", "/habit-imports", ({ query }) => {
    const db = loadDb();
    const imageHash = query.get("imageHash");
    return ok(db.habitImports.filter((r) => (imageHash ? r.imageHash === imageHash : true)));
  }],
  /** Comprueba qué eventos de una captura ya se importaron (sin escribir nada). */
  ["POST", "/habit-imports/check", ({ body }) => {
    const { items } = parse(
      z.object({ items: z.array(importItemSchema.pick({ title: true, date: true, startTime: true, habitId: true })).max(200) }),
      body
    );
    const db = loadDb();
    return ok(
      items.map((it) => {
        const row = db.habitImports.find((r) => r.id === importId(it.habitId ?? null, it));
        return row ? { id: row.id, action: row.action, counted: row.counted, createdAt: row.createdAt } : null;
      })
    );
  }],
  /**
   * Aplica los eventos CONFIRMADOS por el usuario. Nada se marca como hecho
   * salvo `action: "done"`, que el usuario elige explícitamente.
   */
  ["POST", "/habit-imports/apply", ({ body }) => {
    const data = parse(
      z.object({ items: z.array(importItemSchema).max(200), imageHash: z.string().max(128).nullable().optional() }),
      body
    );
    return ok(
      mutate((db) => {
        const summary = { imported: 0, counted: 0, scheduled: 0, habitsCreated: 0, skipped: 0, duplicates: [] as string[] };
        for (const item of data.items) {
          let habit: HabitRow | undefined;
          if (item.habitId) habit = find(db.habits, item.habitId, "Hábito");
          else if (item.createHabit && item.action !== "ignored") {
            const name = item.createHabit.name.trim();
            habit = db.habits.find((h) => !h.archived && normalizeText(h.name) === normalizeText(name));
            if (!habit) {
              const ts = nowIso();
              habit = {
                id: newId(),
                name,
                description: "Creado desde una captura de calendario",
                color: item.createHabit.color ?? "#6366f1",
                icon: "Activity",
                frequency: "daily",
                daysOfWeek: null,
                dailyTarget: item.createHabit.dailyTarget ?? 1,
                weeklyTarget: null,
                startDate: ts,
                endDate: null,
                categoryId: null,
                archived: false,
                unit: null,
                showInCalendar: true,
                gcalSync: false,
                createdAt: ts,
                updatedAt: ts,
              };
              db.habits.push(habit);
              summary.habitsCreated++;
            }
          }

          const id = importId(habit?.id ?? null, item);
          const prev = db.habitImports.find((r) => r.id === id);
          const alreadyCounted = prev?.counted ?? 0;
          if (prev && (prev.action === item.action || (prev.action === "done" && item.action !== "done"))) {
            summary.skipped++;
            summary.duplicates.push(item.title);
            continue;
          }

          let counted = alreadyCounted;
          if (habit && item.action === "done" && alreadyCounted === 0) {
            counted = item.count ?? 1;
            applyLogChange(db, habit, importDate(item.date, item.startTime), { delta: counted }, "import", id);
            summary.counted += counted;
          }

          if (habit && item.addSchedule && item.startTime && item.action !== "ignored") {
            const covered = db.habitSchedules.some(
              (s) => s.habitId === habit!.id && s.startTime === item.startTime && occursOn(s, item.date)
            );
            if (!covered) {
              newScheduleRow(db, habit.id, {
                kind: "once",
                startTime: item.startTime,
                endTime: item.endTime && item.endTime > item.startTime ? item.endTime : null,
                // Las horas de una captura son las que el usuario ve en su pantalla.
                startDate: item.date,
              });
              summary.scheduled++;
            }
          }

          const ts = nowIso();
          const row: HabitImportRow = {
            id,
            habitId: habit?.id ?? null,
            title: item.title,
            date: item.date,
            startTime: item.startTime ?? null,
            endTime: item.endTime ?? null,
            action: item.action,
            counted,
            imageHash: data.imageHash ?? null,
            confidence: item.confidence ?? 0,
            createdAt: prev?.createdAt ?? ts,
            updatedAt: ts,
          };
          if (prev) Object.assign(prev, row);
          else db.habitImports.push(row);
          summary.imported++;
        }
        return summary;
      })
    );
  }],
];
