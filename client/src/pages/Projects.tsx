import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { FolderKanban, Loader2, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { errorMessage } from "@/components/finance/shared";
import { ProjectDetail } from "@/components/projects/ProjectDetail";
import { ProjectForm } from "@/components/projects/ProjectForm";
import { ActionMenu, DeadlineBadge, formatDay, MenuItem, plainText, ProgressBar, ProjectAvatar, StatusBadge, STATUS_META } from "@/components/projects/shared";
import { api } from "@/services/api";
import type { ProjectStatus } from "@/services/localDb";
import { formatPercent } from "@/services/projects/progress";
import type { ProjectSummary, ProjectView } from "@/services/projects/query";
import { cn } from "@/lib/utils";

interface ListResult {
  items: ProjectSummary[];
  counts: { all: number; active: number; inactive: number; finished: number; trash: number };
  tags: string[];
}

/** Vistas en la URL (en español, como el resto de rutas) ↔ vistas de la API. */
const VIEWS: [param: string, view: ProjectView, label: string, count: keyof ListResult["counts"]][] = [
  ["", "all", "Todos", "all"],
  ["activos", "active", "Activos", "active"],
  ["inactivos", "inactive", "Inactivos", "inactive"],
  ["finalizados", "finished", "Finalizados", "finished"],
  ["papelera", "trash", "Papelera", "trash"],
];

export function Projects() {
  const { id } = useParams();
  if (id) return <ProjectDetail key={id} id={id} />;
  return <ProjectsList />;
}

function ProjectsList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [creating, setCreating] = useState(params.get("new") === "1");

  const viewParam = params.get("vista") ?? "";
  const view = VIEWS.find((v) => v[0] === viewParam)?.[1] ?? "all";
  const tag = params.get("tag") ?? "";
  const sort = params.get("sort") ?? "updated:desc";

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [s, d] = sort.split(":");
    const p = new URLSearchParams({ view, sort: s, dir: d });
    if (params.get("q")) p.set("q", params.get("q")!);
    if (tag) p.set("tag", tag);
    try {
      setData(await api.get<ListResult>(`/projects?${p}`));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [view, sort, tag, params]);

  useEffect(() => {
    load();
    window.addEventListener("gt:sync-applied", load);
    return () => window.removeEventListener("gt:sync-applied", load);
  }, [load]);

  // Búsqueda con pequeño retardo: no se filtra en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q.trim()) set({ q: q.trim() || null });
    }, 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      toast.success(message);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const filtersActive = !!(params.get("q") || tag);
  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Proyectos"
        description="Etapas, objetivos y fechas, con el progreso calculado a partir de las etapas."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> Nuevo proyecto
          </Button>
        }
      />

      <div className="flex gap-1 mb-3 overflow-x-auto" role="tablist" aria-label="Estado">
        {VIEWS.map(([param, v, label, count]) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => set({ vista: param || null })}
            className={cn("h-9 px-3 rounded-md text-sm whitespace-nowrap", view === v ? "bg-primary/10 text-primary font-medium" : "text-subtle hover:bg-muted hover:text-text")}
          >
            {label} {data && <span className="tabular-nums text-xs opacity-80">{data.counts[count]}</span>}
          </button>
        ))}
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-2 items-center mb-4" aria-label="Buscar y filtrar">
        <div className="col-span-2 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
          <Input aria-label="Buscar proyectos" placeholder="Buscar en título, descripción, etiqueta u objetivos…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select aria-label="Etiqueta" value={tag} onChange={(e) => set({ tag: e.target.value || null })}>
          <option value="">Todas las etiquetas</option>
          {data?.tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Select aria-label="Ordenar" value={sort} onChange={(e) => set({ sort: e.target.value === "updated:desc" ? null : e.target.value })}>
          <option value="updated:desc">Modificados recientemente</option>
          <option value="updated:asc">Modificados hace más tiempo</option>
          <option value="title:asc">Título (A-Z)</option>
          <option value="title:desc">Título (Z-A)</option>
          <option value="end:asc">Fecha final más próxima</option>
          <option value="start:desc">Inicio más reciente</option>
          <option value="start:asc">Inicio más antiguo</option>
          <option value="created:desc">Creados recientemente</option>
          <option value="progress:desc">Más avanzados</option>
          <option value="progress:asc">Menos avanzados</option>
        </Select>
        {filtersActive && (
          <button
            className="text-sm text-subtle hover:text-text inline-flex items-center gap-1 justify-self-start"
            onClick={() => {
              setQ("");
              set({ q: null, tag: null });
            }}
          >
            <X size={14} /> Quitar filtros
          </button>
        )}
      </section>

      {view === "trash" && (data?.counts.trash ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-sm text-subtle">
          Los proyectos de la papelera conservan sus etapas y se pueden restaurar.
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            onClick={() => confirm("¿Vaciar la papelera? Los proyectos y sus etapas se eliminarán definitivamente.") && act(() => api.post("/projects/trash/empty"), "Papelera vaciada")}
          >
            <Trash2 size={14} /> Vaciar papelera
          </Button>
        </div>
      )}

      {!data && loading ? (
        <div className="flex justify-center py-12" role="status" aria-label="Cargando proyectos">
          <Loader2 className="animate-spin text-subtle" size={20} />
        </div>
      ) : items.length === 0 ? (
        <Empty
          icon={FolderKanban}
          title={filtersActive ? "Ningún proyecto coincide" : view === "trash" ? "La papelera está vacía" : view === "all" ? "Aún no tienes proyectos" : `No hay proyectos ${VIEWS.find((v) => v[1] === view)![2].toLowerCase()}`}
          description={filtersActive ? "Prueba con otras palabras o quita filtros." : view === "all" ? "Crea tu primer proyecto, divídelo en etapas y sigue su avance." : undefined}
          action={view === "all" && !filtersActive ? <Button onClick={() => setCreating(true)}><Plus size={16} /> Nuevo proyecto</Button> : undefined}
        />
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3" aria-busy={loading}>
          {items.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onOpen={() => navigate(`/proyectos/${p.id}`)}
              onEdit={() => navigate(`/proyectos/${p.id}?edit=1`)}
              onStatus={(s) => act(() => api.put(`/projects/${p.id}`, { status: s }), `Proyecto ${STATUS_META[s].label.toLowerCase()}`)}
              onDelete={() => confirm(`¿Enviar «${p.title}» a la papelera? Sus etapas se conservan y podrás restaurarlo.`) && act(() => api.delete(`/projects/${p.id}`), "Proyecto enviado a la papelera")}
              onRestore={() => act(() => api.post(`/projects/${p.id}/restore`), "Proyecto restaurado")}
              onPurge={() => confirm(`¿Eliminar «${p.title}» y sus ${p.stagesTotal} etapas definitivamente? No se podrá recuperar.`) && act(() => api.delete(`/projects/${p.id}/purge`), "Proyecto eliminado definitivamente")}
            />
          ))}
        </ul>
      )}

      <ProjectForm
        open={creating}
        onClose={() => {
          setCreating(false);
          if (params.get("new")) set({ new: null });
        }}
        tags={data?.tags ?? []}
        onSaved={(p) => navigate(`/proyectos/${p.id}`)}
      />
    </div>
  );
}

