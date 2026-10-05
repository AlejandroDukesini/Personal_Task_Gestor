// Router local: reimplementa en el navegador las rutas que servía Express.
// Cada handler replica la lógica del servidor (validación zod incluida) para que
// `api.ts` y las páginas no noten la diferencia.

import { z } from "zod";
import {
  ApiError,
  FINANCE_COLLECTIONS,
  ensureOwnerTags,
  loadDb,
  mutate,
  newId,
  nowIso,
  startOfDay,
  tombstone,
  type CategoryRow,
  type Db,
  type EventRow,
  type GoalRow,
  type HabitRow,
  type ReminderRow,
  type SubtaskRow,
  type TagRow,
  type TaskRecurrence,
  type TaskRow,
} from "./localDb";
import {
  assign,
  created,
  find,
  noContent,
  ok,
  parse,
  stripDangerousKeys,
  type Result,
  type Route,
} from "./routeKit";
import { financeRoutes } from "./finance/routes";
import { notesRoutes } from "./notes/routes";
import { NOTE_ROW_SCHEMAS } from "./notes/schemas";
import { goalProgress } from "./finance/calc";
import { FINANCE_ROW_SCHEMAS } from "./finance/schemas";
import { todayKey } from "./finance/dates";
import { applyLogChange, deleteSchedule, habitRoutes, logChangeSchema, serializeHabit } from "./habits/routes";
import { logTarget, logsByDay } from "./habits/progress";
import {
  MESSAGES,
  eventRangeError,
  goalDatesError,
  habitDatesError,
  habitDaysError,
  isoDate,
  isoDateOrNull,
  localToday,
  dayOf,
  requiredText,
  taskCompletionError,
  taskDatesError,
  timeOrNull,
} from "./rules";

/** Rechaza la operación si la regla devuelve un mensaje: nada se guarda. */
function check(error: string | null, status = 400): void {
  if (error) throw new ApiError(status, error);
}

/** ¿La petición trae alguno de estos campos? Solo entonces se revalida su regla. */
const touches = (data: object, keys: string[]) => keys.some((k) => (data as Record<string, unknown>)[k] !== undefined);

// ---------------------------------------------------------------- categorías

const categorySchema = z.object({
  name: requiredText("El nombre", 80),
  color: z.string().optional(),
  icon: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
});

/**
 * Jerarquía de un solo nivel (es lo que ofrece el formulario): el padre debe
 * existir, ser una categoría principal y no ser la propia categoría; y una
 * categoría que ya tiene subcategorías no puede pasar a ser subcategoría.
 */
function checkCategoryParent(db: Db, parentId: string | null | undefined, selfId?: string): void {
  if (!parentId) return;
  if (parentId === selfId) throw new ApiError(400, "Una categoría no puede ser su propia categoría padre");
  const parent = find(db.categories, parentId, "Categoría padre");
  if (parent.parentId) throw new ApiError(400, "Solo hay un nivel de subcategorías: elige una categoría principal como padre");
  if (selfId && db.categories.some((c) => c.parentId === selfId)) {
    throw new ApiError(409, "Esta categoría tiene subcategorías: no puede convertirse en subcategoría");
  }
}

/** Una referencia opcional a categoría debe apuntar a una que exista. */
function checkCategoryRef(db: Db, categoryId: string | null | undefined): void {
  if (categoryId) find(db.categories, categoryId, "Categoría");
}

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

const tagSchema = z.object({
  name: requiredText("El nombre", 60),
  color: z.string().optional(),
  icon: z.string().nullable().optional(),
});

/** "Trabajo" y " trabajo " son la misma etiqueta: el filtro no las distinguiría. */
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// -------------------------------------------------------------------- tareas

const taskSchema = z.object({
  title: requiredText("El título", 200),
  description: z.string().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
  progress: z.number().min(0).max(100).optional(),
  startDate: isoDateOrNull("Inicio"),
  dueDate: isoDateOrNull("Vencimiento"),
  dueTime: timeOrNull,
  notes: z.string().nullable().optional(),
  position: z.number().optional(),
  categoryId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).optional(),
  recurrence: z.enum(["daily", "weekdays", "weekly", "monthly", "yearly"]).nullable().optional(),
  recurrenceInterval: z.number().int().min(1).max(365).optional(),
  goalId: z.string().nullable().optional(),
  /**
   * Recordatorio relativo al vencimiento, en minutos antes (0 = a la hora).
   * null lo elimina; ausente no lo toca. Se traduce a una fila de `reminders`.
   */
  reminderMinutes: z.number().int().min(0).max(60 * 24 * 30).nullable().optional(),
});

/** Instante del vencimiento: fecha + hora (o 09:00 si la tarea no tiene hora). */
function dueInstant(t: Pick<TaskRow, "dueDate" | "dueTime">): Date | null {
  if (!t.dueDate) return null;
  const d = new Date(t.dueDate);
  const [h, m] = (t.dueTime || "09:00").split(":").map(Number);
  // La fecha se guarda como medianoche UTC del día elegido: se toma ese día en local.
  const local = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h || 0, m || 0);
  return Number.isNaN(local.getTime()) ? null : local;
}

