// Router local: reimplementa en el navegador las rutas que servía Express.
// Cada handler replica la lógica del servidor (validación zod incluida) para que
// `api.ts` y las páginas no noten la diferencia.

import { z } from "zod";
import {
  ApiError,
  loadDb,
  mutate,
  newId,
  nowIso,
  startOfDay,
  type CategoryRow,
  type Db,
  type EventRow,
  type GoalRow,
  type HabitRow,
  type ReminderRow,
  type TagRow,
  type TaskRow,
} from "./localDb";

interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
}

type Result = { status: number; body?: unknown };
type Handler = (ctx: Ctx) => Result | Promise<Result>;

const ok = (body: unknown): Result => ({ status: 200, body });
const created = (body: unknown): Result => ({ status: 201, body });
const noContent = (): Result => ({ status: 204 });

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new ApiError(400, "ValidationError");
  return r.data;
}

function find<T extends { id: string }>(rows: T[], id: string): T {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new ApiError(404, "No encontrado");
  return row;
}

/** Aplica solo las claves definidas, como hace Prisma con `data`. */
function assign<T extends object>(row: T, data: Partial<T>): T {
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) (row as any)[k] = v;
  }
  return row;
}

const dateOrNull = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === "" ? null : new Date(v).toISOString()));

const toIso = (s: string) => new Date(s).toISOString();

// ---------------------------------------------------------------- categorías

const categorySchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  icon: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
});

function withCategoryCounts(db: Db, c: CategoryRow) {
  return {
    ...c,
    children: db.categories.filter((x) => x.parentId === c.id),
    _count: {
      tasks: db.tasks.filter((t) => t.categoryId === c.id).length,
      habits: db.habits.filter((h) => h.categoryId === c.id).length,
    },
  };
}

// -------------------------------------------------------------------- tareas

const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
  progress: z.number().min(0).max(100).optional(),
  startDate: dateOrNull,
  dueDate: dateOrNull,
  dueTime: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  position: z.number().optional(),
  categoryId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).optional(),
});

function serializeTask(db: Db, t: TaskRow) {
  const tagIds = db.taskTags.filter((tt) => tt.taskId === t.id).map((tt) => tt.tagId);
  return {
    ...t,
    category: db.categories.find((c) => c.id === t.categoryId) ?? null,
    tags: db.tags.filter((tag) => tagIds.includes(tag.id)),
    reminders: db.reminders.filter((r) => r.taskId === t.id),
  };
}

// ------------------------------------------------------------------ hábitos

const habitSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  color: z.string().optional(),
  icon: z.string().nullable().optional(),
  frequency: z.enum(["daily", "weekly", "monthly", "custom"]).optional(),
  daysOfWeek: z.string().nullable().optional(),
  dailyTarget: z.number().int().min(1).optional(),
  weeklyTarget: z.number().int().min(1).nullable().optional(),
  startDate: dateOrNull,
  endDate: dateOrNull,
  categoryId: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});

/** Racha actual, mejor racha y cumplimiento de los últimos 30 días. */
function addStats(db: Db, habit: HabitRow) {
  const logs = db.habitLogs
    .filter((l) => l.habitId === habit.id)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 60);

  const today = startOfDay(new Date());
  const set = new Set(logs.map((l) => startOfDay(new Date(l.date)).getTime()));

  let streak = 0;
  for (let i = 0; ; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (set.has(d.getTime())) streak++;
    else break;
  }

  let best = 0;
  let cur = 0;
  let prev: number | null = null;
  for (const t of [...set].sort((a, b) => a - b)) {
    if (prev === null || t - prev === 86400000) cur++;
    else cur = 1;
    best = Math.max(best, cur);
    prev = t;
  }

  const last30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (29 - i));
    return { date: d.toISOString(), done: set.has(d.getTime()) };
  });

  return {
    ...habit,
    category: db.categories.find((c) => c.id === habit.categoryId) ?? null,
    logs,
    stats: { streak, best, successRate: last30.filter((d) => d.done).length / 30, last30 },
  };
}

// ------------------------------------------------------------------- eventos

const eventSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  start: z.string().transform(toIso),
  end: z.string().transform(toIso),
  allDay: z.boolean().optional(),
  color: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
});

const withCategory = <T extends { categoryId: string | null }>(db: Db, row: T) => ({
  ...row,
  category: db.categories.find((c) => c.id === row.categoryId) ?? null,
});

// --------------------------------------------------------------- recordatorios

