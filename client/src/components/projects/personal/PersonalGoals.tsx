import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, CheckCircle2, CircleDot, Flag, GitCommitVertical, LayoutGrid, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Badge } from "@/components/ui/Badge";
import { ActionMenu, MenuItem, ProgressBar } from "@/components/projects/shared";
import { api } from "@/services/api";
import type { PersonalGoalRow } from "@/services/localDb";
import type { GoalView } from "@/services/personalGoals/routes";
import { PHASE_LABEL, type GoalPhase } from "@/services/personalGoals/logic";
import { runAction } from "@/lib/runAction";
import { cn } from "@/lib/utils";
import { GoalForm } from "./GoalForm";
import { GoalDetail } from "./GoalDetail";
import { Timeline } from "./Timeline";
import { longDay, PHASE_STYLE, PhaseBadge, usePersonalGoals } from "./shared";

const VIEW_KEY = "gestion-tareas:goals-view";
const LINE_KEY = "gestion-tareas:goals-line-color";
const DEFAULT_LINE = "#ffffff";

const read = (k: string, fallback: string) => {
  try {
    return localStorage.getItem(k) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sin almacenamiento: es solo una preferencia */
  }
};

const PHASE_ORDER: GoalPhase[] = ["overdue", "ending_soon", "running", "starting_soon", "future", "paused", "completed"];

/**
 * Proyectos › Personal: metas personales en una línea del tiempo vertical
 * (o en lista). La fase de cada meta respecto a hoy se resalta con la leyenda;
 * el detalle se abre en un panel lateral sin perder la línea de vista.
 */