/** Sustituye el recordatorio relativo de una tarea (uno por tarea). */
function setTaskReminder(db: Db, task: TaskRow, minutes: number | null | undefined): void {
  if (minutes === undefined) return;
  for (const r of db.reminders.filter((r) => r.taskId === task.id && r.minutesBefore !== null)) {
    tombstone(db, "reminders", r.id);
  }
  db.reminders = db.reminders.filter((r) => !(r.taskId === task.id && r.minutesBefore !== null));
  const due = dueInstant(task);
  if (minutes === null || !due) return;
  const trigger = new Date(due.getTime() - minutes * 60000);
  const ts = nowIso();
  db.reminders.push({
    id: newId(),
    triggerAt: trigger.toISOString(),
    minutesBefore: minutes,
    type: "in_app",
    // Un aviso que ya pasó no se dispara al guardar: sería ruido.
    delivered: trigger.getTime() <= Date.now(),
    taskId: task.id,
    habitId: null,
    eventId: null,
    createdAt: ts,
    updatedAt: ts,
  });
}

/** Siguiente vencimiento de una serie a partir de `from`. */
export function nextDueDate(from: Date, recurrence: TaskRecurrence, interval: number): Date {
  const d = new Date(from);
  const n = Math.max(1, interval);
  switch (recurrence) {
    case "daily":
      d.setUTCDate(d.getUTCDate() + n);
      break;
    case "weekdays": {
      // Salta fines de semana: viernes -> lunes.
      let left = n;
      while (left > 0) {
        d.setUTCDate(d.getUTCDate() + 1);
        const dow = d.getUTCDay();
        if (dow !== 0 && dow !== 6) left--;
      }
      break;
    }
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7 * n);
      break;
    case "monthly": {
      const day = d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + n);
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(day, last));
      break;
    }
    case "yearly":
      d.setUTCFullYear(d.getUTCFullYear() + n);
      break;
  }
  return d;
}

/**
 * Al completar una tarea recurrente se crea la siguiente ocurrencia. Su id es
 * determinista (serie + fecha): si la misma tarea se completa en el PC y en el
 * móvil sin conexión, ambos generan la MISMA siguiente tarea y la
 * sincronización no la duplica.
 */
function spawnNextOccurrence(db: Db, task: TaskRow): TaskRow | null {
  if (!task.recurrence) return null;
  const base = task.dueDate ? new Date(task.dueDate) : new Date(new Date().toISOString().slice(0, 10));
  const next = nextDueDate(base, task.recurrence, task.recurrenceInterval);
  const seriesId = task.seriesId ?? task.id;
  const id = `${seriesId}~${next.toISOString().slice(0, 10)}`;
  if (db.tasks.some((t) => t.id === id) || db.tombstones.some((t) => t.collection === "tasks" && t.id === id)) {
    return null;
  }
  const ts = nowIso();
  const row: TaskRow = {
    ...task,
    id,
    status: "pending",
    progress: 0,
    completedAt: null,
    startDate: null,
    dueDate: next.toISOString(),
    seriesId,
    createdAt: ts,
    updatedAt: ts,
  };
  db.tasks.push(row);
  for (const tt of db.taskTags.filter((x) => x.taskId === task.id)) db.taskTags.push({ taskId: id, tagId: tt.tagId });
  // El checklist se copia desmarcado: es una plantilla de la serie.
  for (const s of db.subtasks.filter((s) => s.taskId === task.id)) {
    db.subtasks.push({ ...s, id: `${id}:${s.id}`.slice(0, 128), taskId: id, done: false, createdAt: ts, updatedAt: ts });
  }
  const rel = db.reminders.find((r) => r.taskId === task.id && r.minutesBefore !== null);
  if (rel) setTaskReminder(db, row, rel.minutesBefore);
  return row;
}

/** Cambia el estado de una tarea manteniendo `completedAt` y las series. */
function applyStatus(db: Db, row: TaskRow, status: string): void {
  if (status === row.status) return; // re-guardar no reescribe la fecha de cierre
  if (status === "completed") check(taskCompletionError(subtasksOf(db, row.id)), 409);
  const wasCompleted = row.status === "completed";
  row.status = status;
  if (status === "completed") {
    row.completedAt = nowIso();
    if (!wasCompleted) spawnNextOccurrence(db, row);
  } else {
    row.completedAt = null;
  }
}

const subtaskSchema = z.object({
  title: requiredText("El sub-paso", 200),
  done: z.boolean().optional(),
  position: z.number().int().optional(),
});

