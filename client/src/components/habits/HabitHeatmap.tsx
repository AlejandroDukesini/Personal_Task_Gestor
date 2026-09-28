import { useMemo } from "react";
import { useResource } from "@/hooks/useResource";
import { api } from "@/services/api";
import type { HabitHeatmapData, HeatmapCell } from "@/types";

const DAY_LABELS = ["", "L", "", "X", "", "V", ""];
const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Opacidad por nivel: la celda usa el color del hábito, no una escala fija. */
const LEVEL_ALPHA: Record<number, number> = { 0: 0, 1: 0.3, 2: 0.55, 3: 0.8, 4: 1 };

/**
 * Mapa de contribuciones al estilo GitHub.
 *
 * El servidor local ya devuelve una rejilla continua alineada a domingo, así
 * que aquí basta con trocearla en columnas de 7 — no hay aritmética de
 * calendario en el render.
 */
export function HabitHeatmap({
  habitId,
  color,
  days = 364,
}: {
  habitId: string;
  color: string;
  days?: number;
}) {
  const { data, loading } = useResource(
    () => api.get<HabitHeatmapData>(`/habits/${habitId}/heatmap?days=${days}`),
    [habitId, days]
  );

  const weeks = useMemo(() => {
    if (!data) return [];
    const out: HeatmapCell[][] = [];
    for (let i = 0; i < data.cells.length; i += 7) out.push(data.cells.slice(i, i + 7));
    return out;
  }, [data]);

  // Etiqueta de mes sobre la primera semana en la que ese mes aparece.
  const monthLabels = useMemo(() => {
    const labels: { index: number; label: string }[] = [];
    let last = -1;
    weeks.forEach((week, i) => {
      const month = new Date(week[0].date).getMonth();
      if (month !== last) {
        labels.push({ index: i, label: MONTHS[month] });
        last = month;
      }
    });
    return labels;
  }, [weeks]);

  if (loading || !data) {
    return <div className="h-[92px] rounded-md bg-muted/50 animate-pulse" aria-hidden />;
  }

  return (
    <figure className="space-y-2">
      <figcaption className="sr-only">
        Registro diario de los últimos {days} días: {data.total} marca(s).
      </figcaption>

      {/* Scroll horizontal propio: en móvil la rejilla no debe ensanchar la página. */}
      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <div className="inline-flex flex-col gap-1 min-w-min">
          {/* Cabecera de meses */}
          <div className="flex gap-[3px] pl-[18px] h-3">
            {weeks.map((_, i) => {
              const label = monthLabels.find((m) => m.index === i);
              return (
                <span
                  key={i}
                  className="w-[11px] text-[9px] text-subtle leading-none whitespace-nowrap"
                >
                  {label?.label ?? ""}
                </span>
              );
            })}
          </div>

          <div className="flex gap-[3px]">
            {/* Columna de días de la semana */}
            <div className="flex flex-col gap-[3px] w-[15px] shrink-0">
              {DAY_LABELS.map((d, i) => (
                <span key={i} className="h-[11px] text-[9px] text-subtle leading-[11px]">
                  {d}
                </span>
              ))}
            </div>

            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((cell) => {
                  const date = new Date(cell.date);
                  const future = date.getTime() > Date.now();
                  return (
                    <span
                      key={cell.date}
                      title={`${date.toLocaleDateString("es-ES", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })} — ${cell.count} de ${data.dailyTarget}`}
                      className="h-[11px] w-[11px] rounded-[2px] border border-border/40"
                      style={{
                        backgroundColor:
                          cell.level === 0
                            ? "rgb(var(--muted))"
                            : hexWithAlpha(color, LEVEL_ALPHA[cell.level]),
                        opacity: future ? 0.25 : 1,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-subtle">
        <span>{data.total} registro(s)</span>
        <span className="ml-auto flex items-center gap-1">
          Menos
          {[0, 1, 2, 3, 4].map((l) => (
            <span
              key={l}
              className="h-[10px] w-[10px] rounded-[2px] border border-border/40"
              style={{
                backgroundColor:
                  l === 0 ? "rgb(var(--muted))" : hexWithAlpha(color, LEVEL_ALPHA[l]),
              }}
            />
          ))}
          Más
        </span>
      </div>
    </figure>
  );
}

/** #rrggbb + alpha -> rgba(). El color del hábito lo elige el usuario en hex. */
function hexWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgb(var(--primary) / ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
