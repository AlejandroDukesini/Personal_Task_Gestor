import { useEffect, useMemo, useRef } from "react";
import { Check } from "lucide-react";
import type { GoalView } from "@/services/personalGoals/routes";
import type { GoalPhase } from "@/services/personalGoals/logic";
import { buildTimeline } from "@/services/personalGoals/timeline";
import { cn } from "@/lib/utils";
import { PhaseBadge } from "./shared";

interface Props {
  goals: GoalView[];
  today: string;
  /** Fases resaltadas (vacío = todas). Las demás se atenúan, no desaparecen. */
  highlight: Set<GoalPhase>;
  lineColor: string;
  onOpen: (g: GoalView) => void;
  /** Al montar, llevar la vista a «hoy». */
  scrollToToday?: boolean;
}

const dayMonth = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("es", { day: "numeric", month: "short" });
const full = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/**
 * Línea del tiempo vertical a la izquierda, dividida por años. Cada meta
 * aparece en su fecha objetivo con una bola de su color, la fecha resaltada,
 * su nombre y una conexión con su tarjeta. «Hoy» se marca en su sitio.
 * Todo fluye con el documento (sin posiciones absolutas por meta): añadir
 * metas nunca rompe la disposición.
 */
export function Timeline({ goals, today, highlight, lineColor, onOpen, scrollToToday }: Props) {
  const years = useMemo(() => buildTimeline(goals, today), [goals, today]);
  const todayRef = useRef<HTMLLIElement>(null);
  const dim = (p: GoalPhase) => highlight.size > 0 && !highlight.has(p);

  useEffect(() => {
    if (scrollToToday) todayRef.current?.scrollIntoView?.({ block: "center" });
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative" style={{ ["--line" as string]: lineColor }}>
      {years.map((y) => (
        <section key={y.year} id={`anio-${y.year}`} aria-label={`Año ${y.year}`} className="relative pb-6 scroll-mt-28">
          {/* Segmento de la línea de este año: continuo con el siguiente. */}
          <span aria-hidden className="absolute left-[19px] top-0 bottom-0 w-[4px] rounded-full" style={{ background: "var(--line)", boxShadow: "0 0 0 1px rgb(var(--border))" }} />
          <h3 className="relative flex items-center gap-3 pt-2">
            <span className="relative z-[1] h-10 w-10 rounded-full flex items-center justify-center text-[11px] font-bold tabular-nums bg-surface border-2" style={{ borderColor: "var(--line)", boxShadow: "0 0 0 1px rgb(var(--border))" }}>
              {String(y.year).slice(2)}
            </span>
            <span className="gt-heading text-xl tabular-nums">{y.year}</span>
            <span className="text-xs text-subtle">{y.entries.filter((e) => e.kind === "goal").length} metas</span>
          </h3>
          <ol className="relative">
            {y.entries.map((e) => {
              if (e.kind === "today") {
                return (
                  <li key="today" ref={todayRef} id="hoy" className="relative flex items-center gap-3" style={{ marginTop: e.gap }} aria-label={`Hoy, ${full(e.date)}`}>
                    <span className="relative z-[1] w-10 flex justify-center shrink-0">
                      <span className="h-3 w-3 rotate-45 bg-primary ring-4 ring-bg" />
                    </span>
                    <span className="flex-1 border-t-2 border-dashed border-primary/70" aria-hidden />
                    <span className="text-xs font-semibold text-primary whitespace-nowrap">Hoy · {dayMonth(e.date)}</span>
                  </li>
                );
              }
              const g = e.goal;
              if (e.kind === "start") {
                return (
                  <li key={`start-${g.id}`} className={cn("relative flex items-center gap-3 text-xs text-subtle", dim(g.phase) && "opacity-40")} style={{ marginTop: e.gap }}>
                    <span className="relative z-[1] w-10 flex justify-center shrink-0">
                      <span className="h-3 w-3 rounded-full border-2 bg-surface" style={{ borderColor: g.color }} />
                    </span>
                    <button className="text-left hover:text-text truncate" onClick={() => onOpen(g)}>
                      <span className="tabular-nums">{dayMonth(e.date)}</span> · Comienza «{g.title}»
                    </button>
                  </li>
                );
              }
              const done = g.phase === "completed";
              const late = g.phase === "overdue";
              return (
                <li key={g.id} className={cn("relative flex items-center", dim(g.phase) && "opacity-40")} style={{ marginTop: e.gap }}>
                  <span className="relative z-[1] w-10 flex justify-center shrink-0">
                    <span
                      className={cn("h-5 w-5 rounded-full flex items-center justify-center ring-4 ring-bg", late && "outline outline-2 outline-offset-2 outline-danger")}
                      style={{ background: g.color, color: "#fff" }}
                      title={full(g.targetDate)}
                    >
                      {done && <Check size={12} strokeWidth={3} aria-hidden />}
                    </span>
                  </span>
                  {/* Conexión visual entre la fecha y la meta. */}
                  <span className="h-[2px] w-4 sm:w-6 shrink-0" style={{ background: g.color }} aria-hidden />
                  <button
                    onClick={() => onOpen(g)}
                    className="flex-1 min-w-0 gt-surface px-3 py-2 text-left border-l-4 hover:shadow-md transition-shadow"
                    style={{ borderLeftColor: g.color }}
                    aria-label={`${g.title}, fecha objetivo ${full(g.targetDate)}`}
                  >
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs font-bold tabular-nums px-1.5 py-0.5 rounded" style={{ background: `${g.color}22`, color: g.color }}>
                        {dayMonth(g.targetDate)}
                      </span>
                      <span className={cn("font-medium break-words", done && "line-through decoration-1 text-subtle")}>{g.title}</span>
                      <PhaseBadge phase={g.phase} className="ml-auto" />
                    </span>
                    <span className="mt-1.5 flex items-center gap-2">
                      <span className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden" aria-hidden>
                        <span className="block h-full rounded-full" style={{ width: `${g.progress}%`, background: g.color }} />
                      </span>
                      <span className="text-[11px] tabular-nums text-subtle w-9 text-right">{g.progress} %</span>
                      <span className="text-[11px] text-subtle whitespace-nowrap hidden sm:inline">{g.timeLeft}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
