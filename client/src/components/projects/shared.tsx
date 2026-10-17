import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, MoreVertical, PauseCircle, PlayCircle } from "lucide-react";
import type { ProjectStatus } from "@/services/localDb";
import type { Deadline } from "@/services/projects/query";
import { NoteIcon } from "@/components/notes/NoteIcon";
import { cn } from "@/lib/utils";

export const STATUS_META: Record<ProjectStatus, { label: string; icon: typeof PlayCircle; cls: string; action: string }> = {
  active: { label: "Activo", icon: PlayCircle, cls: "text-success bg-success/10", action: "Reactivar" },
  inactive: { label: "Inactivo", icon: PauseCircle, cls: "text-subtle bg-muted", action: "Pausar" },
  finished: { label: "Finalizado", icon: CheckCircle2, cls: "text-primary bg-primary/10", action: "Marcar como finalizado" },
};

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("gt-pill inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium", m.cls, className)}>
      <m.icon size={12} aria-hidden /> {m.label}
    </span>
  );
}

export function DeadlineBadge({ deadline }: { deadline: Deadline }) {
  if (!deadline) return null;
  return deadline === "overdue" ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-danger" title="La fecha final prevista ya pasó">
      <AlertTriangle size={12} aria-hidden /> Vencido
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-warning" title="La fecha final prevista está cerca">
      <Clock size={12} aria-hidden /> Vence pronto
    </span>
  );
}

export function ProjectAvatar({ icon, color, size = "md" }: { icon: string; color: string; size?: "sm" | "md" | "lg" }) {
  const box = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-12 w-12" }[size];
  return (
    <span className={cn(box, "rounded-lg flex items-center justify-center shrink-0")} style={{ background: `${color}22`, color }}>
      <NoteIcon name={icon} size={size === "lg" ? 24 : size === "md" ? 19 : 16} />
    </span>
  );
}

/** «12 oct 2026» a partir de una fecha local `YYYY-MM-DD` (sin saltos por zona horaria). */
export function formatDay(day: string | null): string {
  if (!day) return "—";
  return new Date(`${day}T00:00:00`).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

/** Texto plano de una descripción en Markdown, para vistas previas de una línea. */
export function plainText(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:[-+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/[*_~`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Barra de progreso accesible con el color del proyecto. */
export function ProgressBar({ value, color, label, className }: { value: number; color: string; label: string; className?: string }) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} className={cn("w-full h-2 bg-muted rounded-full overflow-hidden", className)}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${v}%`, background: color }} />
    </div>
  );
}

/** Menú de acciones (⋮) que se cierra al hacer clic fuera o con Escape. */
export function ActionMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative shrink-0">
      <button className="h-9 w-9 inline-flex items-center justify-center rounded-md text-subtle hover:bg-muted" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-20 gt-surface-pop p-1 w-52" role="menu" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, icon, danger, children }: { onClick: () => void; icon: ReactNode; danger?: boolean; children: ReactNode }) {
  return (
    <button role="menuitem" onClick={onClick} className={cn("w-full flex items-center gap-2 text-left text-sm px-2 py-2 rounded hover:bg-muted", danger && "text-danger")}>
      {icon} {children}
    </button>
  );
}
