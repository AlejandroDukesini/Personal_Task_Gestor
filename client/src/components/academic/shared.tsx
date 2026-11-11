import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, Circle, CircleDot, Eye } from "lucide-react";
import { api } from "@/services/api";
import { errorMessage } from "@/components/finance/shared";
import type { AcadActivityRow, AcadClassRow, AcadSemesterRow, AcadSubjectRow } from "@/services/localDb";
import { PRIORITY_LABEL, STATE_LABEL, type AcademicOverview, type ActivityState } from "@/services/academic/logic";
import { cn } from "@/lib/utils";

export type SemesterSummary = AcadSemesterRow & { subjectCount: number; activityCount: number; classCount: number };

export interface AcademicState {
  today: string;
  semesters: SemesterSummary[];
  semester: AcadSemesterRow | null;
  subjects: AcadSubjectRow[];
  classes: AcadClassRow[];
  activities: AcadActivityRow[];
  conflicts: string[];
  overview: AcademicOverview | null;
}

/** Estado del módulo para un semestre. Se relee tras cada cambio y al sincronizar. */
export function useAcademic(semesterId: string | null) {
  const [data, setData] = useState<AcademicState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api.get<AcademicState>(`/academic${semesterId ? `?semesterId=${encodeURIComponent(semesterId)}` : ""}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [semesterId]);
  useEffect(() => {
    load();
    window.addEventListener("gt:sync-applied", load);
    return () => window.removeEventListener("gt:sync-applied", load);
  }, [load]);
  return { data, error, reload: load };
}

/** Ejecuta una acción, avisa con un mensaje discreto y recarga. */
export async function run(fn: () => Promise<unknown>, message: string, reload: () => void): Promise<boolean> {
  try {
    await fn();
    toast.success(message);
    reload();
    return true;
  } catch (e) {
    toast.error(errorMessage(e));
    return false;
  }
}

const STATE_STYLE: Record<ActivityState, { cls: string; icon: typeof Circle }> = {
  pending: { cls: "text-subtle bg-muted", icon: Circle },
  in_progress: { cls: "text-primary bg-primary/10", icon: CircleDot },
  review: { cls: "text-warning bg-warning/10", icon: Eye },
  done: { cls: "text-success bg-success/10", icon: CheckCircle2 },
  overdue: { cls: "text-danger bg-danger/10", icon: AlertTriangle },
};

export function StateBadge({ state }: { state: ActivityState }) {
  const s = STATE_STYLE[state];
  return (
    <span className={cn("gt-pill inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium", s.cls)}>
      <s.icon size={12} aria-hidden /> {STATE_LABEL[state]}
    </span>
  );
}

const PRIORITY_CLS: Record<AcadActivityRow["priority"], string> = {
  low: "text-subtle",
  medium: "text-text",
  high: "text-warning",
  critical: "text-danger",
};

export function PriorityText({ priority }: { priority: AcadActivityRow["priority"] }) {
  return <span className={cn("text-xs font-medium", PRIORITY_CLS[priority])}>Prioridad {PRIORITY_LABEL[priority].toLowerCase()}</span>;
}

/** «lun 12 oct» a partir de `YYYY-MM-DD`. */
export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" });
}

export function SubjectDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 rounded-full shrink-0", className)} style={{ background: color }} aria-hidden />;
}
