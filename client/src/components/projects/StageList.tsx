import { memo, useState } from "react";
import { DragDropContext, Draggable, Droppable, type DraggableProvidedDragHandleProps, type DropResult } from "@hello-pangea/dnd";
import { CheckCircle2, Circle, CircleDot, GripVertical, ListTodo, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { ProjectStage } from "@/services/localDb";
import { formatPercent, stageState, STAGE_STATE_LABEL, type StageState } from "@/services/projects/progress";
import { cn } from "@/lib/utils";
import { ProgressBar } from "./shared";

const STATE_ICON: Record<StageState, typeof Circle> = { pending: Circle, in_progress: CircleDot, done: CheckCircle2 };

interface Props {
  stages: ProjectStage[];
  selectedId: string | null;
  color: string;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onAdd: (title: string) => Promise<boolean>;
}

/** Panel de etapas: orden, estado y progreso de cada una; arrastrar para reordenar. */
export function StageList({ stages, selectedId, color, readOnly, onSelect, onReorder, onAdd }: Props) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  function onDragEnd(r: DropResult) {
    if (!r.destination || r.destination.index === r.source.index) return;
    const ids = stages.map((s) => s.id);
    const [moved] = ids.splice(r.source.index, 1);
    ids.splice(r.destination.index, 0, moved);
    onReorder(ids);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    if (await onAdd(draft.trim())) setDraft("");
    setBusy(false);
  }

  return (
    <div className="gt-surface p-2 space-y-2">
      <div className="flex items-center justify-between px-1 pt-1">
        <h2 className="text-sm font-medium">Etapas</h2>
        <span className="text-xs text-subtle tabular-nums">
          {stages.filter((s) => s.progress >= 100).length}/{stages.length} completadas
        </span>
      </div>
      {stages.length === 0 ? (
        <div className="flex flex-col items-center text-center gap-1 px-3 py-6 text-sm text-subtle">
          <ListTodo size={22} aria-hidden />
          <p>Aún no hay etapas.</p>
          {!readOnly && <p className="text-xs">Crea la primera: el progreso del proyecto se calcula a partir de ellas.</p>}
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="stages" isDropDisabled={readOnly}>
            {(drop) => (
              <ol ref={drop.innerRef} {...drop.droppableProps} className="space-y-1" aria-label="Etapas del proyecto">
                {stages.map((s, i) => (
                  <Draggable key={s.id} draggableId={s.id} index={i} isDragDisabled={readOnly}>
                    {(drag, snap) => (
                      <li ref={drag.innerRef} {...drag.draggableProps} className={cn("rounded-md", snap.isDragging && "gt-surface-pop shadow-lg")}>
                        <StageRow stage={s} index={i} color={color} selected={s.id === selectedId} onSelect={onSelect} handle={readOnly ? null : drag.dragHandleProps} />
                      </li>
                    )}
                  </Draggable>
                ))}
                {drop.placeholder}
              </ol>
            )}
          </Droppable>
        </DragDropContext>
      )}
      {!readOnly && (
        <form onSubmit={add} className="flex gap-1.5 pt-1">
          <Input aria-label="Título de la nueva etapa" placeholder="Nueva etapa…" maxLength={200} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button type="submit" size="icon" aria-label="Añadir etapa" loading={busy} disabled={!draft.trim()}>
            {!busy && <Plus size={16} />}
          </Button>
        </form>
      )}
    </div>
  );
}

/**
 * Fila de una etapa. Memorizada: al mover el deslizador de una etapa solo se
 * repinta su fila (las demás conservan la misma referencia).
 */
const StageRow = memo(function StageRow({ stage, index, color, selected, onSelect, handle }: { stage: ProjectStage; index: number; color: string; selected: boolean; onSelect: (id: string) => void; handle: DraggableProvidedDragHandleProps | null | undefined }) {
  const state = stageState(stage.progress);
  const Icon = STATE_ICON[state];
  return (
    <div className={cn("flex items-center gap-1 rounded-md", selected ? "bg-primary/10" : "hover:bg-muted")}>
      {handle ? (
        <span {...handle} className="h-10 w-6 shrink-0 inline-flex items-center justify-center text-subtle cursor-grab" aria-label={`Mover la etapa ${stage.title}`}>
          <GripVertical size={14} aria-hidden />
        </span>
      ) : (
        <span className="w-2" />
      )}
      <button type="button" onClick={() => onSelect(stage.id)} aria-current={selected || undefined} className="flex-1 min-w-0 text-left py-2 pr-2 space-y-1">
        <span className="flex items-center gap-1.5 text-sm">
          <Icon size={14} aria-label={STAGE_STATE_LABEL[state]} className={cn("shrink-0", state === "done" ? "text-success" : state === "in_progress" ? "text-primary" : "text-subtle")} />
          <span className="text-xs text-subtle tabular-nums">{index + 1}.</span>
          <span className={cn("truncate flex-1", selected && "font-medium", state === "done" && "text-subtle")}>{stage.title}</span>
          <span className="text-xs tabular-nums text-subtle">{formatPercent(stage.progress)}</span>
        </span>
        <ProgressBar value={stage.progress} color={color} label={`Progreso de ${stage.title}`} className="h-1" />
      </button>
    </div>
  );
});
