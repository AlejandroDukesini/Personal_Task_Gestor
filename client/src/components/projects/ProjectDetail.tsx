import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowLeft, CalendarDays, Loader2, Pencil, RotateCcw, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { Markdown } from "@/components/Markdown";
import { SaveStatus, type SaveState } from "@/components/ui/SaveStatus";
import { errorMessage } from "@/components/finance/shared";
import { api } from "@/services/api";
import { localDateKey, type ProjectRow, type ProjectStatus } from "@/services/localDb";
import { formatPercent, projectProgress, stageState } from "@/services/projects/progress";
import { deadlineOf } from "@/services/projects/query";
import { cn } from "@/lib/utils";
import { ProjectForm } from "./ProjectForm";
import { StageList } from "./StageList";
import { StagePanel, type StagePatch } from "./StagePanel";
import { ActionMenu, DeadlineBadge, formatDay, MenuItem, ProgressBar, ProjectAvatar, StatusBadge, STATUS_META } from "./shared";

const SAVE_DELAY = 600;

/**
 * Detalle de un proyecto: panel de etapas a la izquierda e información (o la
 * etapa elegida) a la derecha. En el móvil, pestañas «Información» y
 * «Etapas», y cada etapa en su propia vista.
 *
 * El proyecto vive en UN estado: la lista de etapas, el panel y el progreso
 * general salen de él (el progreso se calcula con `projectProgress`), así que
 * no pueden divergir. Los cambios de etapa se pintan al momento y se guardan
 * agrupados; al salir, cambiar de proyecto u ocultar la pestaña se guarda lo
 * pendiente.
 */
