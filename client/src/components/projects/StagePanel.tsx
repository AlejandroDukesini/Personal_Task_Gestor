import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Eye, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { Markdown } from "@/components/Markdown";
import type { ProjectStage } from "@/services/localDb";
import { normalizePercent, stageState, STAGE_STATE_LABEL } from "@/services/projects/progress";
import { cn } from "@/lib/utils";
import { ProgressBar } from "./shared";

export type StagePatch = Partial<Pick<ProjectStage, "title" | "description" | "progress">>;

interface Props {
  stage: ProjectStage;
  index: number;
  total: number;
  color: string;
  readOnly: boolean;
  /** Cambio local inmediato (el contenedor lo pinta y lo guarda con retardo). */
  onChange: (patch: StagePatch) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
  onBack: () => void;
}

/**
 * Detalle editable de una etapa. El porcentaje se ve al instante (también el
 * total del proyecto) y se guarda agrupado: arrastrar el deslizador no
 * escribe en cada paso.
 */
export function StagePanel({ stage, index, total, color, readOnly, onChange, onMove, onDelete, onBack }: Props) {
  const [title, setTitle] = useState(stage.title);
  const [percentText, setPercentText] = useState(String(stage.progress));
  const [percentError, setPercentError] = useState<string | null>(null);
  const [editingText, setEditingText] = useState(!stage.description && !readOnly);
  // Último avance antes de completarla: reabrir lo recupera (o 0 si no hay).
  const lastOpen = useRef<number | null>(stage.progress < 100 ? stage.progress : null);
  const slider = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPercentText(String(stage.progress));
    if (stage.progress < 100) lastOpen.current = stage.progress;
  }, [stage.progress]);
  // Cambios llegados de fuera (sincronización) mientras no se está escribiendo.
  useEffect(() => {
    if (document.activeElement?.getAttribute("data-stage-title") !== stage.id) setTitle(stage.title);
  }, [stage.title, stage.id]);

  const state = stageState(stage.progress);
  const setProgress = (p: number) => {
    setPercentError(null);
    if (p !== stage.progress) onChange({ progress: p });
  };

  function commitPercent() {
    const p = normalizePercent(percentText);
    if (p === null) {
      setPercentError("Escribe un número entre 0 y 100.");
      setPercentText(String(stage.progress));
      return;
    }
    const raw = Number(percentText.replace(",", "."));
    setPercentError(raw !== p ? `Ajustado a ${p} % (el valor debe ser un entero entre 0 y 100).` : null);
    setPercentText(String(p));
    if (p !== stage.progress) onChange({ progress: p });
  }

  return (
    <section className="gt-surface p-4 space-y-5" aria-label={`Etapa ${stage.title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onBack} className="h-9 px-2 -ml-2 inline-flex items-center gap-1 rounded-md text-sm text-subtle hover:text-text hover:bg-muted">
          <ArrowLeft size={16} /> <span className="lg:hidden">Etapas</span>
          <span className="hidden lg:inline">Información del proyecto</span>
        </button>
        <span className="text-xs text-subtle">
          Etapa {index + 1} de {total} · {STAGE_STATE_LABEL[state]}
        </span>
        {!readOnly && (
          <div className="ml-auto flex items-center gap-1">
            <IconBtn label="Subir etapa" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp size={16} />
            </IconBtn>
            <IconBtn label="Bajar etapa" disabled={index === total - 1} onClick={() => onMove(1)}>
              <ArrowDown size={16} />
            </IconBtn>
            <IconBtn label="Eliminar etapa" danger onClick={onDelete}>
              <Trash2 size={16} />
            </IconBtn>
          </div>
        )}
      </div>

      <div>
        {readOnly ? (
          <h2 className="gt-heading text-xl break-words">{stage.title}</h2>
        ) : (
          <>
            <input
              aria-label="Título de la etapa"
              data-stage-title={stage.id}
              value={title}
              maxLength={200}
              aria-invalid={!title.trim() || undefined}
              onChange={(e) => {
                setTitle(e.target.value);
                // Un título vacío no se guarda: se avisa y se conserva el anterior.
                if (e.target.value.trim()) onChange({ title: e.target.value.trim() });
              }}
              className={cn("w-full bg-transparent gt-heading text-xl outline-none border-b border-transparent focus:border-border", !title.trim() && "border-danger")}
            />
            {!title.trim() && <p className="text-xs text-danger mt-1">El título es obligatorio; se mantiene «{stage.title}».</p>}
          </>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <label htmlFor={`pct-${stage.id}`} className="text-xs font-medium text-subtle uppercase tracking-wide">
            Progreso de la etapa
          </label>
          <span className="gt-heading text-2xl tabular-nums" style={{ color }} aria-live="polite">
            {stage.progress} %
          </span>
        </div>
        {readOnly ? (
          <ProgressBar value={stage.progress} color={color} label="Progreso de la etapa" />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <input
                ref={slider}
                id={`pct-${stage.id}`}
                type="range"
                min={0}
                max={100}
                step={1}
                value={stage.progress}
                onChange={(e) => setProgress(Number(e.target.value))}
                className="flex-1 h-2 cursor-pointer"
                style={{ accentColor: color }}
              />
              <div className="flex items-center gap-1">
                <input
                  aria-label="Porcentaje exacto"
                  inputMode="numeric"
                  className="gt-field h-9 w-16 px-2 text-sm text-right tabular-nums"
                  value={percentText}
                  onChange={(e) => setPercentText(e.target.value)}
                  onBlur={commitPercent}
                  onKeyDown={(e) => e.key === "Enter" && commitPercent()}
                />
                <span className="text-sm text-subtle">%</span>
              </div>
            </div>
            {percentError && (
              <p role="alert" className="text-xs text-warning">
                {percentError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {state === "done" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setProgress(lastOpen.current ?? 0);
                    slider.current?.focus();
                  }}
                >
                  <RotateCcw size={14} /> Reabrir etapa
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setProgress(100)}>
                  <CheckCircle2 size={14} /> Marcar como completada
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-subtle uppercase tracking-wide">Descripción</span>
          {!readOnly && (
            <button className="inline-flex items-center gap-1 h-8 px-2 rounded-md text-xs text-subtle hover:bg-muted hover:text-text" onClick={() => setEditingText((v) => !v)}>
              {editingText ? (
                <>
                  <Eye size={14} /> Vista previa
                </>
              ) : (
                <>
                  <Pencil size={14} /> Editar
                </>
              )}
            </button>
          )}
        </div>
        {editingText && !readOnly ? (
          <>
            <Textarea
              aria-label="Descripción de la etapa"
              className="min-h-[180px]"
              maxLength={20000}
              value={stage.description ?? ""}
              onChange={(e) => onChange({ description: e.target.value || null })}
              placeholder={"Qué incluye, criterios de terminado, notas…\nAdmite Markdown: **negrita**, - listas, [enlaces](https://…)"}
            />
            <p className="text-xs text-subtle">Se guarda solo mientras escribes. Cambiar la descripción no altera el porcentaje.</p>
          </>
        ) : stage.description?.trim() ? (
          <div className="gt-field px-3 py-2">
            <Markdown>{stage.description}</Markdown>
          </div>
        ) : (
          <p className="text-sm text-subtle">Sin descripción.</p>
        )}
      </div>

      <p className="text-[11px] text-subtle">
        Creada {new Date(stage.createdAt).toLocaleString()} · Modificada {new Date(stage.updatedAt).toLocaleString()}
      </p>
    </section>
  );
}

function IconBtn({ label, onClick, danger, disabled, children }: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label} className={cn("h-9 w-9 inline-flex items-center justify-center rounded-md text-subtle hover:bg-muted disabled:opacity-40 disabled:pointer-events-none", danger ? "hover:text-danger" : "hover:text-text")}>
      {children}
    </button>
  );
}