function subtasksOf(db: Db, taskId: string): SubtaskRow[] {
  return db.subtasks
    .filter((s) => s.taskId === taskId)
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

/**
 * Con sub-pasos, el progreso deja de ser un número que el usuario arrastra y
 * pasa a derivarse del checklist: una sola fuente de verdad evita que la barra
 * diga 20% mientras 4 de 5 pasos están marcados.
 */
function derivedProgress(steps: SubtaskRow[], fallback: number): number {
  if (steps.length === 0) return fallback;
  return Math.round((steps.filter((s) => s.done).length / steps.length) * 100);
}

/** Recalcula y persiste el progreso de la tarea a partir de sus sub-pasos. */
function syncTaskProgress(db: Db, taskId: string): void {
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const steps = subtasksOf(db, taskId);
  if (steps.length === 0) return;
  task.progress = derivedProgress(steps, task.progress);
  // Completar el último paso cierra la tarea; desmarcar uno la reabre.
  if (task.progress === 100 && task.status !== "completed" && task.status !== "cancelled") {
    applyStatus(db, task, "completed");
  } else if (task.progress < 100 && task.status === "completed") {
    applyStatus(db, task, "in_progress");
  }
  task.updatedAt = nowIso();
}

/** Referencias de una tarea: deben existir antes de guardarse. */
function checkTaskRefs(db: Db, data: { categoryId?: string | null; goalId?: string | null; tagIds?: string[] }): void {
  checkCategoryRef(db, data.categoryId);
  if (data.goalId) find(db.goals, data.goalId, "Objetivo");
  for (const tagId of data.tagIds ?? []) find(db.tags, tagId, "Etiqueta");
}

/** Fila con los cambios aplicados, para validar el resultado antes de guardarlo. */
function merged<T extends object>(row: T, data: object): T {
  return { ...row, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };
}

function serializeTask(db: Db, t: TaskRow) {
  const tagIds = db.taskTags.filter((tt) => tt.taskId === t.id).map((tt) => tt.tagId);
  const subtasks = subtasksOf(db, t.id);
  return {
    ...t,
    progress: derivedProgress(subtasks, t.progress),
    subtasks,
    category: db.categories.find((c) => c.id === t.categoryId) ?? null,
    tags: db.tags.filter((tag) => tagIds.includes(tag.id)),
    reminders: db.reminders.filter((r) => r.taskId === t.id),
    goal: t.goalId ? (db.goals.find((g) => g.id === t.goalId) ?? null) : null,
  };
}

// ------------------------------------------------------------------ hábitos

const habitSchema = z.object({
  name: requiredText("El nombre", 120),
  description: z.string().nullable().optional(),
  color: z.string().optional(),
  icon: z.string().nullable().optional(),
  frequency: z.enum(["daily", "weekly", "monthly", "custom"]).optional(),
  daysOfWeek: z
    .string()
    .regex(/^$|^[0-6](,[0-6])*$/, "Días de la semana no válidos (0 = domingo … 6 = sábado)")
    .nullable()
    .optional(),
  dailyTarget: z.number().int().min(1).optional(),
  weeklyTarget: z.number().int().min(1).nullable().optional(),
  startDate: isoDateOrNull("Inicio"),
  endDate: isoDateOrNull("Fin"),
  categoryId: z.string().nullable().optional(),
  archived: z.boolean().optional(),
  unit: z.string().max(24).nullable().optional(),
  showInCalendar: z.boolean().optional(),
  gcalSync: z.boolean().optional(),
});

/** Hábito con estadísticas (racha, mejor racha, 30 días, hoy) y programaciones. */
const addStats = serializeHabit;

// ------------------------------------------------------------------- eventos

const eventSchema = z.object({
  title: requiredText("El título", 200),
  description: z.string().nullable().optional(),
  start: isoDate("Inicio"),
  end: isoDate("Fin"),
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
    triggerAt: isoDate("Aviso"),
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
  title: requiredText("El título", 200),
  description: z.string().nullable().optional(),
  type: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
  // El progreso es actual/meta: una meta 0 o negativa no tiene sentido (y divide por cero).
  targetValue: z.number().finite().positive(MESSAGES.goalTarget).optional(),
  currentValue: z.number().finite().optional(),
  unit: z.string().nullable().optional(),
  startDate: isoDate("Inicio").optional(),
  endDate: isoDate("Fecha límite"),
  categoryId: z.string().nullable().optional(),
  completed: z.boolean().optional(),
  source: z.enum(["manual", "tasks", "finance"]).optional(),
  finGoalId: z.string().nullable().optional(),
});

/**
 * Objetivo con su valor actual resuelto. Con fuente `tasks` o `finance` el
 * valor se CALCULA a partir del otro módulo en cada lectura; no se copia, así
 * que nunca se desincroniza ni modifica datos del módulo de origen.
 */
function withGoalValue(db: Db, g: GoalRow) {
  let currentValue = g.currentValue;
  let targetValue = g.targetValue;
  let linkedTasks = 0;
  if (g.source === "tasks") {
    const linked = db.tasks.filter((t) => t.goalId === g.id);
    linkedTasks = linked.length;
    currentValue = linked.filter((t) => t.status === "completed").length;
  } else if (g.source === "finance" && g.finGoalId) {
    const fg = db.finGoals.find((x) => x.id === g.finGoalId);
    if (fg) {
      // En unidades de moneda (no céntimos) para que la barra sea comparable.
      currentValue = goalProgress(db, fg, todayKey()).saved / 100;
      targetValue = fg.targetAmount / 100;
    }
  }
  return {
    ...withCategory(db, g),
    currentValue,
    targetValue,
    linkedTasks,
    completed: g.completed || (g.source !== "manual" && targetValue > 0 && currentValue >= targetValue),
  };
}

// ------------------------------------------------------------------ ajustes

/**
 * El logo se guarda embebido como data URL. Se acepta solo imagen rasterizada
 * en base64: evita almacenar `data:text/html`, `data:image/svg+xml` u otros
 * tipos activos que podrían ejecutarse si en el futuro el logo se renderizara
 * fuera de un `<img>` (hoy es inerte, pero la lista blanca cierra la vía).
 */
const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

const appLogoSchema = z
  .string()
  .max(500000)
  .refine((v) => v === "" || LOGO_DATA_URL.test(v) || !v.startsWith("data:"), {
    message: "Formato de logo no permitido",
  });

/** "HH:mm" en formato 24 h. */
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:mm)")
  .nullable()
  .optional();

const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  skin: z.enum(["default", "brutalist", "glass", "terminal"]).optional(),
  notificationsEnabled: z.boolean().optional(),
  habitReminderTime: timeOfDay,
  dailyDigestTime: timeOfDay,
  language: z.string().max(16).optional(),
  dateFormat: z.string().max(32).optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{3,8}$/, "Color inválido")
    .optional(),
  fontScale: z.number().min(0.5).max(2).optional(),
  appName: z.string().min(1).max(40).optional(),
  appLogo: appLogoSchema.nullable().optional(),
  userName: z.string().max(40).nullable().optional(),
  timezone: z.string().max(64).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
});

