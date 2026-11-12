import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, CheckCircle2, FolderKanban, History, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SidePanel } from "@/components/ui/SidePanel";
import { ProgressBar } from "@/components/projects/shared";
import { api } from "@/services/api";
import type { GoalView } from "@/services/personalGoals/routes";
import { STATUS_LABEL } from "@/services/personalGoals/logic";
import { PRIORITY_LABEL } from "@/services/workflow/logic";
import { runAction } from "@/lib/runAction";
import { longDay, PhaseBadge } from "./shared";

interface Props {
  goal: GoalView | null;
  onClose: () => void;
  onEdit: (g: GoalView) => void;
  reload: () => void;
}

/**
 * Detalle de una meta en un panel lateral: la línea del tiempo sigue visible
 * detrás. Información completa, tiempo restante, avance (editable al
 * momento), observaciones e historial de cambios.
 */
export function GoalDetail({ goal, onClose, onEdit, reload }: Props) {
  const [progress, setProgress] = useState(0);
  const [fresh, setFresh] = useState<GoalView | null>(goal);
  const navigate = useNavigate();

  useEffect(() => {
    setFresh(goal);
    setProgress(goal?.progress ?? 0);
  }, [goal]);

  const g = fresh;
  if (!g) return <SidePanel open={false} onClose={onClose} title="">{null}</SidePanel>;

  const refresh = async () => {
    reload();
    try {
      const next = await api.get<GoalView>(`/personal-goals/${g.id}`);
      setFresh(next);
      setProgress(next.progress);
    } catch {
      onClose();
    }
  };
  const act = (fn: () => Promise<unknown>, msg: string) => runAction(fn, msg, refresh);

  const rows: [string, string][] = [
    ["Creada", new Date(g.createdAt).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })],
    ["Inicio", g.startDate ? longDay(g.startDate) : "Sin fecha de inicio"],
    ["Fecha objetivo", longDay(g.targetDate)],
    ["Tiempo restante", g.phase === "completed" ? `Completada${g.completedAt ? ` el ${new Date(g.completedAt).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}` : ""}` : g.timeLeft],
    ["Estado", STATUS_LABEL[g.status]],
    ["Prioridad", PRIORITY_LABEL[g.priority]],
  ];

  return (
    <SidePanel
      open={!!goal}
      onClose={onClose}
      width="lg"
      title={g.title}
      footer={
        g.archived ? (
          <>
            <Button variant="ghost" className="mr-auto text-danger" onClick={() => confirm(`¿Eliminar «${g.title}» definitivamente?`) && act(() => api.delete(`/personal-goals/${g.id}`), "Meta eliminada").then((ok) => ok && onClose())}>
              <Trash2 size={14} /> Eliminar
            </Button>
            <Button onClick={() => act(() => api.post(`/personal-goals/${g.id}/unarchive`), "Meta restaurada")}>
              <ArchiveRestore size={14} /> Restaurar
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" className="mr-auto text-danger" onClick={() => confirm(`¿Eliminar «${g.title}» definitivamente? Se guardará antes una copia de seguridad automática.`) && act(() => api.delete(`/personal-goals/${g.id}`), "Meta eliminada").then((ok) => ok && onClose())}>
              <Trash2 size={14} /> Eliminar
            </Button>
            <Button variant="ghost" onClick={() => act(() => api.post(`/personal-goals/${g.id}/archive`), "Meta archivada").then((ok) => ok && onClose())}>
              <Archive size={14} /> Archivar
            </Button>
            <Button variant="outline" onClick={() => onEdit(g)}>
              <Pencil size={14} /> Editar
            </Button>
          </>
        )
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-4 w-4 rounded-full" style={{ background: g.color }} aria-hidden />
          <PhaseBadge phase={g.phase} />
          {g.category && <Badge color={g.color}>{g.category}</Badge>}
          {g.archived && <Badge>Archivada</Badge>}
        </div>

        {g.description && <p className="text-sm whitespace-pre-line">{g.description}</p>}

        {g.sourceProjectId && (
          <div className="rounded-md border border-border p-3 text-sm space-y-2">
            <p className="text-subtle">
              Esta meta se creó desde un proyecto con la conversión anterior, que solo copiaba título, descripción, fechas y avance. Si el proyecto original sigue en la papelera, puedes recuperarlo completo (etapas, actividades y tareas) en Proyectos › Personal. La meta se archivará, no se borra.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                confirm("¿Recuperar el proyecto original completo en Proyectos › Personal? La meta se archivará (podrás restaurarla).") &&
                act(() => api.post(`/personal-goals/${g.id}/recover-project`), "Proyecto original recuperado en Personal").then((ok) => ok && navigate(`/proyectos/${g.sourceProjectId}`))
              }
            >
              <FolderKanban size={14} /> Recuperar proyecto original
            </Button>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-subtle">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>

        <section className="space-y-2" aria-label="Progreso">
          <div className="flex items-center justify-between text-sm">
            <span className="text-xs font-medium text-subtle uppercase tracking-wide">Progreso</span>
            <span className="font-semibold tabular-nums" style={{ color: g.color }}>{g.progress} %</span>
          </div>
          <ProgressBar value={g.progress} color={g.color} label={`Avance de ${g.title}`} />
          {!g.archived && (
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={100} step={5} value={progress} aria-label="Nuevo avance" onChange={(e) => setProgress(Number(e.target.value))} className="flex-1 accent-primary" />
              <span className="text-xs tabular-nums w-10 text-right">{progress} %</span>
              <Button size="sm" variant="outline" disabled={progress === g.progress} onClick={() => act(() => api.put(`/personal-goals/${g.id}`, { progress }), "Avance actualizado")}>
                Guardar avance
              </Button>
            </div>
          )}
          {!g.archived &&
            (g.status === "completed" ? (
              <Button size="sm" variant="ghost" onClick={() => act(() => api.put(`/personal-goals/${g.id}`, { status: "in_progress", progress: Math.min(g.progress, 95) }), "Meta reabierta")}>
                <RotateCcw size={14} /> Reabrir
              </Button>
            ) : (
              <Button size="sm" onClick={() => act(() => api.put(`/personal-goals/${g.id}`, { status: "completed" }), "¡Meta completada!")}>
                <CheckCircle2 size={14} /> Marcar como completada
              </Button>
            ))}
        </section>

        {g.observations && (
          <section>
            <h3 className="text-xs font-medium text-subtle uppercase tracking-wide mb-1">Observaciones</h3>
            <p className="text-sm whitespace-pre-line">{g.observations}</p>
          </section>
        )}

        <section>
          <h3 className="text-xs font-medium text-subtle uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <History size={13} aria-hidden /> Historial de cambios
          </h3>
          <ol className="space-y-2 border-l-2 border-border pl-3">
            {g.history.map((h, i) => (
              <li key={i} className="text-sm">
                <span className="block">{h.text}</span>
                <span className="text-xs text-subtle">{new Date(h.at).toLocaleString("es", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </SidePanel>
  );
}