interface CardProps {
  project: ProjectSummary;
  onOpen: () => void;
  onEdit: () => void;
  onStatus: (s: ProjectStatus) => void;
  onDelete: () => void;
  onRestore: () => void;
  onPurge: () => void;
}

function ProjectCard({ project: p, onOpen, onEdit, onStatus, onDelete, onRestore, onPurge }: CardProps) {
  const trashed = !!p.deletedAt;
  return (
    <li
      className={cn("gt-surface p-3 flex flex-col gap-2.5 border-l-4 cursor-pointer hover:shadow-md transition-shadow", p.status !== "active" && !trashed && "opacity-80 hover:opacity-100")}
      style={{ borderLeftColor: p.color }}
      onClick={onOpen}
    >
      <div className="flex items-start gap-2.5">
        <ProjectAvatar icon={p.icon} color={p.color} />
        <div className="flex-1 min-w-0">
          <Link to={`/proyectos/${p.id}`} className="block font-medium leading-snug line-clamp-2 break-words" onClick={(e) => e.stopPropagation()}>
            {p.title}
          </Link>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <StatusBadge status={p.status} />
            {p.tag && <Badge color={p.color}>{p.tag}</Badge>}
          </div>
        </div>
        <ActionMenu label={`Acciones de ${p.title}`}>
          {trashed ? (
            <>
              <MenuItem onClick={onRestore} icon={<RotateCcw size={14} />}>Restaurar</MenuItem>
              <MenuItem onClick={onPurge} icon={<Trash2 size={14} />} danger>Eliminar definitivamente</MenuItem>
            </>
          ) : (
            <>
              <MenuItem onClick={onEdit} icon={<Pencil size={14} />}>Editar</MenuItem>
              {(Object.keys(STATUS_META) as ProjectStatus[])
                .filter((s) => s !== p.status)
                .map((s) => {
                  const Icon = STATUS_META[s].icon;
                  return (
                    <MenuItem key={s} onClick={() => onStatus(s)} icon={<Icon size={14} />}>
                      {STATUS_META[s].action}
                    </MenuItem>
                  );
                })}
              <MenuItem onClick={onDelete} icon={<Trash2 size={14} />} danger>Eliminar</MenuItem>
            </>
          )}
        </ActionMenu>
      </div>

      {p.description && <p className="text-sm text-subtle line-clamp-2">{plainText(p.description)}</p>}

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-subtle tabular-nums">{p.stagesTotal ? `${p.stagesDone}/${p.stagesTotal} etapas` : "Sin etapas"}</span>
          <span className="font-semibold tabular-nums" style={{ color: p.color }}>
            {formatPercent(p.progress)}
          </span>
        </div>
        <ProgressBar value={p.progress} color={p.color} label={`Progreso de ${p.title}`} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle mt-auto">
        {(p.startDate || p.endDate) && (
          <span>
            {formatDay(p.startDate)} → {formatDay(p.endDate)}
          </span>
        )}
        <DeadlineBadge deadline={p.deadline} />
        <span className="ml-auto">Modificado {new Date(p.updatedAt).toLocaleDateString()}</span>
      </div>
    </li>
  );
}