// ------------------------------------------------------------------- PIN
//
// AVISO DE DISEÑO: en una app 100% estática el PIN es un bloqueo de
// conveniencia, no un control de seguridad. El hash vive en el mismo
// localStorage que los datos que protege, así que quien tenga acceso al
// navegador puede leer los datos sin pasar por la pantalla de bloqueo.
// Lo que sí se puede hacer -- y se hace aquí -- es encarecer el ataque
// offline contra el hash (que sí revela el PIN, a menudo reutilizado):
// PBKDF2 con sal aleatoria en lugar de SHA-256 a una sola ronda, que para
// 4 dígitos se rompe probando las 10.000 combinaciones.

const PBKDF2_ITERATIONS = 210000; // Alineado con la guía OWASP para PBKDF2-SHA256.
const PBKDF2_PREFIX = "pbkdf2$sha256$";

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? []);

/** Comparación en tiempo constante: no filtra cuántos caracteres coinciden. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256
  );
  return toHex(bits);
}

/** Formato almacenado: `pbkdf2$sha256$<iteraciones>$<salHex>$<hashHex>`. */
async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(pin, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}$${toHex(salt.buffer)}$${hash}`;
}

/** SHA-256 a una ronda: solo para validar hashes creados por versiones previas. */
async function legacySha256(pin: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return toHex(digest);
}

/**
 * Verifica contra el formato nuevo y contra el heredado. Devuelve además un
 * `upgrade` para volver a sellar el PIN con PBKDF2 tras un acierto sobre un
 * hash antiguo, de modo que la migración es transparente para el usuario.
 */
async function verifyPin(pin: string, stored: string | null): Promise<{ ok: boolean; upgrade?: string }> {
  if (!stored) return { ok: false };

  if (stored.startsWith(PBKDF2_PREFIX)) {
    const [, , iterStr, saltHex, expected] = stored.split("$");
    const iterations = Number(iterStr);
    if (!Number.isFinite(iterations) || !saltHex || !expected) return { ok: false };
    const actual = await pbkdf2(pin, fromHex(saltHex), iterations);
    return { ok: timingSafeEqual(actual, expected) };
  }

  const ok = timingSafeEqual(await legacySha256(pin), stored);
  return ok ? { ok, upgrade: await hashPin(pin) } : { ok };
}

function safeSettings(db: Db) {
  const { pinHash, ...safe } = db.settings;
  return { ...safe, pinSet: Boolean(pinHash) };
}

// -------------------------------------------------------------------- rutas

const routes: Route[] = [
  ["GET", "/health", () => ok({ ok: true, version: "1.3.0" })],
  ...financeRoutes,
  ...notesRoutes,
  ...habitRoutes,

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
        checkCategoryParent(db, data.parentId);
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
        checkCategoryParent(db, data.parentId, row.id);
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
      tombstone(db, "categories", params.id);
    });
    return noContent();
  }],

  // Etiquetas
  ["GET", "/tags", () => ok([...loadDb().tags].sort((a, b) => a.name.localeCompare(b.name)))],
  ["POST", "/tags", ({ body }) => {
    const data = parse(tagSchema, body);
    return created(
      mutate((db) => {
        if (db.tags.some((t) => sameName(t.name, data.name))) {
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
    const data = parse(tagSchema.partial(), body);
    return ok(
      mutate((db) => {
        const row = find(db.tags, params.id);
        if (data.name && db.tags.some((t) => sameName(t.name, data.name!) && t.id !== params.id)) {
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
      tombstone(db, "tags", params.id);
    });
    return noContent();
  }],

  // Tareas
  ["GET", "/tasks", ({ query }) => {
    const db = loadDb();
    const status = query.get("status");
    const categoryId = query.get("categoryId");
    const goalId = query.get("goalId");
    const search = query.get("search")?.toLowerCase();
    const rows = db.tasks
      .filter((t) => (status ? t.status === status : true))
      .filter((t) => (categoryId ? t.categoryId === categoryId : true))
      .filter((t) => (goalId ? t.goalId === goalId : true))
      .filter((t) =>
        search
          ? t.title.toLowerCase().includes(search) ||
            (t.description ?? "").toLowerCase().includes(search) ||
            (t.notes ?? "").toLowerCase().includes(search)
          : true
      )
      .sort((a, b) => a.position - b.position || b.createdAt.localeCompare(a.createdAt));
    return ok(rows.map((t) => serializeTask(db, t)));
  }],
  ["PATCH", "/tasks/reorder", ({ body }) => {
    const items = parse(
      z
        .array(
          z.object({
            id: z.string(),
            position: z.number(),
            status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
          })
        )
        .max(2000),
      body
    );
    mutate((db) => {
      for (const it of items) {
        const row = find(db.tasks, it.id, "Tarea");
        row.position = it.position;
        if (it.status) applyStatus(db, row, it.status);
        row.updatedAt = nowIso();
      }
    });
    return ok({ ok: true });
  }],
  ["GET", "/tasks/:id", ({ params }) => {
    const db = loadDb();
    return ok(serializeTask(db, find(db.tasks, params.id, "Tarea")));
  }],
  ["POST", "/tasks", ({ body }) => {
    const { tagIds, reminderMinutes, ...data } = parse(taskSchema, body);
    return created(
      mutate((db) => {
        checkTaskRefs(db, { ...data, tagIds });
        check(taskDatesError(data));
        if (reminderMinutes != null && !data.dueDate) check(MESSAGES.taskReminderWithoutDate);
        const ts = nowIso();
        const row: TaskRow = {
          id: newId(),
          title: data.title,
          description: data.description ?? null,
          priority: data.priority ?? "medium",
          status: "pending",
          progress: data.progress ?? 0,
          startDate: data.startDate ?? null,
          dueDate: data.dueDate ?? null,
          dueTime: data.dueTime ?? null,
          notes: data.notes ?? null,
          position: data.position ?? 0,
          categoryId: data.categoryId ?? null,
          completedAt: null,
          recurrence: data.recurrence ?? null,
          recurrenceInterval: data.recurrenceInterval ?? 1,
          seriesId: null,
          goalId: data.goalId ?? null,
          createdAt: ts,
          updatedAt: ts,
        };
        db.tasks.push(row);
        for (const tagId of new Set(tagIds ?? [])) db.taskTags.push({ taskId: row.id, tagId });
        setTaskReminder(db, row, reminderMinutes);
        if (data.status) applyStatus(db, row, data.status);
        return serializeTask(db, row);
      })
    );
  }],
  ["PUT", "/tasks/:id", ({ params, body }) => {
    const { tagIds, reminderMinutes, status, ...data } = parse(taskSchema.partial(), body);
    return ok(
      mutate((db) => {
        const row = find(db.tasks, params.id, "Tarea");
        checkTaskRefs(db, { ...data, tagIds });
        const dueChanged = data.dueDate !== undefined || data.dueTime !== undefined;
        // Se valida la tarea RESULTANTE: un PUT parcial con solo el inicio no
        // puede dejarla empezando después de vencer. Solo se revisan las reglas
        // de los campos enviados, para no bloquear ediciones de filas antiguas.
        const next = merged(row, data);
        if (touches(data, ["startDate", "dueDate", "dueTime"])) check(taskDatesError(next));
        if (reminderMinutes != null && !next.dueDate) check(MESSAGES.taskReminderWithoutDate);
        assign(row, data as Partial<TaskRow>);
        // Solo un CAMBIO de estado toca `completedAt`: antes, volver a guardar
        // una tarea completada reescribía su fecha de cierre y falseaba el historial.
        if (status) applyStatus(db, row, status);
        row.updatedAt = nowIso();
        if (tagIds) {
          db.taskTags = db.taskTags.filter((tt) => tt.taskId !== params.id);
          for (const tagId of new Set(tagIds)) db.taskTags.push({ taskId: params.id, tagId });
        }
        // Si cambia el vencimiento, el recordatorio relativo se recalcula.
        const rel = db.reminders.find((r) => r.taskId === row.id && r.minutesBefore !== null);
        if (reminderMinutes !== undefined) setTaskReminder(db, row, reminderMinutes);
        else if (dueChanged && rel) setTaskReminder(db, row, rel.minutesBefore);
        return serializeTask(db, row);
      })
    );
  }],
  ["DELETE", "/tasks/:id", ({ params }) => {
    mutate((db) => {
      find(db.tasks, params.id);
      db.tasks = db.tasks.filter((t) => t.id !== params.id);
      db.taskTags = db.taskTags.filter((tt) => tt.taskId !== params.id); // onDelete: Cascade
      // Los sub-pasos y recordatorios caen con la tarea; cada uno deja lápida
      // para que la sincronización no los reviva desde otro dispositivo.
      for (const s of db.subtasks.filter((s) => s.taskId === params.id)) {
        tombstone(db, "subtasks", s.id);
      }
      db.subtasks = db.subtasks.filter((s) => s.taskId !== params.id);
      for (const r of db.reminders.filter((r) => r.taskId === params.id)) {
        tombstone(db, "reminders", r.id);
      }
      db.reminders = db.reminders.filter((r) => r.taskId !== params.id);
      tombstone(db, "tasks", params.id);
    });
    return noContent();
  }],

  // Sub-pasos (checklist)
  ["GET", "/tasks/:id/subtasks", ({ params }) => {
    const db = loadDb();
    find(db.tasks, params.id);
    return ok(subtasksOf(db, params.id));
  }],
  ["POST", "/tasks/:id/subtasks", ({ params, body }) => {
    const data = parse(subtaskSchema, body);
    return created(
      mutate((db) => {
        find(db.tasks, params.id);
        const siblings = subtasksOf(db, params.id);
        const ts = nowIso();
        const row: SubtaskRow = {
          id: newId(),
          taskId: params.id,
          title: data.title,
          done: data.done ?? false,
          position: data.position ?? siblings.length,
          createdAt: ts,
          updatedAt: ts,
        };
        db.subtasks.push(row);
        syncTaskProgress(db, params.id);
        return row;
      })
    );
  }],
  ["PATCH", "/tasks/:taskId/subtasks/reorder", ({ params, body }) => {
    const items = parse(
      z.array(z.object({ id: z.string(), position: z.number().int() })).max(500),
      body
    );
    mutate((db) => {
      for (const it of items) {
        const row = db.subtasks.find((s) => s.id === it.id && s.taskId === params.taskId);
        if (!row) continue;
        row.position = it.position;
        row.updatedAt = nowIso();
      }
    });
    return ok({ ok: true });
  }],
  ["PATCH", "/subtasks/:id", ({ params, body }) => {
    const data = parse(subtaskSchema.partial(), body);
    return ok(
      mutate((db) => {
        const row = find(db.subtasks, params.id);
        assign(row, data as Partial<SubtaskRow>);
        row.updatedAt = nowIso();
        syncTaskProgress(db, row.taskId);
        return row;
      })
    );
  }],
  ["DELETE", "/subtasks/:id", ({ params }) => {
    mutate((db) => {
      const row = find(db.subtasks, params.id);
      const taskId = row.taskId;
      db.subtasks = db.subtasks.filter((s) => s.id !== params.id);
      tombstone(db, "subtasks", params.id);
      syncTaskProgress(db, taskId);
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
        checkCategoryRef(db, data.categoryId);
        check(habitDaysError(data));
        check(habitDatesError(data));
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
          unit: data.unit?.trim() || null,
          showInCalendar: data.showInCalendar ?? true,
          gcalSync: data.gcalSync ?? false,
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
        checkCategoryRef(db, data.categoryId);
        const next = merged(row, data);
        if (touches(data, ["frequency", "daysOfWeek"])) check(habitDaysError(next));
        if (touches(data, ["startDate", "endDate"])) check(habitDatesError(next));
        // Cambiar la meta solo afecta a hoy y a los días futuros: cada registro
        // pasado conserva la meta con la que se registró.
        if (data.dailyTarget !== undefined && data.dailyTarget !== row.dailyTarget) {
          const today = startOfDay(new Date()).toISOString();
          for (const l of db.habitLogs) {
            if (l.habitId !== row.id) continue;
            if (l.date === today) l.target = data.dailyTarget;
            else if (l.target === undefined) l.target = logTarget(l, row);
            else continue;
            l.updatedAt = nowIso();
          }
        }
        if (data.unit !== undefined) data.unit = data.unit?.trim() || null;
        assign(row, data as Partial<HabitRow>);
        row.updatedAt = nowIso();
        return addStats(db, row);
      })
    );
  }],
  ["DELETE", "/habits/:id", ({ params, query }) => {
    mutate((db) => {
      find(db.habits, params.id);
      // Sus programaciones caen con él. Los eventos de Google Calendar solo se
      // tocan si el usuario lo pidió (?remote=future).
      for (const s of db.habitSchedules.filter((s) => s.habitId === params.id)) {
        deleteSchedule(db, s.id, query.get("remote") === "future" ? "future" : "keep");
      }
      db.habits = db.habits.filter((h) => h.id !== params.id);
      for (const l of db.habitLogs.filter((l) => l.habitId === params.id)) {
        tombstone(db, "habitLogs", l.id);
      }
      db.habitLogs = db.habitLogs.filter((l) => l.habitId !== params.id); // onDelete: Cascade
      for (const r of db.reminders.filter((r) => r.habitId === params.id)) {
        tombstone(db, "reminders", r.id);
      }
      db.reminders = db.reminders.filter((r) => r.habitId !== params.id);
      tombstone(db, "habits", params.id);
    });
    return noContent();
  }],
  /**
   * Mapa de contribuciones estilo GitHub. Devuelve una rejilla continua de días
   * (incluidos los vacíos) alineada a domingo, para que el componente solo
   * tenga que pintar celdas en columnas de 7.
   */
  ["GET", "/habits/:id/heatmap", ({ params, query }) => {
    const db = loadDb();
    const habit = find(db.habits, params.id);
    const days = Math.min(Math.max(Number(query.get("days") ?? 364), 28), 730);

    const today = startOfDay(new Date());
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    // Se retrocede al domingo anterior y se avanza hasta el sábado de esta
    // semana: así la rejilla es un rectángulo exacto de columnas de 7 y la
    // última no queda coja. Los días aún por venir se marcan como futuros.
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay()));

    const counts = new Map<number, number>();
    for (const log of db.habitLogs) {
      if (log.habitId !== habit.id) continue;
      const key = startOfDay(new Date(log.date)).getTime();
      if (key < start.getTime() || key > end.getTime()) continue;
      counts.set(key, (counts.get(key) ?? 0) + Math.max(1, log.count));
    }

    const target = Math.max(1, habit.dailyTarget);
    const cells: { date: string; count: number; level: number }[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const count = counts.get(d.getTime()) ?? 0;
      // 4 tramos sobre el objetivo diario: 0, <50%, <100%, =100%, >100%.
      const ratio = count / target;
      const level = count === 0 ? 0 : ratio < 0.5 ? 1 : ratio < 1 ? 2 : ratio === 1 ? 3 : 4;
      cells.push({ date: new Date(d).toISOString(), count, level });
    }

    return ok({
      habitId: habit.id,
      color: habit.color,
      dailyTarget: target,
      total: [...counts.values()].reduce((a, b) => a + b, 0),
      cells,
    });
  }],
  /**
   * Registra realizaciones. Sin `count` ni `delta` suma una (un clic = una
   * vez); `delta: -1` corrige un clic de más; `count` fija el total del día.
   * Llegar a 0 borra el registro del día (el resto del historial no se toca).
   */
  ["POST", "/habits/:id/logs", ({ params, body }) => {
    const { date, count, delta, note, source } = parse(logChangeSchema, body);
    if (Number.isNaN(new Date(date).getTime())) throw new ApiError(400, "Fecha no válida");
    const dayStart = startOfDay(new Date(date)).toISOString();
    // Se compara por día local: hoy cuenta, mañana todavía no.
    if (startOfDay(new Date(date)).getTime() > startOfDay(new Date()).getTime()) check(MESSAGES.habitFutureLog);
    return mutate((db) => {
      const habit = find(db.habits, params.id, "Hábito");
      if (habit.archived) check(MESSAGES.habitArchived, 409);
      const existed = db.habitLogs.some((l) => l.habitId === habit.id && l.date === dayStart);
      const row = applyLogChange(db, habit, date, { count, delta, note }, source ?? "manual");
      if (!row) return ok({ habitId: habit.id, date: dayStart, count: 0, target: habit.dailyTarget });
      return existed ? ok(row) : created(row);
    });
  }],
  ["DELETE", "/habits/:id/logs", ({ params, query }) => {
    const dayStart = startOfDay(new Date(String(query.get("date")))).toISOString();
    mutate((db) => {
      for (const l of db.habitLogs.filter((l) => l.habitId === params.id && l.date === dayStart)) {
        tombstone(db, "habitLogs", l.id);
      }
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
        checkCategoryRef(db, data.categoryId);
        check(eventRangeError(data));
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
        checkCategoryRef(db, data.categoryId);
        // Mover solo el inicio no puede dejar el fin por delante de él.
        if (touches(data, ["start", "end"])) check(eventRangeError(merged(row, data)));
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
      for (const r of db.reminders.filter((r) => r.eventId === params.id)) {
        tombstone(db, "reminders", r.id);
      }
      db.reminders = db.reminders.filter((r) => r.eventId !== params.id); // onDelete: Cascade
      tombstone(db, "events", params.id);
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
        // Un aviso huérfano nunca se podría mostrar con su contexto.
        if (data.taskId) find(db.tasks, data.taskId, "Tarea");
        if (data.habitId) find(db.habits, data.habitId, "Hábito");
        if (data.eventId) find(db.events, data.eventId, "Evento");
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
          updatedAt: nowIso(),
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
        // Con marca nueva, el resto de dispositivos sabe que ya se avisó y no
        // repite la notificación.
        row.updatedAt = nowIso();
        return row;
      })
    )],
  ["DELETE", "/reminders/:id", ({ params }) => {
    mutate((db) => {
      find(db.reminders, params.id);
      db.reminders = db.reminders.filter((r) => r.id !== params.id);
      tombstone(db, "reminders", params.id);
    });
    return noContent();
  }],

  // Metas
  ["GET", "/goals", () => {
    const db = loadDb();
    return ok(
      [...db.goals].sort((a, b) => a.endDate.localeCompare(b.endDate)).map((g) => withGoalValue(db, g))
    );
  }],
  ["POST", "/goals", ({ body }) => {
    const data = parse(goalSchema, body);
    return created(
      mutate((db) => {
        checkCategoryRef(db, data.categoryId);
        if (data.source === "finance" && !data.finGoalId) check(MESSAGES.goalFinance);
        // Sin inicio explícito empieza hoy (día local, como el resto de fechas sin hora).
        const startDate = data.startDate ?? new Date(localToday()).toISOString();
        check(goalDatesError({ startDate, endDate: data.endDate }));
        // Crear un objetivo ya vencido no tiene sentido; editar uno antiguo sí se permite.
        if (dayOf(data.endDate) < localToday()) check(MESSAGES.goalPastDeadline);
        const ts = nowIso();
        const row: GoalRow = {
          id: newId(),
          title: data.title,
          description: data.description ?? null,
          type: data.type ?? "monthly",
          targetValue: data.targetValue ?? 100,
          currentValue: data.currentValue ?? 0,
          unit: data.unit ?? null,
          startDate,
          endDate: data.endDate,
          categoryId: data.categoryId ?? null,
          completed: data.completed ?? false,
          source: data.source ?? "manual",
          finGoalId: data.source === "finance" ? data.finGoalId ?? null : null,
          createdAt: ts,
          updatedAt: ts,
        };
        if (row.finGoalId) find(db.finGoals, row.finGoalId, "Meta de ahorro");
        db.goals.push(row);
        return withGoalValue(db, row);
      })
    );
  }],
  ["PUT", "/goals/:id", ({ params, body }) => {
    const data = parse(goalSchema.partial(), body);
    return ok(
      mutate((db) => {
        const row = find(db.goals, params.id);
        checkCategoryRef(db, data.categoryId);
        const next = merged(row, data);
        if (touches(data, ["startDate", "endDate"])) check(goalDatesError(next));
        if (next.source === "finance" && !next.finGoalId) check(MESSAGES.goalFinance);
        assign(row, data as Partial<GoalRow>);
        if (row.source !== "finance") row.finGoalId = null;
        if (row.finGoalId) find(db.finGoals, row.finGoalId, "Meta de ahorro");
        row.updatedAt = nowIso();
        return withGoalValue(db, row);
      })
    );
  }],
  ["DELETE", "/goals/:id", ({ params }) => {
    mutate((db) => {
      find(db.goals, params.id);
      db.goals = db.goals.filter((g) => g.id !== params.id);
      tombstone(db, "goals", params.id);
      // Las tareas vinculadas siguen existiendo; solo pierden el vínculo.
      for (const t of db.tasks) {
        if (t.goalId === params.id) {
          t.goalId = null;
          t.updatedAt = nowIso();
        }
      }
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
    const { pin } = parse(z.object({ pin: z.string().max(128) }), body);
    const { ok: valid, upgrade } = await verifyPin(pin, loadDb().settings.pinHash);
    // Migración silenciosa del hash heredado (SHA-256) al formato PBKDF2.
    if (valid && upgrade) {
      mutate((db) => {
        db.settings.pinHash = upgrade;
        db.settings.updatedAt = nowIso();
      });
    }
    return ok({ ok: valid });
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
    // Un día cuenta como completado al alcanzar su meta, no con cualquier registro.
    const habitLogsWeek = habits.flatMap((h) =>
      [...logsByDay(db.habitLogs.filter((l) => l.habitId === h.id && new Date(l.date) >= weekAgo)).values()].filter(
        (l) => l.count >= logTarget(l, h)
      )
    );

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
      version: 2,
      exportedAt: nowIso(),
      data: {
        categories: db.categories,
        tags: db.tags,
        tasks: db.tasks,
        taskTags: db.taskTags,
        subtasks: db.subtasks,
        habits: db.habits,
        habitLogs: db.habitLogs,
        habitSchedules: db.habitSchedules,
        gcalLinks: db.gcalLinks,
        habitImports: db.habitImports,
        events: db.events,
        reminders: db.reminders,
        goals: db.goals,
        finAccounts: db.finAccounts,
        finCategories: db.finCategories,
        finTransactions: db.finTransactions,
        finBudgets: db.finBudgets,
        finGoals: db.finGoals,
        finRecurring: db.finRecurring,
        finTags: db.finTags,
        noteCategories: db.noteCategories,
        // Los binarios de los adjuntos no viajan en la copia (solo sus datos).
        notes: db.notes,
        // Sin el hash del PIN: una copia no debe servir para atacarlo offline.
        settings: { ...db.settings, pinHash: null },
      },
    });
  }],
  ["POST", "/backup/import", ({ body }) => {
    // Un backup es un fichero que el usuario puede haber recibido de terceros:
    // se trata como entrada no confiable. Se acota el número de filas (evita
    // agotar la cuota de localStorage con un JSON gigante) y se exige que cada
    // fila sea un objeto con `id` de texto, en lugar de aceptar `any`.
    const MAX_ROWS = 20000;
    const row = z.object({ id: z.string().min(1).max(128) }).passthrough();
    const rows = z.array(row).max(MAX_ROWS).optional();

    const { data, replace } = parse(
      z.object({
        data: z.object({
          categories: rows,
          tags: rows,
          tasks: rows,
          taskTags: z
            .array(z.object({ taskId: z.string().min(1).max(128), tagId: z.string().min(1).max(128) }))
            .max(MAX_ROWS)
            .optional(),
          subtasks: rows,
          habits: rows,
          habitLogs: rows,
          habitSchedules: rows,
          gcalLinks: rows,
          habitImports: rows,
          events: rows,
          reminders: rows,
          goals: rows,
          finAccounts: rows,
          finCategories: rows,
          finTransactions: rows,
          finBudgets: rows,
          finGoals: rows,
          finRecurring: rows,
          finTags: rows,
          noteCategories: rows,
          notes: rows,
          // `settings` viaja en el fichero por compatibilidad, pero nunca se
          // aplica: importar ajustes ajenos permitiría, por ejemplo, sustituir
          // el hash del PIN por uno conocido por el atacante.
          settings: z.any().optional(),
        }),
        replace: z.boolean().optional(),
      }),
      body
    );

    // Las filas financieras pasan por los esquemas estrictos (importes enteros,
    // fechas válidas, enums): un saldo corrupto es peor que un rechazo.
    for (const c of FINANCE_COLLECTIONS) {
      (data[c] ?? []).forEach((r, i) => {
        const res = FINANCE_ROW_SCHEMAS[c].safeParse(stripDangerousKeys(r));
        if (!res.success) {
          throw new ApiError(400, `Copia no válida: ${c}[${i}] ${res.error.issues[0]?.path.join(".")}: ${res.error.issues[0]?.message}`);
        }
      });
    }

    // Las notas también: su contenido enriquecido debe venir ya saneado.
    for (const c of ["noteCategories", "notes"] as const) {
      (data[c] ?? []).forEach((r, i) => {
        const res = NOTE_ROW_SCHEMAS[c].safeParse(stripDangerousKeys(r));
        if (!res.success) {
          throw new ApiError(400, `Copia no válida: ${c}[${i}] ${res.error.issues[0]?.path.join(".")}: ${res.error.issues[0]?.message}`);
        }
      });
    }

    mutate((db) => {
      if (replace) {
        db.notes = [];
        db.noteCategories = [];
        db.categories = [];
        db.tags = [];
        db.tasks = [];
        db.taskTags = [];
        db.subtasks = [];
        db.habits = [];
        db.habitLogs = [];
        db.habitSchedules = [];
        db.gcalLinks = [];
        db.habitImports = [];
        db.events = [];
        db.reminders = [];
        db.goals = [];
        for (const c of FINANCE_COLLECTIONS) (db as any)[c] = [];
      }
      const upsert = <T extends { id: string }>(rows: T[], incoming: any[]) => {
        for (const item of incoming) {
          const { tags: _tags, category: _category, ...rest } = stripDangerousKeys(item);
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
      upsert(db.subtasks, data.subtasks ?? []);
      upsert(db.habits, data.habits ?? []);
      upsert(db.habitLogs, data.habitLogs ?? []);
      upsert(db.habitSchedules, data.habitSchedules ?? []);
      upsert(db.gcalLinks, data.gcalLinks ?? []);
      upsert(db.habitImports, data.habitImports ?? []);
      upsert(db.events, data.events ?? []);
      upsert(db.reminders, data.reminders ?? []);
      upsert(db.goals, data.goals ?? []);
      for (const c of FINANCE_COLLECTIONS) upsert(db[c] as { id: string }[], data[c] ?? []);
      upsert(db.noteCategories, data.noteCategories ?? []);
      upsert(db.notes, data.notes ?? []);
      // Filas de versiones anteriores: rellena los campos nuevos.
      for (const t of db.tasks) {
        t.recurrence ??= null;
        t.recurrenceInterval ??= 1;
        t.seriesId ??= null;
        t.goalId ??= null;
      }
      for (const g of db.goals) {
        g.source ??= "manual";
        g.finGoalId ??= null;
      }
      // Copias anteriores a las etiquetas financieras.
      ensureOwnerTags(db);
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
