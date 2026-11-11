import { useState } from "react";
import { Archive, ArchiveRestore, CheckCircle2, Flag, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Badge } from "@/components/ui/Badge";
import { ActionMenu, MenuItem, ProgressBar } from "@/components/projects/shared";
import { api } from "@/services/api";
import type { PersonalGoalRow } from "@/services/localDb";
import type { GoalView } from "@/services/personalGoals/routes";
import { runAction } from "@/lib/runAction";
import { cn } from "@/lib/utils";
import { GoalForm } from "./GoalForm";
import { longDay, PhaseBadge, usePersonalGoals } from "./shared";

/**
 * Proyectos › Personal: metas personales. Lista con su fase respecto a hoy,
 * avance y acciones; las archivadas se consultan aparte.
 */
export function PersonalGoals() {
  const [archived, setArchived] = useState(false);
  const { data, error, reload } = usePersonalGoals(archived);
  const [editing, setEditing] = useState<PersonalGoalRow | "new" | null>(null);

  const act = (fn: () => Promise<unknown>, msg: string) => runAction(fn, msg, reload);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="tablist" aria-label="Metas">
          {([false, true] as const).map((a) => (
            <button key={String(a)} role="tab" aria-selected={archived === a} onClick={() => setArchived(a)} className={cn("h-9 px-3 rounded-md text-sm", archived === a ? "bg-primary/10 text-primary font-medium" : "text-subtle hover:bg-muted hover:text-text")}>
              {a ? "Archivadas" : "Metas"} {data && <span className="tabular-nums text-xs opacity-80">{a ? data.counts.archived : data.counts.active}</span>}
            </button>
          ))}
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus size={16} /> Nueva meta
        </Button>
      </div>

      {error ? (
        <Card>
          <Empty title="No se pudieron cargar las metas" description={error} action={<Button onClick={reload}>Reintentar</Button>} />
        </Card>
      ) : !data ? (
        <div className="flex justify-center py-12" role="status" aria-label="Cargando metas">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-40" />
        </div>
      ) : data.items.length === 0 ? (
        <Card>
          <Empty
            icon={Flag}
            title={archived ? "No hay metas archivadas" : "Aún no tienes metas personales"}
            description={archived ? undefined : "Registra lo que quieres lograr y su fecha objetivo: comprar una moto, un viaje, aprender un idioma…"}
            action={!archived && <Button onClick={() => setEditing("new")}><Plus size={16} /> Crear meta</Button>}
          />
        </Card>
      ) : (
        <GoalList items={data.items} onEdit={setEditing} act={act} />
      )}

      <GoalForm open={!!editing} goal={editing === "new" ? null : editing} categories={data?.categories ?? []} onClose={() => setEditing(null)} onSaved={() => reload()} />
    </div>
  );
}

export function GoalList({ items, onEdit, act, onOpen }: { items: GoalView[]; onEdit: (g: PersonalGoalRow) => void; act: (fn: () => Promise<unknown>, msg: string) => Promise<boolean>; onOpen?: (g: GoalView) => void }) {
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {items.map((g) => (
        <li key={g.id} className={cn("gt-surface p-4 flex flex-col gap-2 border-l-4", onOpen && "cursor-pointer hover:shadow-md transition-shadow")} style={{ borderLeftColor: g.color }} onClick={() => onOpen?.(g)}>
          <div className="flex items-start gap-2">
            <span className="h-3 w-3 rounded-full mt-1.5 shrink-0" style={{ background: g.color }} aria-hidden />
            <span className="flex-1 min-w-0 font-medium leading-snug break-words">{g.title}</span>
            <span onClick={(e) => e.stopPropagation()}>
              <GoalActions goal={g} onEdit={() => onEdit(g)} act={act} />
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <PhaseBadge phase={g.phase} />
            {g.category && <Badge color={g.color}>{g.category}</Badge>}
          </div>
          <p className="text-sm">
            <span className="font-medium">{longDay(g.targetDate)}</span> <span className="text-subtle">· {g.timeLeft}</span>
          </p>
          <div className="flex items-center gap-2">
            <ProgressBar value={g.progress} color={g.color} label={`Avance de ${g.title}`} className="h-1.5 flex-1" />
            <span className="text-xs tabular-nums text-subtle">{g.progress} %</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function GoalActions({ goal: g, onEdit, act, after }: { goal: PersonalGoalRow; onEdit: () => void; act: (fn: () => Promise<unknown>, msg: string) => Promise<boolean>; after?: () => void }) {
  return (
    <ActionMenu label={`Acciones de ${g.title}`}>
      {g.archived ? (
        <MenuItem icon={<ArchiveRestore size={14} />} onClick={() => act(() => api.post(`/personal-goals/${g.id}/unarchive`), "Meta restaurada").then(() => after?.())}>Restaurar</MenuItem>
      ) : (
        <>
          <MenuItem icon={<Pencil size={14} />} onClick={onEdit}>Editar</MenuItem>
          {g.status !== "completed" && <MenuItem icon={<CheckCircle2 size={14} />} onClick={() => act(() => api.put(`/personal-goals/${g.id}`, { status: "completed" }), "¡Meta completada!")}>Marcar como completada</MenuItem>}
          <MenuItem icon={<Archive size={14} />} onClick={() => act(() => api.post(`/personal-goals/${g.id}/archive`), "Meta archivada").then(() => after?.())}>Archivar</MenuItem>
        </>
      )}
      <MenuItem icon={<Trash2 size={14} />} danger onClick={() => confirm(`¿Eliminar la meta «${g.title}» definitivamente? Se guardará antes una copia de seguridad automática.`) && act(() => api.delete(`/personal-goals/${g.id}`), "Meta eliminada").then(() => after?.())}>Eliminar</MenuItem>
    </ActionMenu>
  );
}
