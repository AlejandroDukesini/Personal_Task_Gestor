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

export function formatDate(d?: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
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

export function isOverdue(dueDate?: string | null, status?: string) {
  if (!dueDate || status === "completed" || status === "cancelled") return false;
  return new Date(dueDate).getTime() < Date.now();
}

export function relativeDay(d?: string | null) {
  if (!d) return "";
  const date = new Date(d);
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