export function ProjectDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [missing, setMissing] = useState(false);
  const [save, setSave] = useState<SaveState>("saved");
  const [editing, setEditing] = useState(params.get("edit") === "1");
  const [tags, setTags] = useState<string[]>([]);

  const stageId = params.get("etapa");
  const tab = params.get("tab") === "etapas" ? "stages" : "info";

  const pending = useRef(new Map<string, StagePatch>());
  const version = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const saving = useRef<Promise<boolean> | null>(null);

  const load = useCallback(async () => {
    try {
      setProject(await api.get<ProjectRow>(`/projects/${id}`));
    } catch {
      setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  /** Guarda los cambios de etapas pendientes. Nunca hay dos guardados a la vez. */
  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    if (saving.current) await saving.current;
    if (!pending.current.size) return true;
    const batch = [...pending.current.entries()];
    pending.current = new Map();
    const sent = version.current;
    setSave("saving");
    const run = (async () => {
      try {
        let server: ProjectRow | null = null;
        for (const [sid, patch] of batch) server = (await api.put<{ project: ProjectRow }>(`/projects/${id}/stages/${sid}`, patch)).project;
        if (version.current === sent && server) {
          const saved = server;
          // Se toman las marcas del guardado, pero el texto que se está
          // escribiendo sigue siendo el local (no se le quitan espacios a mitad).
          setProject((local) => (local ? { ...saved, stages: saved.stages.map((s) => { const l = local.stages.find((x) => x.id === s.id); return l ? { ...s, title: l.title, description: l.description } : s; }) } : saved));
          setSave("saved");
        } else setSave("pending");
        return true;
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 404 || status === 409) {
          // La etapa ya no existe (otro dispositivo) o el proyecto se movió a la papelera.
          toast.error(errorMessage(e));
          setSave("saved");
          load();
          return true;
        }
        for (const [sid, patch] of batch) pending.current.set(sid, { ...patch, ...pending.current.get(sid) });
        setSave("error");
        toast.error(`No se pudo guardar: ${errorMessage(e)}`);
        return false;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = run;
    return run;
  }, [id, load]);

  const changeStage = useCallback(
    (sid: string, patch: StagePatch) => {
      version.current++;
      setProject((p) => (p ? { ...p, stages: p.stages.map((s) => (s.id === sid ? { ...s, ...patch } : s)) } : p));
      pending.current.set(sid, { ...pending.current.get(sid), ...patch });
      setSave("pending");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(), SAVE_DELAY);
    },
    [flush]
  );

  // Guardar al salir: al cambiar de vista, al ocultar la pestaña y al cerrarla.
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && flush();
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!pending.current.size) return;
      flush();
      e.preventDefault();
      e.returnValue = "";
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
      flush();
    };
  }, [flush]);

  // Cambios llegados de otro dispositivo o pestaña: se recargan si aquí no hay nada pendiente.
  useEffect(() => {
    const onSync = () => {
      if (!pending.current.size && !saving.current) load();
    };
    window.addEventListener("gt:sync-applied", onSync);
    return () => window.removeEventListener("gt:sync-applied", onSync);
  }, [load]);

  /** Acción inmediata (añadir, borrar, reordenar, estado…): primero se guarda lo pendiente. */
  async function act<T>(fn: () => Promise<T>, success?: string): Promise<T | null> {
    if (!(await flush())) return null;
    try {
      const r = await fn();
      if (success) toast.success(success);
      return r;
    } catch (e) {
      toast.error(errorMessage(e));
      load();
      return null;
    }
  }

  const setQuery = useCallback(
    (patch: Record<string, string | null>, replace = false) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
      setParams(next, { replace });
    },
    [params, setParams]
  );
  const selectStage = useCallback((sid: string) => setQuery({ etapa: sid, tab: "etapas" }), [setQuery]);

  const progress = useMemo(() => (project ? projectProgress(project.stages) : 0), [project?.stages]); // eslint-disable-line react-hooks/exhaustive-deps

  if (missing) {
    return <Empty title="Proyecto no encontrado" description="Puede que se haya eliminado definitivamente." action={<Link to="/proyectos" className="text-primary text-sm">Volver a los proyectos</Link>} />;
  }
  if (!project) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Cargando proyecto">
        <Loader2 className="animate-spin text-subtle" />
      </div>
    );
  }

  const trashed = !!project.deletedAt;
  const stageIndex = stageId ? project.stages.findIndex((s) => s.id === stageId) : -1;
  const stage = stageIndex >= 0 ? project.stages[stageIndex] : null;
  const deadline = deadlineOf(project, localDateKey());

  const setStatus = (status: ProjectStatus) =>
    act(async () => setProject(await api.put<ProjectRow>(`/projects/${id}`, { status })), `Proyecto ${STATUS_META[status].label.toLowerCase()}`);

  const reorder = (ids: string[]) => {
    const byId = new Map(project.stages.map((s) => [s.id, s]));
    setProject({ ...project, stages: ids.map((x) => byId.get(x)!) });
    act(async () => setProject(await api.post<ProjectRow>(`/projects/${id}/stages/reorder`, { ids })));
  };

  async function back() {
    if ((await flush()) || confirm("No se pudieron guardar los últimos cambios. ¿Salir igualmente?")) navigate("/proyectos");
  }

  return (
    <article className="max-w-6xl mx-auto space-y-4" aria-label={`Proyecto ${project.title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={back} className="h-9 px-2 -ml-2 inline-flex items-center gap-1 rounded-md text-sm text-subtle hover:text-text hover:bg-muted">
          <ArrowLeft size={16} /> Proyectos
        </button>
        <SaveStatus status={save} onRetry={() => flush()} />
        <div className="ml-auto flex items-center gap-1">
          {trashed ? (
            <>
              <Button size="sm" onClick={() => act(async () => setProject(await api.post<ProjectRow>(`/projects/${id}/restore`)), "Proyecto restaurado")}>
                <RotateCcw size={14} /> Restaurar
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (!confirm(`¿Eliminar «${project.title}» y sus ${project.stages.length} etapas definitivamente? No se podrá recuperar.`)) return;
                  act(() => api.delete(`/projects/${id}/purge`), "Proyecto eliminado definitivamente").then((r) => r !== null && navigate("/proyectos?vista=papelera"));
                }}
              >
                <Trash2 size={14} /> Eliminar definitivamente
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => flush().then(() => { api.get<{ tags: string[] }>("/projects").then((r) => setTags(r.tags)).catch(() => undefined); setEditing(true); })}>
                <Pencil size={14} /> Editar
              </Button>
              <ActionMenu label={`Acciones de ${project.title}`}>
                {(Object.keys(STATUS_META) as ProjectStatus[])
                  .filter((s) => s !== project.status)
                  .map((s) => {
                    const Icon = STATUS_META[s].icon;
                    return (
                      <MenuItem key={s} onClick={() => setStatus(s)} icon={<Icon size={14} />}>
                        {STATUS_META[s].action}
                      </MenuItem>
                    );
                  })}
                <MenuItem
                  danger
                  icon={<Trash2 size={14} />}
                  onClick={() => {
                    if (!confirm(`¿Enviar «${project.title}» a la papelera? Sus etapas se conservan y podrás restaurarlo.`)) return;
                    act(() => api.delete(`/projects/${id}`), "Proyecto enviado a la papelera").then((r) => r !== null && navigate("/proyectos"));
                  }}
                >
                  Eliminar
                </MenuItem>
              </ActionMenu>
            </>
          )}
        </div>
      </div>

      {trashed && <p className="text-sm text-warning">Este proyecto está en la papelera: restáuralo para editarlo.</p>}

      <header className="rounded-lg border-l-4 pl-3 space-y-3" style={{ borderColor: project.color }}>
        <div className="flex items-start gap-3">
          <ProjectAvatar icon={project.icon} color={project.color} size="lg" />
          <div className="flex-1 min-w-0">
            <h1 className="gt-heading text-2xl break-words">{project.title}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <StatusBadge status={project.status} />
              {project.tag && <Badge color={project.color}>{project.tag}</Badge>}
              <DeadlineBadge deadline={deadline} />
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="gt-heading text-3xl tabular-nums" style={{ color: project.color }} aria-label={`Progreso general ${formatPercent(progress, 1)}`}>
              {formatPercent(progress, 1)}
            </span>
            <p className="text-xs text-subtle">progreso general</p>
          </div>
        </div>
        <ProgressBar value={progress} color={project.color} label="Progreso general del proyecto" className="h-2.5" />
      </header>

      {/* Móvil: pestañas. En escritorio se ven los dos paneles a la vez. */}
      <div className="flex gap-1 lg:hidden" role="tablist" aria-label="Secciones del proyecto">
        {(
          [
            ["info", "Información"],
            ["stages", `Etapas (${project.stages.length})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k && !stage}
            onClick={() => setQuery({ tab: k === "stages" ? "etapas" : null, etapa: null }, true)}
            className={cn("h-9 px-3 rounded-md text-sm flex-1", tab === k && !stage ? "bg-primary/10 text-primary font-medium" : "text-subtle hover:bg-muted")}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(16rem,20rem)_1fr] gap-4 items-start">
        <aside className={cn("lg:block lg:sticky lg:top-4", (tab !== "stages" || stage) && "hidden")}>
          <StageList stages={project.stages} selectedId={stage?.id ?? null} color={project.color} readOnly={trashed} onSelect={selectStage} onReorder={reorder} onAdd={async (title) => {
            const r = await act(() => api.post<{ project: ProjectRow; stage: { id: string } }>(`/projects/${id}/stages`, { title }));
            if (!r) return false;
            setProject(r.project);
            selectStage(r.stage.id);
            return true;
          }} />
        </aside>

        <div className={cn("lg:block min-w-0", tab === "stages" && !stage && "hidden")}>
          {stage ? (
            <StagePanel
              key={stage.id}
              stage={stage}
              index={stageIndex}
              total={project.stages.length}
              color={project.color}
              readOnly={trashed}
              onChange={(patch) => changeStage(stage.id, patch)}
              onBack={() => setQuery({ etapa: null })}
              onMove={(d) => {
                const ids = project.stages.map((s) => s.id);
                ids.splice(stageIndex, 1);
                ids.splice(stageIndex + d, 0, stage.id);
                reorder(ids);
              }}
              onDelete={() => {
                if (!confirm(`¿Eliminar la etapa «${stage.title}»? Se perderán su descripción y su progreso.`)) return;
                act(() => api.delete<ProjectRow>(`/projects/${id}/stages/${stage.id}`), "Etapa eliminada").then((r) => {
                  if (!r) return;
                  setProject(r);
                  setQuery({ etapa: null }, true);
                });
              }}
            />
          ) : (
            <ProjectInfo project={project} progress={progress} readOnly={trashed} onStatus={setStatus} onToggleObjective={(oid) =>
              act(async () => setProject(await api.put<ProjectRow>(`/projects/${id}`, { objectives: project.objectives.map((o) => (o.id === oid ? { ...o, done: !o.done } : o)) })))
            } onShowStages={() => setQuery({ tab: "etapas" })} />
          )}
        </div>
      </div>

      <ProjectForm open={editing} onClose={() => { setEditing(false); if (params.get("edit")) setQuery({ edit: null }, true); }} project={project} tags={tags} onSaved={setProject} />
    </article>
  );
}

