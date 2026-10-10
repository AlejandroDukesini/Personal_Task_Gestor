// Base de datos local del navegador. Reemplaza al servidor Express + Prisma:
// misma forma de datos que el esquema de Prisma (las fechas viajan como ISO,
// igual que las serializaba Express) para que la capa de rutas no cambie.

import { __resetStorageForTests, configureStorage, createRestorePoint, openStorage, persistDb, type StorageInfo } from "./storage";
import type { EventRecurrence } from "@/types";

const STORAGE_KEY = "gestion-tareas:db";
/** Copia íntegra del guardado anterior a cada migración (ver `migrate`). */
const BACKUP_KEY_PREFIX = "gestion-tareas:db:backup-v";
export const DB_VERSION = 6;

export interface SettingsRow {
  id: number;
  theme: string;
  skin: string;
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
  notificationsEnabled: boolean;
  habitReminderTime: string | null;
  dailyDigestTime: string | null;
  /** Moneda por defecto de las cuentas nuevas (ISO 4217). */
  currency: string;
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

export type TaskRecurrence = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

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
  /** Repetición: null = tarea única. */
  recurrence: TaskRecurrence | null;
  /** Cada cuántas unidades de `recurrence` se repite (>= 1). */
  recurrenceInterval: number;
  /** Id de la primera tarea de la serie: une las ocurrencias entre sí. */
  seriesId: string | null;
  /** Objetivo al que contribuye al completarse (ver `GoalRow.source = "tasks"`). */
  goalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTagRow {
  taskId: string;
  tagId: string;
}

/** Sub-paso / ítem de checklist de una tarea. */
export interface SubtaskRow {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
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
  /** Unidad de la meta diaria ("vasos", "min"…). null = veces. */
  unit?: string | null;
  /** Mostrar sus horarios en el calendario interno (por defecto sí). */
  showInCalendar?: boolean;
  /** Incluir sus horarios en la sincronización con Google Calendar. */
  gcalSync?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Origen de un cambio en el contador: hace trazable toda acción automática. */
export type HabitLogSource = "manual" | "calendar" | "import" | "dashboard";

export interface HabitLogTrail {
  at: string;
  op: "inc" | "dec" | "set";
  /** Valor del contador tras la operación. */
  value: number;
  source: HabitLogSource;
  /** Referencia externa (p. ej. id de la importación que lo registró). */
  ref?: string;
}

export interface HabitLogRow {
  id: string;
  habitId: string;
  date: string;
  /** Veces realizadas ese día (total real, puede superar la meta). */
  count: number;
  note: string | null;
  /**
   * Meta diaria vigente cuando se registró ese día. Cambiar la meta del hábito
   * NO reescribe los días pasados. Ausente en registros de versiones previas
   * (ver `services/habits/progress.ts#logTarget`).
   */
  target?: number;
  /** Últimas operaciones sobre el contador (acotado). */
  trail?: HabitLogTrail[];
  createdAt: string;
  /** Sin él, cambiar el contador de un día era invisible para la sincronización. */
  updatedAt?: string;
}

/**
 * Programación de un hábito: UNA regla horaria. Se guarda la regla, no las
 * ocurrencias (se calculan al leer), así que un hábito semanal no acumula
 * eventos futuros. Varias horas en un mismo día = varias filas. Separada del
 * historial (`habitLogs`): aparecer en el calendario nunca cuenta como hecho.
 */
export interface HabitScheduleRow {
  id: string;
  habitId: string;
  /** `once`: una fecha concreta · `recurring`: se repite según `freq`. */
  kind: "once" | "recurring";
  freq: "daily" | "weekly" | "monthly";
  /** Cada cuántos días/semanas/meses (>= 1). */
  interval: number;
  /** 0 = domingo … 6 = sábado (solo `weekly`). */
  daysOfWeek: number[];
  /** "HH:mm" en la zona `timezone`. */
  startTime: string;
  endTime: string | null;
  /** `YYYY-MM-DD` (en `once`, la fecha del evento). */
  startDate: string;
  endDate: string | null;
  /** Zona IANA en la que se interpretan las horas. */
  timezone: string;
  active: boolean;
  /** Al desactivar: desde qué día (`YYYY-MM-DD`) deja de generar ocurrencias. */
  inactiveFrom: string | null;
  createdAt: string;
  updatedAt: string;
}

export type GcalLinkState =
  | "pending"
  | "synced"
  | "error"
  | "conflict"
  | "remote_changed"
  | "remote_deleted"
  | "pending_delete";

/**
 * Vínculo programación ↔ evento de Google Calendar. Id determinista por
 * programación: dos dispositivos conectados a la misma cuenta comparten el
 * vínculo (y el id del evento) en lugar de crear dos eventos.
 */
export interface GcalLinkRow {
  id: string;
  scheduleId: string;
  habitId: string;
  calendarId: string;
  eventId: string;
  etag: string | null;
  /** Huella de los campos horarios la última vez que ambos lados coincidieron. */
  syncedHash: string | null;
  /** `updated` del evento remoto en ese momento. */
  remoteUpdated: string | null;
  syncedAt: string | null;
  state: GcalLinkState;
  lastError: string | null;
  /** Resumen legible de la versión remota en conflicto. */
  remote: Record<string, unknown> | null;
  /** Solo en `pending_delete`: qué hacer en Google. */
  deleteMode: "future" | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Registro de un evento confirmado desde una captura. Su id es una huella de
 * (hábito, fecha, hora, título): importar dos veces la misma captura no
 * duplica nada. No guarda la imagen.
 */
export interface HabitImportRow {
  id: string;
  habitId: string | null;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  /** `scheduled`: solo estaba previsto · `done`: el usuario confirmó que lo hizo. */
  action: "scheduled" | "done" | "ignored";
  /** Veces sumadas al contador (0 si no se registró realización). */
  counted: number;
  /** Huella SHA-256 de la imagen (no la imagen): avisa de reimportaciones. */
  imageHash: string | null;
  confidence: number;
  createdAt: string;
  updatedAt: string;
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
  /** Opcional: los guardados anteriores no lo tienen (= no se repite). */
  recurrence?: EventRecurrence | null;
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
  updatedAt?: string;
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
  /**
   * De dónde sale `currentValue`: `manual` (lo teclea el usuario), `tasks`
   * (tareas completadas vinculadas a este objetivo) o `finance` (lo ahorrado en
   * la meta de ahorro `finGoalId`). Los dos últimos se calculan al leer.
   */
  source: "manual" | "tasks" | "finance";
  finGoalId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ----------------------------------------------------------------- finanzas
 * Importes SIEMPRE en unidades menores enteras (céntimos): la aritmética con
 * enteros es exacta, la de coma flotante no (0.1 + 0.2 !== 0.3).
 *
 * Los saldos NO se guardan: se derivan de `initialBalance` + movimientos. Así
 * es imposible que dos dispositivos acaben con saldos distintos teniendo los
 * mismos movimientos, y editar o borrar un movimiento ya sincronizado no
 * exige "reajustar" nada.
 */

export type FinAccountType =
  | "cash"
  | "bank"
  | "savings"
  | "credit_card"
  | "wallet"
  | "investment"
  | "other";

export interface FinAccountRow {
  id: string;
  name: string;
  type: FinAccountType;
  currency: string;
  initialBalance: number;
  description: string | null;
  color: string;
  icon: string;
  archived: boolean;
  /** Si cuenta para el saldo total (p. ej. excluir una cuenta compartida). */
  includeInTotal: boolean;
  createdAt: string;
  updatedAt: string;
}

export type FinCategoryKind = "income" | "expense" | "both";

export interface FinCategoryRow {
  id: string;
  name: string;
  kind: FinCategoryKind;
  color: string;
  icon: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * - `income`: entra dinero de fuera.       amount > 0
 * - `expense`: sale dinero hacia fuera.    amount > 0
 * - `transfer`: mueve dinero entre cuentas propias; NO es ingreso ni gasto.
 *   `toAmount` solo difiere de `amount` si las monedas son distintas.
 * - `adjustment`: corrección explícita del saldo, con signo y motivo.
 */
export type FinTxKind = "income" | "expense" | "transfer" | "adjustment";

/**
 * Parte de un movimiento destinada a una finalidad (etiqueta financiera).
 *
 * Vive DENTRO de la fila del movimiento, no en una tabla aparte: la
 * sincronización resuelve la fila entera, así que es imposible que una fusión
 * produzca asignaciones que sumen más que el propio movimiento. Asignar no
 * mueve dinero entre cuentas: solo dice a qué se destina.
 *
 * - `assign`: dinero que se destina a la finalidad (un ingreso apartado,
 *   una aportación).
 * - `use`: dinero que se gasta con cargo a ella (un gasto del presupuesto,
 *   una retirada de la meta).
 */
export interface FinAllocation {
  id: string;
  tagId: string;
  /** Céntimos, > 0. */
  amount: number;
  flow: "assign" | "use";
}

/**
 * Etiqueta financiera: identifica la finalidad de un presupuesto o meta de
 * ahorro. Relación 1:1 con su dueño y id determinista (`tag-<ownerId>`): dos
 * dispositivos no pueden crear etiquetas distintas para la misma meta. Los
 * movimientos la referencian por id, así que aunque dos finalidades tengan un
 * nombre parecido nunca hay ambigüedad sobre a cuál pertenece un movimiento.
 */
export interface FinTagRow {
  id: string;
  /** Sin "#": `ViajeJapon`. Único entre las etiquetas de dueños activos. */
  name: string;
  ownerType: "budget" | "goal";
  ownerId: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinTransactionRow {
  id: string;
  kind: FinTxKind;
  amount: number;
  accountId: string;
  toAccountId: string | null;
  toAmount: number | null;
  categoryId: string | null;
  /** Fecha contable local, `YYYY-MM-DD` (sin hora: evita saltos por zona horaria). */
  date: string;
  concept: string;
  description: string | null;
  tagIds: string[];
  /**
   * Destino del dinero por finalidades. Opcional: un movimiento sin
   * asignaciones es dinero disponible sin finalidad. Nunca se rellena solo.
   */
  allocations?: FinAllocation[];
  /**
   * @deprecated Sustituido por `allocations`. Se conserva para leer filas de
   * versiones anteriores (se interpreta como una asignación a la meta).
   */
  goalId: string | null;
  /** Movimiento recurrente que lo originó (su id es determinista, ver finance). */
  recurringId: string | null;
  /** Motivo obligatorio de una corrección. */
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FinPeriod = "weekly" | "monthly" | "quarterly" | "yearly" | "custom";

export interface FinBudgetRow {
  id: string;
  name: string;
  description: string | null;
  /** `spending`: tope de gasto. `saving`: aportación mínima a ahorrar. */
  kind: "spending" | "saving";
  amount: number;
  currency: string;
  categoryIds: string[];
  accountIds: string[];
  period: FinPeriod;
  startDate: string;
  endDate: string | null;
  status: "active" | "paused" | "archived";
  /** Porcentaje (1-100) a partir del cual se avisa. */
  alertPercent: number;
  createdAt: string;
  updatedAt: string;
}

export interface FinGoalRow {
  id: string;
  name: string;
  description: string | null;
  targetAmount: number;
  currency: string;
  startDate: string;
  deadline: string | null;
  accountIds: string[];
  icon: string;
  color: string;
  status: "active" | "paused" | "completed" | "archived";
  createdAt: string;
  updatedAt: string;
}

export type FinFrequency =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export interface FinRecurringRow {
  id: string;
  name: string;
  kind: "income" | "expense" | "transfer";
  amount: number;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  goalId: string | null;
  /** Plantilla de asignaciones que se aplica al registrar cada ocurrencia. */
  allocations?: Omit<FinAllocation, "id">[];
  frequency: FinFrequency;
  startDate: string;
  endDate: string | null;
  status: "active" | "paused" | "ended";
  /** Ocurrencias (`YYYY-MM-DD`) que el usuario decidió omitir. */
  skipped: string[];
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ notas */

/**
 * Categoría de notas. Con `parentId` es una subcategoría (un solo nivel): las
 * subcategorías solo se muestran dentro de su categoría principal.
 */
export interface NoteCategoryRow {
  id: string;
  name: string;
  color: string;
  icon: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Metadatos de un adjunto. El contenido binario NO vive aquí (la base se
 * guarda y sincroniza entera): está en el almacén de archivos de IndexedDB,
 * indexado por el SHA-256 de su contenido (`fileKey`). Dos notas con el mismo
 * archivo comparten el binario; solo se borra cuando ninguna nota lo usa.
 */
export interface NoteAttachment {
  id: string;
  fileKey: string;
  /** Nombre original saneado (sin rutas ni caracteres peligrosos). */
  name: string;
  /** Nombre o descripción personalizada. */
  label: string | null;
  /** Tipo detectado por el contenido, no el que declara el navegador. */
  kind: string;
  mime: string;
  size: number;
  addedAt: string;
}

export interface NoteRow {
  id: string;
  title: string;
  /** Resumen breve opcional (además del contenido enriquecido). */
  description: string | null;
  /** Documento ProseMirror/TipTap ya saneado (ver notes/content.ts). */
  content: unknown;
  /** Texto plano derivado del contenido: búsqueda y vista previa. */
  text: string;
  categoryId: string | null;
  subcategoryId: string | null;
  /** Color de identificación (`#rrggbb`) o null = el de la categoría. */
  color: string | null;
  icon: string;
  attachments: NoteAttachment[];
  archived: boolean;
  /** Papelera: fecha de borrado lógico; null = no está en la papelera. */
  deletedAt: string | null;
  /** Cálculos automáticos en el editor y decimales (null = automático). */
  mathEnabled: boolean;
  mathDecimals: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lápida de borrado. Sin ella, sincronizar dos dispositivos por "última
 * escritura gana" resucitaría cualquier fila borrada en A la próxima vez que B
 * enviara su copia: B no puede distinguir "nunca la tuve" de "la borraron".
 */
export interface TombstoneRow {
  collection: string;
  id: string;
  deletedAt: string;
}

export interface Db {
  version: number;
  settings: SettingsRow;
  categories: CategoryRow[];
  tags: TagRow[];
  tasks: TaskRow[];
  taskTags: TaskTagRow[];
  subtasks: SubtaskRow[];
  habits: HabitRow[];
  habitLogs: HabitLogRow[];
  habitSchedules: HabitScheduleRow[];
  gcalLinks: GcalLinkRow[];
  habitImports: HabitImportRow[];
  events: EventRow[];
  reminders: ReminderRow[];
  goals: GoalRow[];
  finAccounts: FinAccountRow[];
  finCategories: FinCategoryRow[];
  finTransactions: FinTransactionRow[];
  finBudgets: FinBudgetRow[];
  finGoals: FinGoalRow[];
  finRecurring: FinRecurringRow[];
  finTags: FinTagRow[];
  noteCategories: NoteCategoryRow[];
  notes: NoteRow[];
  tombstones: TombstoneRow[];
}

/** Colecciones que participan en la sincronización, con su clave temporal. */
export const SYNCED_COLLECTIONS = [
  "categories",
  "tags",
  "tasks",
  "subtasks",
  "habits",
  "habitLogs",
  "habitSchedules",
  "gcalLinks",
  "habitImports",
  "events",
  "reminders",
  "goals",
  "finAccounts",
  "finCategories",
  "finTransactions",
  "finBudgets",
  "finGoals",
  "finRecurring",
  "finTags",
  "noteCategories",
  "notes",
] as const;

export type SyncedCollection = (typeof SYNCED_COLLECTIONS)[number];

export const FINANCE_COLLECTIONS = [
  "finAccounts",
  "finCategories",
  "finTransactions",
  "finBudgets",
  "finGoals",
  "finRecurring",
  "finTags",
] as const satisfies readonly SyncedCollection[];

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

/* ------------------------------------------------------ reloj monotónico
 * La sincronización decide por `updatedAt` qué versión de una fila gana. Con
 * `Date.now()` a pelo, un móvil con el reloj 2 minutos atrasado perdería una
 * edición hecha DESPUÉS de ver la del PC. Este reloj (un HLC simplificado)
 * nunca retrocede y, al observar marcas remotas, salta por delante de ellas:
 * toda escritura posterior a ver un dato remoto lleva una marca mayor.
 */

const CLOCK_KEY = "gestion-tareas:clock";
/** No se adoptan marcas remotas más allá de este margen: un reloj roto no arrastra al resto. */
const MAX_CLOCK_LEAD_MS = 24 * 60 * 60 * 1000;
let lastStamp = 0;

function readClock(): number {
  if (lastStamp) return lastStamp;
  try {
    lastStamp = Number(localStorage.getItem(CLOCK_KEY)) || 0;
  } catch {
    lastStamp = 0;
  }
  return lastStamp;
}

function writeClock(v: number): void {
  lastStamp = v;
  try {
    localStorage.setItem(CLOCK_KEY, String(v));
  } catch {
    /* sin almacenamiento: el reloj vive en memoria */
  }
}

export function nowIso(): string {
  const next = Math.max(Date.now(), readClock() + 1);
  writeClock(next);
  return new Date(next).toISOString();
}

/** Adelanta el reloj local tras recibir datos con marca `stampMs`. */
export function observeStamp(stampMs: number): void {
  if (!Number.isFinite(stampMs)) return;
  const capped = Math.min(stampMs, Date.now() + MAX_CLOCK_LEAD_MS);
  if (capped > readClock()) writeClock(capped);
}

/**
 * Marca de las filas de ejemplo. Es antigua a propósito: si un móvil recién
 * instalado siembra sus datos de ejemplo y se empareja, cualquier edición o
 * borrado real del PC gana siempre sobre ellos.
 */
export const SEED_STAMP = "2000-01-01T00:00:00.000Z";

/** Fecha local `YYYY-MM-DD` (no UTC: a las 22:00 en Bogotá ya es "mañana" en UTC). */
export function localDateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
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
    skin: "default",
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
    notificationsEnabled: false,
    habitReminderTime: null,
    dailyDigestTime: null,
    currency: "COP",
    updatedAt: new Date().toISOString(),
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
    subtasks: [],
    habits: [],
    habitLogs: [],
    habitSchedules: [],
    gcalLinks: [],
    habitImports: [],
    events: [],
    reminders: [],
    goals: [],
    finAccounts: [],
    finCategories: [],
    finTransactions: [],
    finBudgets: [],
    finGoals: [],
    finRecurring: [],
    finTags: [],
    noteCategories: [],
    notes: [],
    tombstones: [],
  };
}

/* ------------------------------------------------------------- migraciones
 * Cada migración lleva el guardado de la versión N-1 a la N. Se ejecutan en
 * orden y solo las pendientes. Antes de migrar se guarda una copia íntegra del
 * JSON original: si una migración tuviera un error, los datos del usuario
 * siguen recuperables (ver `listDbBackups`).
 */

type RawDb = Record<string, any>;

interface Migration {
  version: number;
  description: string;
  up: (db: RawDb) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    description: "Sub-pasos de tareas, lápidas de sincronización y ajustes de avisos",
    up: (db) => {
      db.subtasks ??= [];
      db.tombstones ??= [];
    },
  },
  {
    version: 3,
    description: "Módulo de finanzas, tareas recurrentes y vínculos entre módulos",
    up: (db) => {
      for (const k of FINANCE_COLLECTIONS) db[k] ??= [];
      for (const t of db.tasks ?? []) {
        t.recurrence ??= null;
        t.recurrenceInterval ??= 1;
        t.seriesId ??= null;
        t.goalId ??= null;
      }
      for (const g of db.goals ?? []) {
        g.source ??= "manual";
        g.finGoalId ??= null;
      }
      for (const l of db.habitLogs ?? []) l.updatedAt ??= l.createdAt;
      if (db.finCategories.length === 0) db.finCategories = defaultFinCategories();
    },
  },
  {
    version: 4,
    description: "Etiquetas financieras obligatorias en presupuestos y metas; asignaciones por finalidad",
    up: (db) => {
      db.finTags ??= [];
      ensureOwnerTags(db as Db);
      // Los movimientos antiguos con `goalId` NO se reescriben: se leen como
      // asignaciones (ver finance/calc `allocationsOf`). Reescribirlos
      // cambiaría su contenido con la misma marca y un dispositivo sin
      // actualizar podría quedarse con otra versión de la misma fila.
    },
  },
  {
    version: 5,
    description: "Módulo de notas: notas, categorías y subcategorías de notas",
    up: (db) => {
      // Solo añade colecciones nuevas: no toca ningún dato existente.
      db.notes ??= [];
      db.noteCategories ??= [];
      if (db.noteCategories.length === 0) db.noteCategories = defaultNoteCategories();
    },
  },
  {
    version: 6,
    description: "Hábitos: metas cuantificables, programación horaria, Google Calendar e importación de capturas",
    up: (db) => {
      // Solo colecciones nuevas. Los hábitos y registros existentes NO se
      // reescriben: los campos nuevos se interpretan al leer con valores por
      // defecto (ver services/habits/progress.ts). Reescribirlos con la misma
      // marca dejaría a un dispositivo sin actualizar con otra versión.
      db.habitSchedules ??= [];
      db.gcalLinks ??= [];
      db.habitImports ??= [];
    },
  },
];

/* ------------------------------------------------ etiquetas financieras */

const STOPWORDS = new Set([
  "a", "al", "de", "del", "el", "la", "las", "los", "un", "una", "unos", "unas",
  "y", "e", "o", "u", "para", "por", "en", "con", "mi", "mis", "su", "sus", "the", "of", "for",
]);

/**
 * Nombre de etiqueta a partir de un texto libre:
 * "Viaje a Japón" -> "ViajeJapon", "Fondo de emergencia" -> "FondoEmergencia".
 * Sin tildes ni símbolos, en PascalCase y como mucho 30 caracteres.
 */
export function slugTag(text: string): string {
  const words = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^#/, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const kept = words.filter((w, i) => i === 0 || !STOPWORDS.has(w.toLowerCase()));
  const out = kept.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return out.slice(0, 30) || "Finalidad";
}

/** Clave de comparación: sin tildes ni mayúsculas. */
export function tagKey(name: string): string {
  return slugTag(name).toLowerCase();
}

export function tagIdForOwner(ownerId: string): string {
  return `tag-${ownerId}`.slice(0, 128);
}

/** ¿El dueño de la etiqueta admite nuevas asignaciones? */
export function tagOwnerActive(db: Pick<Db, "finBudgets" | "finGoals">, tag: FinTagRow): boolean {
  const owner =
    tag.ownerType === "budget"
      ? db.finBudgets.find((b) => b.id === tag.ownerId)
      : db.finGoals.find((g) => g.id === tag.ownerId);
  return !!owner && (owner.status === "active" || owner.status === "paused");
}

/** Nombre libre de colisiones con las etiquetas de dueños activos. */
export function uniqueTagName(db: Pick<Db, "finTags" | "finBudgets" | "finGoals">, wanted: string, exceptId?: string): string {
  const base = slugTag(wanted);
  const taken = new Set(
    db.finTags.filter((t) => t.id !== exceptId && tagOwnerActive(db, t)).map((t) => t.name.toLowerCase())
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, 27)}${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base.slice(0, 20)}${Date.now().toString(36)}`;
}

/**
 * Garantiza que todo presupuesto y meta tenga su etiqueta. Determinista (id y
 * marcas derivados del dueño, orden estable): dos dispositivos que la ejecuten
 * sobre los mismos datos producen exactamente las mismas filas.
 */
export function ensureOwnerTags(db: Db): number {
  db.finTags ??= [];
  const has = new Set(db.finTags.map((t) => t.ownerId));
  const owners = [
    ...db.finGoals.map((g) => ({ type: "goal" as const, id: g.id, name: g.name, color: g.color, createdAt: g.createdAt })),
    ...db.finBudgets.map((b) => ({ type: "budget" as const, id: b.id, name: b.name, color: "#6366f1", createdAt: b.createdAt })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  let created = 0;
  for (const o of owners) {
    if (has.has(o.id)) continue;
    db.finTags.push({
      id: tagIdForOwner(o.id),
      name: uniqueTagName(db, o.name),
      ownerType: o.type,
      ownerId: o.id,
      color: o.color,
      createdAt: o.createdAt,
      updatedAt: o.createdAt,
    });
    has.add(o.id);
    created++;
  }
  return created;
}

/** Aplica las migraciones pendientes sobre un guardado ya parseado. */
export function migrate(raw: RawDb): Db {
  const from = Number(raw.version) || 1;
  for (const m of MIGRATIONS) {
    if (m.version > from) m.up(raw);
  }
  return {
    ...emptyDb(),
    ...raw,
    settings: { ...defaultSettings(), ...raw.settings },
    // Un guardado de una versión MÁS NUEVA de la app (otro dispositivo ya
    // actualizado) no se rebaja: se conservan sus campos tal cual.
    version: Math.max(from, DB_VERSION),
  } as Db;
}

/** Copias previas a migraciones, de la más reciente a la más antigua. */
export function listDbBackups(): { key: string; version: number; size: number }[] {
  const out: { key: string; version: number; size: number }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(BACKUP_KEY_PREFIX)) continue;
      out.push({
        key,
        version: Number(key.slice(BACKUP_KEY_PREFIX.length)) || 0,
        size: localStorage.getItem(key)?.length ?? 0,
      });
    }
  } catch {
    /* sin acceso al almacenamiento */
  }
  return out.sort((a, b) => b.version - a.version);
}

/** Categorías de notas iniciales. Ids fijos: dos dispositivos no las duplican. */
export function defaultNoteCategories(): NoteCategoryRow[] {
  const c = (id: string, name: string, color: string, icon: string): NoteCategoryRow => ({
    id: `notecat-${id}`,
    name,
    color,
    icon,
    parentId: null,
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
  });
  return [
    c("personal", "Personal", "#6366f1", "User"),
    c("work", "Trabajo", "#f59e0b", "Briefcase"),
    c("study", "Estudios", "#0ea5e9", "GraduationCap"),
    c("ideas", "Ideas", "#eab308", "Lightbulb"),
    c("finance", "Finanzas", "#16a34a", "Wallet"),
    c("projects", "Proyectos", "#8b5cf6", "FolderKanban"),
  ];
}

/** Categorías financieras iniciales. Ids fijos: dos dispositivos no las duplican. */
export function defaultFinCategories(): FinCategoryRow[] {
  const c = (
    id: string,
    name: string,
    kind: FinCategoryKind,
    color: string,
    icon: string
  ): FinCategoryRow => ({
    id: `fincat-${id}`,
    name,
    kind,
    color,
    icon,
    archived: false,
    createdAt: SEED_STAMP,
    updatedAt: SEED_STAMP,
  });
  return [
    c("food", "Alimentación", "expense", "#f97316", "Utensils"),
    c("housing", "Vivienda", "expense", "#8b5cf6", "Home"),
    c("utilities", "Servicios", "expense", "#0ea5e9", "Zap"),
    c("transport", "Transporte", "expense", "#3b82f6", "Car"),
    c("health", "Salud", "expense", "#10b981", "HeartPulse"),
    c("education", "Educación", "expense", "#6366f1", "GraduationCap"),
    c("entertainment", "Entretenimiento", "expense", "#ec4899", "Gamepad2"),
    c("subscriptions", "Suscripciones", "expense", "#a855f7", "Repeat"),
    c("shopping", "Compras", "expense", "#f59e0b", "ShoppingBag"),
    c("debt", "Deudas y comisiones", "expense", "#ef4444", "CreditCard"),
    c("other-expense", "Otros gastos", "expense", "#64748b", "CircleEllipsis"),
    c("salary", "Salario", "income", "#16a34a", "Briefcase"),
    c("extra-income", "Ingresos adicionales", "income", "#22c55e", "Sparkles"),
    c("investment-income", "Rendimientos", "income", "#14b8a6", "TrendingUp"),
    c("savings", "Ahorro", "both", "#0d9488", "PiggyBank"),
    c("other-income", "Otros ingresos", "income", "#84cc16", "CircleEllipsis"),
  ];
}

let cache: Db | null = null;

// La capa de almacenamiento necesita leer la memoria (para guardar siempre lo
// último) y sustituirla cuando otra pestaña guardó algo o hubo que fusionar.
configureStorage({
  current: () => cache,
  replace: (next) => {
    cache = migrate(structuredClone(next) as RawDb);
    for (const fn of listeners) {
      try {
        fn("remote");
      } catch {
        /* ignorado a propósito */
      }
    }
    // Las vistas releen (mismo evento que la sincronización entre dispositivos).
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("gt:sync-applied"));
    }
  },
});

/* --------------------------------------------------------- observabilidad */

type ChangeListener = (origin: DbOrigin) => void;
/** `local`: lo escribió esta pestaña. `remote`: llegó por sincronización. */
export type DbOrigin = "local" | "remote";

const listeners = new Set<ChangeListener>();

/**
 * Notifica cada escritura. Lo usa el cliente de sincronización para publicar
 * cambios sin que cada handler de `localApi` tenga que acordarse de hacerlo.
 */
export function onDbChange(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function loadDb(): Db {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RawDb;
      const from = Number(parsed.version) || 1;
      if (from < DB_VERSION) {
        // Salvaguarda antes de migrar. Si no cabe se migra igualmente (no
        // migrar dejaría la app inservible), pero se intenta siempre.
        try {
          localStorage.setItem(`${BACKUP_KEY_PREFIX}${from}`, raw);
        } catch {
          /* cuota llena */
        }
      }
      cache = migrate(parsed);
      if (from < DB_VERSION) saveDb(cache);
      return cache;
    }
  } catch {
    // Guardado corrupto: se descarta y se empieza con datos de ejemplo.
  }
  cache = seed(emptyDb());
  saveDb(cache);
  return cache;
}

/**
 * Arranque asíncrono (navegador): abre IndexedDB, migra si hace falta
 * —guardando antes un punto de restauración— y deja la base en memoria.
 * Después, `loadDb` es síncrono como siempre.
 */
export async function bootDb(): Promise<StorageInfo> {
  const { raw, info } = await openStorage();
  if (raw) {
    const from = Number(raw.version) || 1;
    let backedUp = true;
    if (from < DB_VERSION) {
      try {
        await createRestorePoint(raw, `Antes de actualizar los datos de v${from} a v${DB_VERSION}`, "pre-action");
      } catch {
        backedUp = false;
      }
    }
    // Se migra una COPIA: el original sigue intacto en el almacenamiento.
    cache = migrate(structuredClone(raw));
    // Sin copia verificada, la versión migrada no se guarda todavía: el
    // original sigue en disco hasta el próximo cambio del usuario (las
    // migraciones solo añaden campos, así que es la misma información).
    if (from < DB_VERSION && backedUp) saveDb(cache);
  } else {
    // Solo se siembran datos de ejemplo si no hay NADA que recuperar
    // (almacenamiento principal, espejo, copia antigua ni puntos de restauración).
    cache = seed(emptyDb());
    saveDb(cache);
  }
  return info;
}

export function saveDb(db: Db, origin: DbOrigin = "local"): void {
  const previous = cache;
  cache = db;
  try {
    persistDb(db);
  } catch {
    // Si no se pudo guardar, la memoria vuelve al estado anterior: la app no
    // debe mostrar datos (p. ej. una importación) que no están persistidos.
    cache = previous;
    throw new ApiError(
      507,
      "No hay espacio en el almacenamiento del navegador. Exporta una copia y elimina datos antiguos."
    );
  }
  // Un suscriptor que falle no puede tumbar la escritura, que ya está hecha.
  for (const fn of listeners) {
    try {
      fn(origin);
    } catch {
      /* ignorado a propósito */
    }
  }
}

/**
 * Lee, muta y persiste en una sola operación.
 *
 * Es atómica respecto a errores: se trabaja sobre una copia, así que si `fn`
 * lanza a mitad (validación, referencia rota) la base queda intacta. Sin esto,
 * una importación que fallara en la fila 500 dejaría 499 filas aplicadas.
 */
export function mutate<T>(fn: (db: Db) => T): T {
  const draft = structuredClone(loadDb());
  const result = fn(draft);
  saveDb(draft);
  return result;
}

/**
 * Registra el borrado de una fila para que la sincronización no la resucite.
 * Debe llamarse en TODA ruta DELETE que toque una colección sincronizada.
 */
export function tombstone(db: Db, collection: SyncedCollection, id: string): void {
  const at = nowIso();
  const existing = db.tombstones.find((t) => t.collection === collection && t.id === id);
  if (existing) existing.deletedAt = at;
  else db.tombstones.push({ collection, id, deletedAt: at });
}

/** Descarta lápidas antiguas: pasado el margen, ya no hay réplica que las necesite. */
export function pruneTombstones(db: Db, maxAgeDays = 90): void {
  const cutoff = Date.now() - maxAgeDays * 86400000;
  db.tombstones = db.tombstones.filter((t) => new Date(t.deletedAt).getTime() >= cutoff);
}

/** Reemplaza la base completa (usado al aplicar un merge de sincronización). */
export function replaceDb(next: Db, origin: DbOrigin = "remote"): void {
  saveDb({ ...emptyDb(), ...next, version: Math.max(next.version ?? 0, DB_VERSION) }, origin);
}

/** Olvida la copia en memoria (sin tocar lo guardado): la próxima lectura va al almacenamiento. */
export function dropCache(): void {
  cache = null;
  lastStamp = 0;
}

export function resetDb(): void {
  cache = null;
  lastStamp = 0;
  localStorage.removeItem(STORAGE_KEY);
  __resetStorageForTests();
}

/** Datos de ejemplo: equivale al seed.ts que corría el servidor. */
function seed(db: Db): Db {
  // Ids fijos + marca antigua: si un segundo dispositivo siembra lo mismo y se
  // empareja, las filas coinciden en vez de duplicarse (ver SEED_STAMP).
  const ts = SEED_STAMP;
  let n = 0;
  const seedId = (kind: string) => `seed-${kind}-${++n}`;
  const cat = (name: string, color: string, icon: string, parentId: string | null = null): CategoryRow => ({
    id: seedId("category"),
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

  const urgente: TagRow = { id: seedId("tag"), name: "Urgente", color: "#ef4444", icon: null };
  const importante: TagRow = { id: seedId("tag"), name: "Importante", color: "#f59e0b", icon: null };
  db.tags = [urgente, importante];

  const task = (over: Partial<TaskRow>): TaskRow => ({
    id: seedId("task"),
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
    recurrence: null,
    recurrenceInterval: 1,
    seriesId: null,
    goalId: null,
    createdAt: ts,
    updatedAt: ts,
    ...over,
  });

  const t1 = task({
    title: "Revisar el plan del mes",
    // La descripción admite Markdown básico: se renderiza en el detalle.
    description:
      "Planificar objetivos **personales** y *profesionales* del mes en curso.\n\n" +
      "- Revisar el backlog\n- Cerrar pendientes de la semana\n\n" +
      "Consulta el `README.md` antes de empezar.",
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

  const step = (taskId: string, title: string, done: boolean, position: number): SubtaskRow => ({
    id: seedId("subtask"),
    taskId,
    title,
    done,
    position,
    createdAt: ts,
    updatedAt: ts,
  });
  db.subtasks = [
    step(t2.id, "Recopilar métricas de la semana", true, 0),
    step(t2.id, "Redactar el resumen ejecutivo", true, 1),
    step(t2.id, "Revisar gráficas", false, 2),
    step(t2.id, "Enviar por correo", false, 3),
  ];

  const habit = (over: Partial<HabitRow>): HabitRow => ({
    id: seedId("habit"),
    name: "",
    description: null,
    color: "#10b981",
    icon: "Activity",
    frequency: "daily",
    daysOfWeek: null,
    dailyTarget: 1,
    weeklyTarget: null,
    startDate: new Date().toISOString(),
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
      id: seedId("goal"),
      title: "Completar 100 tareas este mes",
      description: null,
      type: "monthly",
      targetValue: 100,
      currentValue: 12,
      unit: "tareas",
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 25 * 86400000).toISOString(),
      categoryId: null,
      completed: false,
      source: "manual",
      finGoalId: null,
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
      id: seedId("event"),
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

  db.finCategories = defaultFinCategories();
  db.noteCategories = defaultNoteCategories();

  return db;
}
