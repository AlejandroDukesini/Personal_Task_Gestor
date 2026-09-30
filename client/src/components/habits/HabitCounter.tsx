import { useState } from "react";
import toast from "react-hot-toast";
import { Check, Minus, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Progress } from "@/components/ui/Progress";
import { api } from "@/services/api";
import type { HabitDayProgress } from "@/types";
import { cn } from "@/lib/utils";

type Source = "manual" | "calendar" | "dashboard";

const fmtPercent = (p: number) => `${p.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`;

export function unitLabel(unit: string | null | undefined, target: number): string {
  return unit?.trim() || (target === 1 ? "vez" : "veces");
}

/**
 * Registro de realizaciones de un día. Meta 1: un clic completa (como antes).
 * Meta > 1: cada clic suma una vez; se puede restar un clic erróneo o fijar
 * la cantidad a mano. La barra nunca pasa del 100 % aunque el total sí.
 */
export function HabitCounter({
  habitId,
  color,
  unit,
  progress,
  date,
  source = "manual",
  compact = false,
  onChanged,
}: {
  habitId: string;
  color: string;
  unit: string | null;
  progress: HabitDayProgress;
  /** ISO del día; por defecto hoy. */
  date?: string;
  source?: Source;
  compact?: boolean;
  onChanged: (p: HabitDayProgress) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [manual, setManual] = useState(String(progress.count));
  const day = date ?? startOfToday();
  const binary = progress.target === 1;
  const isToday = !date || new Date(date).toDateString() === new Date().toDateString();

  async function change(body: { delta?: number; count?: number }) {
    setBusy(true);
    try {
      await api.post(`/habits/${habitId}/logs`, { date: day, source, ...body });
      const next = await api.get<HabitDayProgress>(`/habits/${habitId}/progress?date=${encodeURIComponent(day)}`);
      onChanged(next);
      if (!progress.done && next.done) toast.success("¡Meta del día cumplida!");
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo guardar el registro");
    } finally {
      setBusy(false);
    }
  }

  const label = `${progress.count}/${progress.target} ${unitLabel(unit, progress.target)}`;

  if (binary && !editing) {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <Button
            variant={progress.done ? "secondary" : "primary"}
            className="flex-1"
            loading={busy}
            onClick={() => change(progress.done ? { delta: -1 } : { delta: 1 })}
            aria-pressed={progress.done}
          >
            {progress.done ? (
              <>
                <Check size={15} /> Hecho{progress.count > 1 ? ` (${progress.count})` : ""} · Desmarcar
              </>
            ) : compact ? (
              "Hecho"
            ) : isToday ? (
              "Marcar como hecho hoy"
            ) : (
              "Marcar como hecho ese día"
            )}
          </Button>
          {progress.done && (
            <Button variant="outline" size="icon" disabled={busy} onClick={() => change({ delta: 1 })} aria-label="Registrar una vez más" title="Registrar una vez más">
              <Plus size={15} />
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium tabular-nums" aria-live="polite">
          {label}
        </span>
        <span className={cn("text-xs tabular-nums", progress.done ? "text-success font-medium" : "text-subtle")}>
          {progress.done ? "Completado" : fmtPercent(progress.percent)}
        </span>
      </div>
      <Progress value={progress.percent} color={color} />
      {editing ? (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const n = Number(manual);
            if (!Number.isInteger(n) || n < 0 || n > 10000) {
              toast.error("Introduce un número entero entre 0 y 10000");
              return;
            }
            await change({ count: n });
            setEditing(false);
          }}
        >
          <Input type="number" inputMode="numeric" min={0} max={10000} value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Cantidad realizada" autoFocus />
          <Button type="submit" loading={busy}>
            Guardar
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button variant="outline" size="icon" disabled={busy || progress.count === 0} onClick={() => change({ delta: -1 })} aria-label="Restar una realización" title="Restar una (corregir)">
            <Minus size={15} />
          </Button>
          <Button className="flex-1" loading={busy} onClick={() => change({ delta: 1 })} style={progress.done ? undefined : { background: color }}>
            <Plus size={15} /> {compact ? "+1" : `Registrar 1 ${unit?.trim() ? unit : "vez"}`}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={() => {
              setManual(String(progress.count));
              setEditing(true);
            }}
            aria-label="Introducir cantidad"
            title="Introducir cantidad"
          >
            <Pencil size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}

export function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
