import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const bigint = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `${(bigint >> 16) & 255} ${(bigint >> 8) & 255} ${bigint & 255}`;
}

// Aclara un color hacia el blanco (mezcla lineal). Se usa para derivar la
// variante del color primario en modo oscuro, garantizando contraste AA
// (>= 4.5:1) del texto/enlaces primarios sobre superficies oscuras.
export function lightenHexToRgb(hex: string, amount = 0.25): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `${mix((n >> 16) & 255)} ${mix((n >> 8) & 255)} ${mix(n & 255)}`;
}

export function priorityColor(p: string) {
  switch (p) {
    case "critical": return "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30";
    case "high": return "bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30";
    case "medium": return "bg-amber-400/15 text-amber-600 dark:text-amber-400 border border-amber-400/30";
    default: return "bg-slate-400/15 text-slate-600 dark:text-slate-300 border border-slate-400/20";
  }
}

export function priorityLabel(p: string) {
  return { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" }[p] ?? p;
}

export function statusLabel(s: string) {
  return {
    pending: "Pendiente",
    in_progress: "En progreso",
    completed: "Completada",
    cancelled: "Cancelada",
  }[s] ?? s;
}

/**
 * Las fechas "de día" (vencimientos, inicio) se guardan como medianoche UTC
 * del día elegido (`2026-09-27T00:00:00.000Z`). Leídas con `new Date()` en
 * una zona con desfase negativo (Bogotá, UTC-5) caían en el día ANTERIOR: se
 * mostraba "26 sept" para una tarea del 27. Aquí se reconstruye el día local.
 */
export function asLocalDay(d: string): Date {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
}

export function formatDate(d?: string | null) {
  if (!d) return "";
  return asLocalDay(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(d?: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Vencida cuando ha pasado la hora límite, o el día completo si no tiene hora. */
export function isOverdue(dueDate?: string | null, status?: string, dueTime?: string | null) {
  if (!dueDate || status === "completed" || status === "cancelled") return false;
  const due = asLocalDay(dueDate);
  if (dueTime && /^\d{2}:\d{2}$/.test(dueTime)) {
    const [h, m] = dueTime.split(":").map(Number);
    due.setHours(h, m, 0, 0);
  } else {
    due.setHours(23, 59, 59, 999);
  }
  return due.getTime() < Date.now();
}

export function relativeDay(d?: string | null) {
  if (!d) return "";
  const date = asLocalDay(d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  if (diff === -1) return "Ayer";
  if (diff > 1 && diff < 7) return `En ${diff} días`;
  if (diff < -1 && diff > -7) return `Hace ${-diff} días`;
  return formatDate(d);
}
