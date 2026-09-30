export type TaskRecurrence = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
export type Priority = "low" | "medium" | "high" | "critical";
export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type HabitFrequency = "daily" | "weekly" | "monthly" | "custom";
export type GoalType = "daily" | "weekly" | "monthly" | "yearly";
export type Theme = "light" | "dark" | "system";
/** Lenguaje visual. Cada valor tiene un bloque de tokens en `themes/skins.css`. */
export type Skin = "default" | "brutalist" | "glass" | "terminal";

export interface Category {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
  description?: string | null;
  parentId?: string | null;
  children?: Category[];
  _count?: { tasks: number; habits: number };
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  /** Admite Markdown básico (ver `components/Markdown.tsx`). */
  description?: string | null;
  priority: Priority;
  status: TaskStatus;
  /**
   * 0-100. Si la tarea tiene sub-pasos, el servidor local lo deriva del
   * porcentaje de sub-pasos completados y el valor manual se ignora.
   */
  progress: number;
  subtasks: Subtask[];
  startDate?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  notes?: string | null;
  position: number;
  categoryId?: string | null;
  category?: Category | null;
  tags: Tag[];
  reminders: Reminder[];
  completedAt?: string | null;
  recurrence?: TaskRecurrence | null;
  recurrenceInterval?: number;
  seriesId?: string | null;
  goalId?: string | null;
  goal?: Goal | null;
  createdAt: string;
  updatedAt: string;
}

export interface HabitLog {
  id: string;
  habitId: string;
  date: string;
  count: number;
  note?: string | null;
}

export interface HabitDayProgress {
  date: string;
  /** Veces realizadas (total real, puede superar la meta). */
  count: number;
  target: number;
  /** 0-100, nunca mayor de 100. */
  percent: number;
  done: boolean;
}

export interface HabitStats {
  streak: number;
  best: number;
  successRate: number;
  last30: { date: string; done: boolean; count: number; target: number }[];
  today: HabitDayProgress;
}

export interface HabitSchedule {
  id: string;
  habitId: string;
  kind: "once" | "recurring";
  freq: "daily" | "weekly" | "monthly";
  interval: number;
  /** 0 = domingo … 6 = sábado. */
  daysOfWeek: number[];
  startTime: string;
  endTime: string | null;
  startDate: string;
  endDate: string | null;
  timezone: string;
  active: boolean;
  inactiveFrom: string | null;
  createdAt: string;
  updatedAt: string;
}

export type OccurrenceStatus = "scheduled" | "pending" | "in_progress" | "completed" | "partial" | "missed";

export interface HabitOccurrence {
  id: string;
  scheduleId: string;
  habitId: string;
  dateKey: string;
  start: string;
  end: string | null;
  recurring: boolean;
  status: OccurrenceStatus;
  logDate: string;
  count: number;
  target: number;
  threshold: number;
  habit: { id: string; name: string; color: string; icon?: string | null; unit: string | null; dailyTarget: number };
}

/** Una celda del mapa de contribuciones. `level` 0-4, como en GitHub. */
export interface HeatmapCell {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface HabitHeatmapData {
  habitId: string;
  color: string;
  dailyTarget: number;
  total: number;
  cells: HeatmapCell[];
}

export interface Habit {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  frequency: HabitFrequency;
  daysOfWeek?: string | null;
  dailyTarget: number;
  weeklyTarget?: number | null;
  startDate: string;
  endDate?: string | null;
  categoryId?: string | null;
  category?: Category | null;
  archived: boolean;
  /** Unidad de la meta ("vasos", "min"…). null = veces. */
  unit: string | null;
  showInCalendar: boolean;
  gcalSync: boolean;
  schedules: HabitSchedule[];
  logs: HabitLog[];
  stats: HabitStats;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: string;
  title: string;
  description?: string | null;
  start: string;
  end: string;
  allDay: boolean;
  color?: string | null;
  location?: string | null;
  categoryId?: string | null;
  category?: Category | null;
}

export interface Reminder {
  id: string;
  triggerAt: string;
  minutesBefore?: number | null;
  type: "in_app" | "banner" | "sound";
  delivered: boolean;
  taskId?: string | null;
  habitId?: string | null;
  eventId?: string | null;
}

export interface Goal {
  id: string;
  title: string;
  description?: string | null;
  type: GoalType;
  targetValue: number;
  currentValue: number;
  unit?: string | null;
  startDate: string;
  endDate: string;
  categoryId?: string | null;
  category?: Category | null;
  completed: boolean;
  /** manual: valor tecleado · tasks: tareas completadas vinculadas · finance: meta de ahorro. */
  source?: "manual" | "tasks" | "finance";
  finGoalId?: string | null;
  linkedTasks?: number;
}

export interface Settings {
  id: number;
  theme: Theme;
  skin: Skin;
  language: string;
  dateFormat: string;
  primaryColor: string;
  fontScale: number;
  appName: string;
  appLogo?: string | null;
  userName?: string | null;
  timezone: string;
  pinEnabled: boolean;
  pinSet: boolean;
  /** El usuario concedió el permiso de notificaciones y las quiere activas. */
  notificationsEnabled: boolean;
  /** "HH:mm" — aviso diario de rutina de hábitos. null = desactivado. */
  habitReminderTime: string | null;
  /** "HH:mm" — resumen diario de tareas pendientes. null = desactivado. */
  dailyDigestTime: string | null;
  currency?: string;
}

export interface Stats {
  totalTasks: number;
  completedToday: number;
  pendingTasks: number;
  completedThisWeek: number;
  activeHabits: number;
  dailyCompletion: { date: string; count: number }[];
  habitDaily: { date: string; count: number; total: number }[];
}