export function PersonalGoals() {
  const [archived, setArchived] = useState(false);
  const { data, error, reload } = usePersonalGoals(archived);
  const [editing, setEditing] = useState<PersonalGoalRow | "new" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<"timeline" | "list">(() => (read(VIEW_KEY, "timeline") === "list" ? "list" : "timeline"));
  const [lineColor, setLineColor] = useState(() => read(LINE_KEY, DEFAULT_LINE));
  const [highlight, setHighlight] = useState<Set<GoalPhase>>(new Set());

  const act = (fn: () => Promise<unknown>, msg: string) => runAction(fn, msg, reload);
  const open = data?.items.find((g) => g.id === openId) ?? null;
  const counts = useMemo(() => {
    const c = new Map<GoalPhase, number>();
    for (const g of data?.items ?? []) c.set(g.phase, (c.get(g.phase) ?? 0) + 1);
    return c;
  }, [data]);

  const toggleHighlight = (p: GoalPhase) =>
    setHighlight((h) => {
      const n = new Set(h);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });

  const goYear = (id: string) => document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  const showTimeline = view === "timeline" && !archived;

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
        <div className="flex items-center gap-1">
          {!archived && (
            <>
              <button aria-label="Vista de línea del tiempo" aria-pressed={view === "timeline"} onClick={() => { setView("timeline"); write(VIEW_KEY, "timeline"); }} className={cn("h-9 w-9 rounded-md inline-flex items-center justify-center", view === "timeline" ? "bg-primary/10 text-primary" : "text-subtle hover:bg-muted")}>
                <GitCommitVertical size={16} />
              </button>
              <button aria-label="Vista de tarjetas" aria-pressed={view === "list"} onClick={() => { setView("list"); write(VIEW_KEY, "list"); }} className={cn("h-9 w-9 rounded-md inline-flex items-center justify-center", view === "list" ? "bg-primary/10 text-primary" : "text-subtle hover:bg-muted")}>
                <LayoutGrid size={16} />
              </button>
            </>
          )}
          <Button onClick={() => setEditing("new")} className="ml-1">
            <Plus size={16} /> Nueva meta
          </Button>
        </div>
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
      ) : showTimeline ? (
        <>
          {/* Leyenda: dónde estás respecto a tus metas. Pulsar resalta esa fase. */}
          <div className="flex flex-wrap gap-1.5" aria-label="Resaltar por fase">
            {PHASE_ORDER.filter((p) => counts.get(p)).map((p) => {
              const s = PHASE_STYLE[p];
              const on = highlight.has(p);
              return (
                <button key={p} onClick={() => toggleHighlight(p)} aria-pressed={on} className={cn("gt-pill inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border", s.cls, on ? "border-current" : "border-transparent")}>
                  <s.icon size={12} aria-hidden /> {PHASE_LABEL[p]} <span className="tabular-nums opacity-80">{counts.get(p)}</span>
                </button>
              );
            })}
            {highlight.size > 0 && (
              <button className="text-xs text-subtle hover:text-text px-2" onClick={() => setHighlight(new Set())}>
                Ver todas
              </button>
            )}
          </div>

          {/* Navegación temporal: saltar entre años y volver a hoy. */}
          <nav className="sticky top-14 z-10 -mx-1 px-1 py-2 bg-bg/90 backdrop-blur flex items-center gap-1 overflow-x-auto" aria-label="Años">
            <Button size="sm" variant="outline" onClick={() => goYear("hoy")}>
              <CircleDot size={14} /> Hoy
            </Button>
            {[...new Set([...data.years, Number(data.today.slice(0, 4))])].sort((a, b) => a - b).map((y) => (
              <button key={y} onClick={() => goYear(`anio-${y}`)} className="h-8 px-3 rounded-md text-sm tabular-nums text-subtle hover:bg-muted hover:text-text shrink-0">
                {y}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1.5 text-xs text-subtle shrink-0">
              Línea
              <input type="color" aria-label="Color de la línea del tiempo" value={lineColor} onChange={(e) => { setLineColor(e.target.value); write(LINE_KEY, e.target.value); }} className="h-7 w-8 p-0 border border-border rounded" />
              {lineColor !== DEFAULT_LINE && (
                <button className="hover:text-text" onClick={() => { setLineColor(DEFAULT_LINE); write(LINE_KEY, DEFAULT_LINE); }}>
                  Blanco
                </button>
              )}
            </label>
          </nav>

          <Timeline goals={data.items} today={data.today} highlight={highlight} lineColor={lineColor} onOpen={(g) => setOpenId(g.id)} scrollToToday={data.items.some((g) => g.targetDate < data.today)} />
        </>
      ) : (
        <GoalList items={data.items} onEdit={setEditing} act={act} onOpen={(g) => setOpenId(g.id)} />
      )}

      <GoalDetail goal={open} onClose={() => setOpenId(null)} reload={reload} onEdit={(g) => setEditing(g)} />
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

export function GoalActions({ goal: g, onEdit, act }: { goal: PersonalGoalRow; onEdit: () => void; act: (fn: () => Promise<unknown>, msg: string) => Promise<boolean> }) {
  return (
    <ActionMenu label={`Acciones de ${g.title}`}>
      {g.archived ? (
        <MenuItem icon={<ArchiveRestore size={14} />} onClick={() => act(() => api.post(`/personal-goals/${g.id}/unarchive`), "Meta restaurada")}>Restaurar</MenuItem>
      ) : (
        <>
          <MenuItem icon={<Pencil size={14} />} onClick={onEdit}>Editar</MenuItem>
          {g.status !== "completed" && <MenuItem icon={<CheckCircle2 size={14} />} onClick={() => act(() => api.put(`/personal-goals/${g.id}`, { status: "completed" }), "¡Meta completada!")}>Marcar como completada</MenuItem>}
          <MenuItem icon={<Archive size={14} />} onClick={() => act(() => api.post(`/personal-goals/${g.id}/archive`), "Meta archivada")}>Archivar</MenuItem>
        </>
      )}
      <MenuItem icon={<Trash2 size={14} />} danger onClick={() => confirm(`¿Eliminar la meta «${g.title}» definitivamente? Se guardará antes una copia de seguridad automática.`) && act(() => api.delete(`/personal-goals/${g.id}`), "Meta eliminada")}>Eliminar</MenuItem>
    </ActionMenu>
  );
}
