export type Priority = "low" | "medium" | "high" | "critical";
export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type HabitFrequency = "daily" | "weekly" | "monthly" | "custom";
export type GoalType = "daily" | "weekly" | "monthly" | "yearly";
export type Theme = "light" | "dark" | "system";

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

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  priority: Priority;
  status: TaskStatus;
  progress: number;
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

export interface HabitStats {
  streak: number;
  best: number;
  successRate: number;
  last30: { date: string; done: boolean }[];
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
}

export interface Settings {
  id: number;
  theme: Theme;
  language: string;
  dateFormat: string;
  primaryColor: string;
  fontScale: number;
  pinEnabled: boolean;
  pinSet: boolean;
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