function ProjectInfo({ project, progress, readOnly, onStatus, onToggleObjective, onShowStages }: { project: ProjectRow; progress: number; readOnly: boolean; onStatus: (s: ProjectStatus) => void; onToggleObjective: (id: string) => void; onShowStages: () => void }) {
  const counts = { pending: 0, in_progress: 0, done: 0 };
  for (const s of project.stages) counts[stageState(s.progress)]++;
  const objectivesDone = project.objectives.filter((o) => o.done).length;

  return (
    <section className="gt-surface p-4 space-y-6" aria-label="Información del proyecto">
      <div className="space-y-2">
        <h2 className="text-xs font-medium text-subtle uppercase tracking-wide">Estado</h2>
        <div className="inline-flex flex-wrap gap-1 p-1 rounded-lg bg-muted" role="radiogroup" aria-label="Estado del proyecto">
          {(Object.keys(STATUS_META) as ProjectStatus[]).map((s) => {
            const m = STATUS_META[s];
            const on = project.status === s;
            return (
              <button key={s} role="radio" aria-checked={on} disabled={readOnly} onClick={() => !on && onStatus(s)} className={cn("h-8 px-3 rounded-md text-sm inline-flex items-center gap-1.5 disabled:opacity-60", on ? "bg-surface shadow-sm font-medium" : "text-subtle hover:text-text")}>
                <m.icon size={14} aria-hidden className={on ? m.cls.split(" ")[0] : undefined} /> {m.label}
              </button>
            );
          })}
        </div>
        {progress >= 100 && project.status !== "finished" && !readOnly && project.stages.length > 0 && (
          <p className="text-xs text-subtle">Todas las etapas están al 100 %. Cuando lo des por terminado, márcalo como finalizado.</p>
        )}
        {project.finishedAt && project.status === "finished" && <p className="text-xs text-subtle">Finalizado el {new Date(project.finishedAt).toLocaleDateString()}.</p>}
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Info label="Inicio" value={formatDay(project.startDate)} />
        <Info label="Fin previsto" value={formatDay(project.endDate)} />
        <Info label="Etapas" value={`${counts.done}/${project.stages.length} completadas`} />
        <Info label="Modificado" value={new Date(project.updatedAt).toLocaleDateString()} />
      </dl>

      <div className="space-y-2">
        <h2 className="text-xs font-medium text-subtle uppercase tracking-wide">Resumen de etapas</h2>
        {project.stages.length === 0 ? (
          <p className="text-sm text-subtle">
            Sin etapas el progreso es 0 %.{" "}
            {!readOnly && (
              <>
                <button className="lg:hidden text-primary underline" onClick={onShowStages}>
                  Crea la primera etapa
                </button>
                <span className="hidden lg:inline">Crea la primera en el panel de etapas.</span>
              </>
            )}
          </p>
        ) : (
          <>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-muted" aria-hidden>
              <div className="bg-success" style={{ width: `${(counts.done / project.stages.length) * 100}%` }} />
              <div style={{ width: `${(counts.in_progress / project.stages.length) * 100}%`, background: project.color }} />
            </div>
            <p className="text-sm text-subtle">
              {counts.done} completadas · {counts.in_progress} en curso · {counts.pending} pendientes · media {formatPercent(progress, 1)}
            </p>
          </>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-medium text-subtle uppercase tracking-wide flex items-center gap-1.5">
          <Target size={13} aria-hidden /> Objetivos generales
          {project.objectives.length > 0 && <span className="normal-case tracking-normal tabular-nums">· {objectivesDone}/{project.objectives.length}</span>}
        </h2>
        {project.objectives.length === 0 ? (
          <p className="text-sm text-subtle">Sin objetivos. Añádelos desde «Editar».</p>
        ) : (
          <ul className="space-y-1">
            {project.objectives.map((o) => (
              <li key={o.id}>
                <label className="flex items-start gap-2 text-sm py-1 cursor-pointer">
                  <input type="checkbox" className="accent-primary mt-0.5 h-4 w-4" checked={o.done} disabled={readOnly} onChange={() => onToggleObjective(o.id)} />
                  <span className={cn(o.done && "line-through text-subtle")}>{o.text}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-medium text-subtle uppercase tracking-wide">Descripción</h2>
        {project.description ? <Markdown>{project.description}</Markdown> : <p className="text-sm text-subtle">Sin descripción.</p>}
      </div>

      <p className="text-[11px] text-subtle flex items-center gap-1">
        <CalendarDays size={12} aria-hidden /> Creado {new Date(project.createdAt).toLocaleString()} · Modificado {new Date(project.updatedAt).toLocaleString()}
      </p>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
