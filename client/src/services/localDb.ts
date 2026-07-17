// Base de datos local del navegador. Reemplaza al servidor Express + Prisma:
// misma forma de datos que el esquema de Prisma (las fechas viajan como ISO,
// igual que las serializaba Express) para que la capa de rutas no cambie.

const STORAGE_KEY = "gestion-tareas:db";
const DB_VERSION = 1;

export interface SettingsRow {
  id: number;
  theme: string;
  language: string;
  dateFormat: string;
  primaryColor: string;
  fontScale: number;
  appName: string;
  appLogo: string | null;
  userName: string | null;
  timezone: string;
  pinHash: string | null;
  pinEnabled: boolean;
  updatedAt: string;
}

export interface CategoryRow {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  description: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TagRow {
  id: string;
  name: string;
  color: string;
  icon: string | null;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  progress: number;
  startDate: string | null;
  dueDate: string | null;
  dueTime: string | null;
  notes: string | null;
  position: number;
  categoryId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTagRow {
  taskId: string;
  tagId: string;
}

export interface HabitRow {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  frequency: string;
  daysOfWeek: string | null;
  dailyTarget: number;
  weeklyTarget: number | null;
  startDate: string;
  endDate: string | null;
  categoryId: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HabitLogRow {
  id: string;
  habitId: string;
  date: string;
  count: number;
  note: string | null;
  createdAt: string;
}

export interface EventRow {
  id: string;
  title: string;
  description: string | null;
  start: string;
  end: string;
  allDay: boolean;
  color: string | null;
  location: string | null;
  categoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderRow {
  id: string;
  triggerAt: string;
  minutesBefore: number | null;
  type: string;
  delivered: boolean;
  taskId: string | null;
  habitId: string | null;
  eventId: string | null;
  createdAt: string;
}

export interface GoalRow {
  id: string;
  title: string;
  description: string | null;
  type: string;
  targetValue: number;
  currentValue: number;
  unit: string | null;
  startDate: string;
  endDate: string;
  categoryId: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Db {
  version: number;
  settings: SettingsRow;
  categories: CategoryRow[];
  tags: TagRow[];
  tasks: TaskRow[];
  taskTags: TaskTagRow[];
  habits: HabitRow[];
  habitLogs: HabitLogRow[];
  events: EventRow[];
  reminders: ReminderRow[];
  goals: GoalRow[];
}

/** Error con código HTTP, para que la capa de rutas responda como lo hacía Express. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function defaultSettings(): SettingsRow {
  return {
    id: 1,
    theme: "system",
    language: "es",
    dateFormat: "dd/MM/yyyy",
    primaryColor: "#6366f1",
    fontScale: 1,
    appName: "Productividad",
    appLogo: null,
    userName: null,
    timezone: "America/Bogota",
    pinHash: null,
    pinEnabled: false,
    updatedAt: nowIso(),
  };
}

function emptyDb(): Db {
  return {
    version: DB_VERSION,
    settings: defaultSettings(),
    categories: [],
    tags: [],
    tasks: [],
    taskTags: [],
    habits: [],
    habitLogs: [],
    events: [],
    reminders: [],
    goals: [],
  };
}

let cache: Db | null = null;

export function loadDb(): Db {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Db;
      // Rellena claves que falten si el guardado viene de una versión anterior.
      cache = { ...emptyDb(), ...parsed, settings: { ...defaultSettings(), ...parsed.settings } };
      return cache;
    }
  } catch {
    // Guardado corrupto: se descarta y se empieza con datos de ejemplo.
  }
  cache = seed(emptyDb());
  saveDb(cache);
  return cache;
}

export function saveDb(db: Db): void {
  cache = db;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    throw new ApiError(
      507,
      "No hay espacio en el almacenamiento del navegador. Exporta una copia y elimina datos antiguos."
    );
  }
}

/** Lee, muta y persiste en una sola operación. */
export function mutate<T>(fn: (db: Db) => T): T {
  const db = loadDb();
  const result = fn(db);
  saveDb(db);
  return result;
}

export function resetDb(): void {
  cache = null;
  localStorage.removeItem(STORAGE_KEY);
}

/** Datos de ejemplo: equivale al seed.ts que corría el servidor. */
function seed(db: Db): Db {
  const ts = nowIso();
  const cat = (name: string, color: string, icon: string, parentId: string | null = null): CategoryRow => ({
    id: newId(),
    name,
    color,
    icon,
    description: null,
    parentId,
    createdAt: ts,
    updatedAt: ts,
  });

  const personal = cat("Personal", "#6366f1", "User");
  const trabajo = cat("Trabajo", "#f59e0b", "Briefcase");
  db.categories = [
    personal,
    trabajo,
    cat("Salud", "#10b981", "Heart", personal.id),
    cat("Finanzas", "#ef4444", "Wallet", personal.id),
  ];

  const urgente: TagRow = { id: newId(), name: "Urgente", color: "#ef4444", icon: null };
  const importante: TagRow = { id: newId(), name: "Importante", color: "#f59e0b", icon: null };
  db.tags = [urgente, importante];

  const task = (over: Partial<TaskRow>): TaskRow => ({
    id: newId(),
    title: "",
    description: null,
    priority: "medium",
    status: "pending",
    progress: 0,
    startDate: null,
    dueDate: null,
    dueTime: null,
    notes: null,
    position: 0,
    categoryId: null,
    completedAt: null,
    createdAt: ts,
    updatedAt: ts,
    ...over,
  });

  const t1 = task({
    title: "Revisar el plan del mes",
    description: "Planificar objetivos personales y profesionales del mes en curso.",
    priority: "high",
    categoryId: personal.id,
    dueDate: new Date(Date.now() + 86400000).toISOString(),
  });
  const t2 = task({
    title: "Enviar reporte semanal",
    priority: "critical",
    status: "in_progress",
    progress: 60,
    categoryId: trabajo.id,
    dueDate: new Date(Date.now() + 172800000).toISOString(),
  });
  const t3 = task({ title: "Leer 30 min antes de dormir", priority: "low", categoryId: personal.id });
  db.tasks = [t1, t2, t3];
  db.taskTags = [
    { taskId: t1.id, tagId: importante.id },
    { taskId: t2.id, tagId: urgente.id },
  ];

  const habit = (over: Partial<HabitRow>): HabitRow => ({
    id: newId(),
    name: "",
    description: null,
    color: "#10b981",
    icon: "Activity",
    frequency: "daily",
    daysOfWeek: null,
    dailyTarget: 1,
    weeklyTarget: null,
    startDate: ts,
    endDate: null,
    categoryId: null,
    archived: false,
    createdAt: ts,
    updatedAt: ts,
    ...over,
  });

  db.habits = [
    habit({ name: "Beber 2L de agua", color: "#0ea5e9", icon: "Droplet", dailyTarget: 8 }),
    habit({ name: "Leer 20 min", color: "#8b5cf6", icon: "BookOpen" }),
    habit({ name: "Ejercicio", color: "#10b981", icon: "Dumbbell", frequency: "custom", daysOfWeek: "1,3,5" }),
  ];

  db.goals = [
    {
      id: newId(),
      title: "Completar 100 tareas este mes",
      description: null,
      type: "monthly",
      targetValue: 100,
      currentValue: 12,
      unit: "tareas",
      startDate: ts,
      endDate: new Date(Date.now() + 25 * 86400000).toISOString(),
      categoryId: null,
      completed: false,
      createdAt: ts,
      updatedAt: ts,
    },
  ];

  const start = new Date();
  start.setHours(15, 0, 0, 0);
  const end = new Date(start);
  end.setHours(16, 0, 0, 0);
  db.events = [
    {
      id: newId(),
      title: "Reunión de planificación",
      description: null,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: false,
      color: "#6366f1",
      location: null,
      categoryId: null,
      createdAt: ts,
      updatedAt: ts,
    },
  ];

  return db;
}
