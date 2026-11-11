import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDot, Clock, Hourglass, PauseCircle, Sparkles } from "lucide-react";
import { api } from "@/services/api";
import type { GoalView } from "@/services/personalGoals/routes";
import { PHASE_LABEL, type GoalPhase } from "@/services/personalGoals/logic";
import { cn } from "@/lib/utils";

export interface GoalsResult {
  today: string;
  items: GoalView[];
  years: number[];
  categories: string[];
  counts: { active: number; archived: number };
}

/** Metas personales (activas o archivadas). Se releen tras cada cambio y al sincronizar. */
export function usePersonalGoals(archived: boolean) {
  const [data, setData] = useState<GoalsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api.get<GoalsResult>(`/personal-goals${archived ? "?archived=1" : ""}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las metas");
    }
  }, [archived]);
  useEffect(() => {
    load();
    window.addEventListener("gt:sync-applied", load);
    return () => window.removeEventListener("gt:sync-applied", load);
  }, [load]);
  return { data, error, reload: load };
}

export const PHASE_STYLE: Record<GoalPhase, { cls: string; icon: typeof Clock }> = {
  completed: { cls: "text-success bg-success/10", icon: CheckCircle2 },
  overdue: { cls: "text-danger bg-danger/10", icon: AlertTriangle },
  paused: { cls: "text-subtle bg-muted", icon: PauseCircle },
  starting_soon: { cls: "text-primary bg-primary/10", icon: Sparkles },
  future: { cls: "text-subtle bg-muted", icon: Hourglass },
  ending_soon: { cls: "text-warning bg-warning/10", icon: Clock },
  running: { cls: "text-primary bg-primary/10", icon: CircleDot },
};

export function PhaseBadge({ phase, className }: { phase: GoalPhase; className?: string }) {
  const s = PHASE_STYLE[phase];
  return (
    <span className={cn("gt-pill inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium whitespace-nowrap", s.cls, className)}>
      <s.icon size={12} aria-hidden /> {PHASE_LABEL[phase]}
    </span>
  );
}

/** «18 de octubre de 2027». */
export function longDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
}