const reminderSchema = z
  .object({
    triggerAt: z.string().transform(toIso),
    minutesBefore: z.number().int().nullable().optional(),
    type: z.enum(["in_app", "banner", "sound"]).optional(),
    taskId: z.string().nullable().optional(),
    habitId: z.string().nullable().optional(),
    eventId: z.string().nullable().optional(),
  })
  .refine((d) => d.taskId || d.habitId || d.eventId, {
    message: "Debe asociarse a tarea, hábito o evento",
  });

function expandReminder(db: Db, r: ReminderRow) {
  return {
    ...r,
    task: db.tasks.find((t) => t.id === r.taskId) ?? null,
    habit: db.habits.find((h) => h.id === r.habitId) ?? null,
    event: db.events.find((e) => e.id === r.eventId) ?? null,
  };
}

// -------------------------------------------------------------------- metas

const goalSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  type: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
  targetValue: z.number().optional(),
  currentValue: z.number().optional(),
  unit: z.string().nullable().optional(),
  startDate: z.string().transform(toIso).optional(),
  endDate: z.string().transform(toIso),
  categoryId: z.string().nullable().optional(),
  completed: z.boolean().optional(),
});

// ------------------------------------------------------------------ ajustes

const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  language: z.string().optional(),
  dateFormat: z.string().optional(),
  primaryColor: z.string().optional(),
  fontScale: z.number().optional(),
  appName: z.string().min(1).max(40).optional(),
  appLogo: z.string().max(500000).nullable().optional(),
  userName: z.string().max(40).nullable().optional(),
  timezone: z.string().max(64).optional(),
});

/**
 * SHA-256 igual que el `crypto` de Node del servidor.
 * Ojo: en una app 100% estática el PIN es un bloqueo de conveniencia, no una
 * medida de seguridad — el hash vive en el mismo navegador que lo verifica.
 */
