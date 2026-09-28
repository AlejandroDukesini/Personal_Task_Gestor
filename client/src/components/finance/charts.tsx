import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

/**
 * Colores de series (tokens `--chart-*` en index.css, con variante oscura).
 * Validados con el script de la guía de visualización: separación suficiente
 * para daltonismo (ΔE ≥ 9 entre adyacentes) en claro y oscuro. La serie 3
 * queda por debajo de 3:1 sobre fondo claro, por eso todos los gráficos llevan
 * leyenda con texto y una vista de tabla.
 *
 * Asignación fija por significado, nunca por posición:
 *   ingresos = serie 1 · gastos = serie 2 · ahorro/neto = serie 3
 */
export const SERIES = {
  income: "rgb(var(--chart-1))",
  expense: "rgb(var(--chart-2))",
  net: "rgb(var(--chart-3))",
} as const;

/**
 * Respeta "reducir movimiento" del sistema: sin él, las barras crecen desde
 * cero en cada cambio de periodo, lo que marea a quien lo tiene activado.
 */
export function useChartAnimation(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return !reduced;
}

export const axisTick = { fontSize: 11, fill: "rgb(var(--subtle))" };
export const gridStroke = "rgb(var(--border))";

export const tooltipStyle = {
  contentStyle: {
    background: "rgb(var(--surface))",
    border: "1px solid rgb(var(--border))",
    borderRadius: 8,
    fontSize: 12,
    color: "rgb(var(--text))",
  },
  labelStyle: { color: "rgb(var(--text))", fontWeight: 600 },
  itemStyle: { color: "rgb(var(--text))" },
  cursor: { fill: "rgb(var(--muted))", opacity: 0.6 },
};

export function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-subtle">
      <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

/**
 * Tarjeta de gráfico con alternancia gráfico/tabla. La tabla es la vía
 * accesible (lectores de pantalla, daltonismo, impresión) y la forma de ver
 * los números exactos sin pasar el ratón.
 */
export function ChartCard({
  title,
  legend,
  chart,
  table,
  empty,
  className,
  height = "h-64",
  actions,
}: {
  title: string;
  legend?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  empty?: boolean;
  className?: string;
  height?: string;
  actions?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={className}>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle className="text-sm sm:text-base">{title}</CardTitle>
        <div className="flex items-center gap-1">
          {actions}
          {!empty && (
            <button
              type="button"
              onClick={() => setAsTable((v) => !v)}
              className="p-1.5 rounded-md hover:bg-muted text-subtle"
              aria-label={asTable ? "Ver como gráfico" : "Ver como tabla"}
              title={asTable ? "Ver como gráfico" : "Ver como tabla"}
            >
              {asTable ? <BarChart3 size={15} /> : <Table2 size={15} />}
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="text-sm text-subtle text-center py-10">Sin datos en este periodo.</p>
        ) : asTable ? (
          <div className="max-h-72 overflow-y-auto">{table}</div>
        ) : (
          <>
            {legend && <div className="flex flex-wrap gap-3 mb-2">{legend}</div>}
            <div className={cn(height, "w-full")}>{chart}</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-subtle">
          {head.map((h, i) => (
            <th key={h} className={cn("py-1.5 font-medium", i > 0 && "text-right")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={cn("py-1.5", j > 0 && "text-right tabular-nums")}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Etiqueta corta de cubeta para ejes. */
export function bucketLabel(key: string, bucket: "day" | "week" | "month"): string {
  const d = new Date(`${key}T12:00:00`);
  if (bucket === "month") return d.toLocaleDateString("es-CO", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
}