async function hashPin(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeSettings(db: Db) {
  const { pinHash, ...safe } = db.settings;
  return { ...safe, pinSet: Boolean(pinHash) };
}

// -------------------------------------------------------------------- rutas

const routes: [string, string, Handler][] = [
  ["GET", "/health", () => ok({ ok: true, version: "1.0.0" })],

  // Categorías
  ["GET", "/categories", () => {
    const db = loadDb();
    return ok(
      [...db.categories]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((c) => withCategoryCounts(db, c))
    );
  }],
  ["POST", "/categories", ({ body }) => {
    const data = parse(categorySchema, body);
    return created(
      mutate((db) => {
        const ts = nowIso();
        const row: CategoryRow = {
          id: newId(),
          name: data.name,
          color: data.color ?? "#6366f1",
          icon: data.icon ?? "Folder",
          description: data.description ?? null,
          parentId: data.parentId ?? null,
          createdAt: ts,
          updatedAt: ts,
        };
        db.categories.push(row);
        return row;
      })
    );
  }],
  ["PUT", "/categories/:id", ({ params, body }) => {
    const data = parse(categorySchema.partial(), body);
    return ok(
      mutate((db) => {
        const row = find(db.categories, params.id);
        assign(row, data as Partial<CategoryRow>);
        row.updatedAt = nowIso();
        return row;
      })
    );
  }],
  ["DELETE", "/categories/:id", ({ params }) => {
    mutate((db) => {
      find(db.categories, params.id);
      db.categories = db.categories.filter((c) => c.id !== params.id);
      // onDelete: SetNull en el esquema de Prisma.
      for (const c of db.categories) if (c.parentId === params.id) c.parentId = null;
      for (const t of db.tasks) if (t.categoryId === params.id) t.categoryId = null;
      for (const h of db.habits) if (h.categoryId === params.id) h.categoryId = null;
      for (const e of db.events) if (e.categoryId === params.id) e.categoryId = null;
      for (const g of db.goals) if (g.categoryId === params.id) g.categoryId = null;
    });
    return noContent();
  }],

  // Etiquetas
  ["GET", "/tags", () => ok([...loadDb().tags].sort((a, b) => a.name.localeCompare(b.name)))],
  ["POST", "/tags", ({ body }) => {
    const data = parse(z.object({ name: z.string().min(1), color: z.string().optional(), icon: z.string().nullable().optional() }), body);
    return created(
      mutate((db) => {
        if (db.tags.some((t) => t.name === data.name)) {
          throw new ApiError(409, "Ya existe una etiqueta con ese nombre");
        }
        const row: TagRow = {
          id: newId(),
          name: data.name,
          color: data.color ?? "#64748b",
          icon: data.icon ?? null,
        };
        db.tags.push(row);
        return row;
      })
    );
  }],
  ["PUT", "/tags/:id", ({ params, body }) => {
    const data = parse(z.object({ name: z.string().min(1), color: z.string().optional(), icon: z.string().nullable().optional() }).partial(), body);
    return ok(
      mutate((db) => {
        const row = find(db.tags, params.id);
        if (data.name && db.tags.some((t) => t.name === data.name && t.id !== params.id)) {
          throw new ApiError(409, "Ya existe una etiqueta con ese nombre");
        }
        return assign(row, data as Partial<TagRow>);
      })
    );
  }],
  ["DELETE", "/tags/:id", ({ params }) => {
    mutate((db) => {
      find(db.tags, params.id);
      db.tags = db.tags.filter((t) => t.id !== params.id);
      db.taskTags = db.taskTags.filter((tt) => tt.tagId !== params.id); // onDelete: Cascade
    });
    return noContent();
  }],

  // Tareas
  ["GET", "/tasks", ({ query }) => {
    const db = loadDb();
    const status = query.get("status");
    const categoryId = query.get("categoryId");
    const search = query.get("search")?.toLowerCase();
    const rows = db.tasks
      .filter((t) => (status ? t.status === status : true))
      .filter((t) => (categoryId ? t.categoryId === categoryId : true))
      .filter((t) =>
        search
          ? t.title.toLowerCase().includes(search) || (t.description ?? "").toLowerCase().includes(search)
          : true
      )
      .sort((a, b) => a.position - b.position || b.createdAt.localeCompare(a.createdAt));
    return ok(rows.map((t) => serializeTask(db, t)));
  }],
  ["PATCH", "/tasks/reorder", ({ body }) => {
    const items = parse(
      z.array(z.object({ id: z.string(), position: z.number(), status: z.string().optional() })),
      body
    );
    mutate((db) => {
      for (const it of items) {
        const row = find(db.tasks, it.id);
        row.position = it.position;
        if (it.status) row.status = it.status;
        row.updatedAt = nowIso();
      }
    });
    return ok({ ok: true });
  }],
  ["GET", "/tasks/:id", ({ params }) => {
    const db = loadDb();
    return ok(serializeTask(db, find(db.tasks, params.id)));
  }],
  ["POST", "/tasks", ({ body }) => {
    const { tagIds, ...data } = parse(taskSchema, body);
    return created(
      mutate((db) => {
        const ts = nowIso();
        const row: TaskRow = {
          id: newId(),
          title: data.title,
          description: data.description ?? null,
          priority: data.priority ?? "medium",
          status: data.status ?? "pending",
          progress: data.progress ?? 0,
          startDate: data.startDate ?? null,
          dueDate: data.dueDate ?? null,
          dueTime: data.dueTime ?? null,
          notes: data.notes ?? null,
          position: data.position ?? 0,
          categoryId: data.categoryId ?? null,
          completedAt: null,
          createdAt: ts,
          updatedAt: ts,
        };
        db.tasks.push(row);
        for (const tagId of tagIds ?? []) db.taskTags.push({ taskId: row.id, tagId });
        return serializeTask(db, row);
      })
    );
  }],
  ["PUT", "/tasks/:id", ({ params, body }) => {
    const { tagIds, ...data } = parse(taskSchema.partial(), body);
    return ok(
      mutate((db) => {
        const row = find(db.tasks, params.id);
        assign(row, data as Partial<TaskRow>);
        if (data.status) row.completedAt = data.status === "completed" ? nowIso() : null;
        row.updatedAt = nowIso();
        if (tagIds) {
          db.taskTags = db.taskTags.filter((tt) => tt.taskId !== params.id);
          for (const tagId of tagIds) db.taskTags.push({ taskId: params.id, tagId });
        }
        return serializeTask(db, row);
      })
    );
  }],
  ["DELETE", "/tasks/:id", ({ params }) => {
    mutate((db) => {
      find(db.tasks, params.id);
      db.tasks = db.tasks.filter((t) => t.id !== params.id);
      db.taskTags = db.taskTags.filter((tt) => tt.taskId !== params.id); // onDelete: Cascade
      db.reminders = db.reminders.filter((r) => r.taskId !== params.id);
    });
    return noContent();
  }],

  // Hábitos
  ["GET", "/habits", ({ query }) => {
    const db = loadDb();
    const rows = db.habits
      .filter((h) => (query.get("includeArchived") === "true" ? true : !h.archived))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return ok(rows.map((h) => addStats(db, h)));
  }],
  ["POST", "/habits", ({ body }) => {
    const data = parse(habitSchema, body);
    return created(
      mutate((db) => {
        const ts = nowIso();
        const row: HabitRow = {
          id: newId(),
          name: data.name,
          description: data.description ?? null,
          color: data.color ?? "#10b981",
          icon: data.icon ?? "Activity",
          frequency: data.frequency ?? "daily",
          daysOfWeek: data.daysOfWeek ?? null,
          dailyTarget: data.dailyTarget ?? 1,
          weeklyTarget: data.weeklyTarget ?? null,
          startDate: data.startDate ?? ts,
          endDate: data.endDate ?? null,
          categoryId: data.categoryId ?? null,
          archived: data.archived ?? false,
          createdAt: ts,
          updatedAt: ts,
        };
        db.habits.push(row);
        return addStats(db, row);
      })
    );
  }],
  ["PUT", "/habits/:id", ({ params, body }) => {
    const data = parse(habitSchema.partial(), body);
    return ok(
      mutate((db) => {
        const row = find(db.habits, params.id);
        assign(row, data as Partial<HabitRow>);
        row.updatedAt = nowIso();
        return addStats(db, row);
      })
    );
  }],
  ["DELETE", "/habits/:id", ({ params }) => {
    mutate((db) => {
      find(db.habits, params.id);
      db.habits = db.habits.filter((h) => h.id !== params.id);
      db.habitLogs = db.habitLogs.filter((l) => l.habitId !== params.id); // onDelete: Cascade
      db.reminders = db.reminders.filter((r) => r.habitId !== params.id);
    });
    return noContent();
  }],
  ["POST", "/habits/:id/logs", ({ params, body }) => {
    const { date, count, note } = parse(
      z.object({ date: z.string(), count: z.number().optional(), note: z.string().optional() }),
      body
    );
    const dayStart = startOfDay(new Date(date)).toISOString();
    return mutate((db) => {
      find(db.habits, params.id);
      const existing = db.habitLogs.find((l) => l.habitId === params.id && l.date === dayStart);
      if (existing) {
        existing.count = count ?? existing.count + 1;
        existing.note = note ?? existing.note;
        return ok(existing);
      }
      const row = {
        id: newId(),
        habitId: params.id,
        date: dayStart,
        count: count ?? 1,
        note: note ?? null,
        createdAt: nowIso(),
      };
      db.habitLogs.push(row);
      return created(row);
    });
  }],
  ["DELETE", "/habits/:id/logs", ({ params, query }) => {
    const dayStart = startOfDay(new Date(String(query.get("date")))).toISOString();
    mutate((db) => {
      db.habitLogs = db.habitLogs.filter((l) => !(l.habitId === params.id && l.date === dayStart));
    });
    return noContent();
  }],

  // Eventos
  ["GET", "/events", ({ query }) => {
    const db = loadDb();
    const from = query.get("from");
    const to = query.get("to");
    const rows = db.events
      .filter((e) => (from ? new Date(e.start) >= new Date(from) : true))
      .filter((e) => (to ? new Date(e.end) <= new Date(to) : true))
      .sort((a, b) => a.start.localeCompare(b.start));
    return ok(rows.map((e) => withCategory(db, e)));
  }],
  ["POST", "/events", ({ body }) => {
    const data = parse(eventSchema, body);
    return created(
      mutate((db) => {
        const ts = nowIso();
        const row: EventRow = {
          id: newId(),
          title: data.title,
          description: data.description ?? null,
          start: data.start,
          end: data.end,
          allDay: data.allDay ?? false,
          color: data.color ?? null,
          location: data.location ?? null,
          categoryId: data.categoryId ?? null,
          createdAt: ts,
          updatedAt: ts,
        };
        db.events.push(row);
        return withCategory(db, row);
      })
    );
  }],
  ["PUT", "/events/:id", ({ params, body }) => {
    const data = parse(eventSchema.partial(), body);
    return ok(
      mutate((db) => {
        const row = find(db.events, params.id);
        assign(row, data as Partial<EventRow>);
        row.updatedAt = nowIso();
        return withCategory(db, row);
      })
    );
  }],
  ["DELETE", "/events/:id", ({ params }) => {
    mutate((db) => {
      find(db.events, params.id);
      db.events = db.events.filter((e) => e.id !== params.id);
      db.reminders = db.reminders.filter((r) => r.eventId !== params.id); // onDelete: Cascade
    });
    return noContent();
  }],

  // Recordatorios
  ["GET", "/reminders/pending", () => {
    const db = loadDb();
    const now = Date.now();
    return ok(
      db.reminders
        .filter((r) => !r.delivered && new Date(r.triggerAt).getTime() <= now)
        .map((r) => expandReminder(db, r))
    );
  }],
  ["GET", "/reminders", () => {
    const db = loadDb();
    return ok(
      [...db.reminders]
        .sort((a, b) => a.triggerAt.localeCompare(b.triggerAt))
        .map((r) => expandReminder(db, r))
    );
  }],
  ["POST", "/reminders", ({ body }) => {
    const data = parse(reminderSchema, body);
    return created(
      mutate((db) => {
        const row: ReminderRow = {
          id: newId(),
          triggerAt: data.triggerAt,
          minutesBefore: data.minutesBefore ?? null,
          type: data.type ?? "in_app",
          delivered: false,
          taskId: data.taskId ?? null,
          habitId: data.habitId ?? null,
          eventId: data.eventId ?? null,
          createdAt: nowIso(),
        };
        db.reminders.push(row);
        return row;
      })
    );
  }],
  ["PATCH", "/reminders/:id/deliver", ({ params }) =>
    ok(
      mutate((db) => {
        const row = find(db.reminders, params.id);
        row.delivered = true;
        return row;
      })
    )],
  ["DELETE", "/reminders/:id", ({ params }) => {
    mutate((db) => {
      find(db.reminders, params.id);
      db.reminders = db.reminders.filter((r) => r.id !== params.id);
    });
    return noContent();
  }],

  // Metas
  ["GET", "/goals", () => {
    const db = loadDb();
    return ok(
      [...db.goals].sort((a, b) => a.endDate.localeCompare(b.endDate)).map((g) => withCategory(db, g))
    );
  }],
  ["POST", "/goals", ({ body }) => {
    const data = parse(goalSchema, body);
    return created(
      mutate((db) => {
        const ts = nowIso();
        const row: GoalRow = {
          id: newId(),
          title: data.title,
          description: data.description ?? null,
          type: data.type ?? "monthly",
          targetValue: data.targetValue ?? 100,
          currentValue: data.currentValue ?? 0,
          unit: data.unit ?? null,
          startDate: data.startDate ?? ts,
          endDate: data.endDate,
          categoryId: data.categoryId ?? null,
          completed: data.completed ?? false,
          createdAt: ts,
          updatedAt: ts,
        };
        db.goals.push(row);
        return withCategory(db, row);
      })
    );
  }],
  ["PUT", "/goals/:id", ({ params, body }) => {
    const data = parse(goalSchema.partial(), body);
    return ok(
      mutate((db) => {
        const row = find(db.goals, params.id);
        assign(row, data as Partial<GoalRow>);
        row.updatedAt = nowIso();
        return withCategory(db, row);
      })
    );
  }],
  ["DELETE", "/goals/:id", ({ params }) => {
    mutate((db) => {
      find(db.goals, params.id);
      db.goals = db.goals.filter((g) => g.id !== params.id);
    });
    return noContent();
  }],

  // Ajustes
  ["GET", "/settings", () => ok(safeSettings(loadDb()))],
  ["PUT", "/settings", ({ body }) => {
    const data = parse(settingsSchema, body);
    return ok(
      mutate((db) => {
        assign(db.settings, data as any);
        db.settings.updatedAt = nowIso();
        return safeSettings(db);
      })
    );
  }],
  ["POST", "/settings/pin/verify", async ({ body }) => {
    const { pin } = parse(z.object({ pin: z.string() }), body);
    const db = loadDb();
    const hash = await hashPin(pin);
    return ok({ ok: !!db.settings.pinHash && db.settings.pinHash === hash });
  }],
  ["POST", "/settings/pin", async ({ body }) => {
    const { pin } = parse(z.object({ pin: z.string().min(4).max(32) }), body);
    const hash = await hashPin(pin);
    mutate((db) => {
      db.settings.pinHash = hash;
      db.settings.pinEnabled = true;
      db.settings.updatedAt = nowIso();
    });
    return ok({ ok: true });
  }],
  ["DELETE", "/settings/pin", () => {
    mutate((db) => {
      db.settings.pinHash = null;
      db.settings.pinEnabled = false;
      db.settings.updatedAt = nowIso();
    });
    return noContent();
  }],

  // Estadísticas
  ["GET", "/stats/summary", () => {
    const db = loadDb();
    const today = startOfDay(new Date());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 29);

    const completedAt = (t: TaskRow) => (t.completedAt ? new Date(t.completedAt) : null);
    const habits = db.habits.filter((h) => !h.archived);
    const habitLogsWeek = db.habitLogs.filter((l) => new Date(l.date) >= weekAgo);

    const dailyCompletion = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (29 - i));
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      return {
        date: d.toISOString().slice(0, 10),
        count: db.tasks.filter((t) => {
          const c = completedAt(t);
          return t.status === "completed" && c && c >= monthAgo && c >= d && c < next;
        }).length,
      };
    });

    const habitDaily = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (6 - i));
      return {
        date: d.toISOString().slice(0, 10),
        count: habitLogsWeek.filter((l) => startOfDay(new Date(l.date)).getTime() === d.getTime()).length,
        total: habits.length,
      };
    });

    return ok({
      totalTasks: db.tasks.length,
      completedToday: db.tasks.filter((t) => {
        const c = completedAt(t);
        return t.status === "completed" && c && c >= today;
      }).length,
      pendingTasks: db.tasks.filter((t) => t.status === "pending" || t.status === "in_progress").length,
      completedThisWeek: db.tasks.filter((t) => {
        const c = completedAt(t);
        return t.status === "completed" && c && c >= weekAgo;
      }).length,
      activeHabits: habits.length,
      dailyCompletion,
      habitDaily,
    });
  }],

  // Copia de seguridad
  ["GET", "/backup/export", () => {
    const db = loadDb();
    return ok({
      version: 1,
      exportedAt: nowIso(),
      data: {
        categories: db.categories,
        tags: db.tags,
        tasks: db.tasks,
        taskTags: db.taskTags,
        habits: db.habits,
        habitLogs: db.habitLogs,
        events: db.events,
        reminders: db.reminders,
        goals: db.goals,
        settings: db.settings,
      },
    });
  }],
  ["POST", "/backup/import", ({ body }) => {
    const { data, replace } = parse(
      z.object({
        data: z.object({
          categories: z.array(z.any()).optional(),
          tags: z.array(z.any()).optional(),
          tasks: z.array(z.any()).optional(),
          taskTags: z.array(z.any()).optional(),
          habits: z.array(z.any()).optional(),
          habitLogs: z.array(z.any()).optional(),
          events: z.array(z.any()).optional(),
          reminders: z.array(z.any()).optional(),
          goals: z.array(z.any()).optional(),
          settings: z.any().optional(),
        }),
        replace: z.boolean().optional(),
      }),
      body
    );

    mutate((db) => {
      if (replace) {
        db.categories = [];
        db.tags = [];
        db.tasks = [];
        db.taskTags = [];
        db.habits = [];
        db.habitLogs = [];
        db.events = [];
        db.reminders = [];
        db.goals = [];
      }
      const upsert = <T extends { id: string }>(rows: T[], incoming: any[]) => {
        for (const item of incoming) {
          const { tags: _tags, category: _category, ...rest } = item;
          const i = rows.findIndex((r) => r.id === rest.id);
          if (i >= 0) rows[i] = { ...rows[i], ...rest };
          else rows.push(rest);
        }
      };
      upsert(db.categories, data.categories ?? []);
      upsert(db.tags, data.tags ?? []);
      upsert(db.tasks, data.tasks ?? []);
      for (const tt of data.taskTags ?? []) {
        if (!db.taskTags.some((x) => x.taskId === tt.taskId && x.tagId === tt.tagId)) {
          db.taskTags.push({ taskId: tt.taskId, tagId: tt.tagId });
        }
      }
      upsert(db.habits, data.habits ?? []);
      upsert(db.habitLogs, data.habitLogs ?? []);
      upsert(db.events, data.events ?? []);
      upsert(db.reminders, data.reminders ?? []);
      upsert(db.goals, data.goals ?? []);
    });

    return ok({ ok: true });
  }],
];

/** Empareja "/habits/abc/logs" con "/habits/:id/logs". */
function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

/** Punto de entrada: resuelve una petición contra el almacenamiento local. */
export async function handleRequest(method: string, rawPath: string, body?: unknown): Promise<Result> {
  const url = new URL(rawPath, "http://local");
  for (const [routeMethod, pattern, handler] of routes) {
    if (routeMethod !== method) continue;
    const params = match(pattern, url.pathname);
    if (!params) continue;
    return handler({ params, query: url.searchParams, body });
  }
  throw new ApiError(404, `Ruta no encontrada: ${method} ${url.pathname}`);
}
