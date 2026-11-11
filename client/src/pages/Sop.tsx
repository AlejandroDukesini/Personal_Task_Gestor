import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Archive, ArchiveRestore, ArrowLeft, ClipboardList, Copy, FileStack, FolderPlus, LayoutTemplate, Loader2, Pencil, Plus, Search, Trash2, User, Workflow } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { ActionMenu, MenuItem, ProgressBar } from "@/components/projects/shared";
import { SopForm } from "@/components/sop/SopForm";
import { StructureEditor } from "@/components/workflow/StructureEditor";
import type { OpRunner } from "@/components/workflow/shared";
import { api } from "@/services/api";
import { localDateKey, type SopKind, type SopRow } from "@/services/localDb";
import type { SopSummary } from "@/services/sops/routes";
import { structureStats } from "@/services/workflow/logic";
import { runAction } from "@/lib/runAction";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

const STATUS_LABEL: Record<SopRow["status"], string> = { draft: "Borrador", active: "Activo", archived: "Archivado" };

/** SOP — procedimientos operativos estándar: listado o detalle según la ruta. */
export function Sop() {
  const { id } = useParams();
  return id ? <SopDetail key={id} id={id} /> : <SopList />;
}

interface ListResult {
  items: SopSummary[];
  counts: { sop: number; template: number; archived: number };
  categories: string[];
}

const TABS = [
  { id: "sop", label: "Procedimientos", icon: ClipboardList },
  { id: "template", label: "Plantillas", icon: LayoutTemplate },
] as const;

function SopList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const kind = (params.get("tipo") === "plantillas" ? "template" : "sop") as SopKind;
  const archived = params.get("archivados") === "1";
  const [q, setQ] = useState("");
  const [data, setData] = useState<ListResult | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ kind, status: archived ? "archived" : "active" });
    if (q.trim()) p.set("q", q.trim());
    setData(await api.get<ListResult>(`/sops?${p}`));
  }, [kind, archived, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 200 : 0);
    window.addEventListener("gt:sync-applied", load);
    return () => {
      clearTimeout(t);
      window.removeEventListener("gt:sync-applied", load);
    };
  }, [load, q]);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  const act = (fn: () => Promise<unknown>, msg: string) => runAction(fn, msg, load);
  const noun = kind === "template" ? "plantilla" : "SOP";

  return (
    <>
      <PageHeader
        title="SOP"
        description="Procedimientos operativos estándar: diseña procesos reutilizables y sus plantillas."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> {kind === "template" ? "Nueva plantilla" : "Nuevo SOP"}
          </Button>
        }
      />

      <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-2 mb-3 border-b border-border" aria-label="Secciones de SOP">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => set({ tipo: t.id === "template" ? "plantillas" : null, archivados: null })}
            aria-current={kind === t.id && !archived ? "page" : undefined}
            className={cn("flex items-center gap-1.5 px-3 h-9 rounded-md text-sm whitespace-nowrap shrink-0", kind === t.id && !archived ? "bg-primary/10 text-primary font-medium" : "text-subtle hover:text-text hover:bg-muted")}
          >
            <t.icon size={15} aria-hidden /> {t.label}
            {data && <span className="tabular-nums text-xs opacity-80">{data.counts[t.id]}</span>}
          </button>
        ))}
        <button
          onClick={() => set({ archivados: archived ? null : "1" })}
          aria-current={archived ? "page" : undefined}
          className={cn("flex items-center gap-1.5 px-3 h-9 rounded-md text-sm whitespace-nowrap shrink-0 ml-auto", archived ? "bg-primary/10 text-primary font-medium" : "text-subtle hover:text-text hover:bg-muted")}
        >
          <Archive size={15} aria-hidden /> Archivados
        </button>
      </nav>

      <div className="relative max-w-sm mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
        <Input aria-label="Buscar" className="pl-8" placeholder={`Buscar ${kind === "template" ? "plantillas" : "procedimientos"}…`} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!data ? (
        <div className="flex justify-center py-16" role="status" aria-label="Cargando">
          <Loader2 className="animate-spin text-subtle" />
        </div>
      ) : data.items.length === 0 ? (
        <Card>
          <Empty
            icon={kind === "template" ? LayoutTemplate : Workflow}
            title={q ? "Nada coincide con la búsqueda" : archived ? `No hay ${kind === "template" ? "plantillas" : "SOP"} archivados` : kind === "template" ? "Aún no hay plantillas" : "Aún no hay procedimientos"}
            description={archived || q ? undefined : kind === "template" ? "Una plantilla es una estructura reutilizable: etapas, procedimientos, actividades y listas de verificación." : "Crea un SOP desde cero o a partir de una plantilla (por ejemplo, «Desarrollo de software»)."}
            action={!archived && !q && <Button onClick={() => setCreating(true)}><Plus size={16} /> {kind === "template" ? "Crear plantilla" : "Crear SOP"}</Button>}
          />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {data.items.map((s) => (
            <li key={s.id} className="gt-surface p-4 flex flex-col gap-2 border-l-4 cursor-pointer hover:shadow-md transition-shadow" style={{ borderLeftColor: s.color }} onClick={() => navigate(`/sop/${s.id}`)}>
              <div className="flex items-start gap-2">
                <Link to={`/sop/${s.id}`} className="flex-1 min-w-0 font-medium leading-snug break-words" onClick={(e) => e.stopPropagation()}>
                  {s.name}
                </Link>
                <span onClick={(e) => e.stopPropagation()}>
                  <ActionMenu label={`Acciones de ${s.name}`}>
                    {s.status === "archived" ? (
                      <>
                        <MenuItem icon={<ArchiveRestore size={14} />} onClick={() => act(() => api.post(`/sops/${s.id}/restore`), "Restaurado")}>Restaurar</MenuItem>
                        <MenuItem icon={<Trash2 size={14} />} danger onClick={() => confirm(`¿Eliminar «${s.name}» definitivamente? No se podrá recuperar (se guarda antes una copia de seguridad automática).`) && act(() => api.delete(`/sops/${s.id}`), "Eliminado definitivamente")}>Eliminar definitivamente</MenuItem>
                      </>
                    ) : (
                      <>
                        {s.kind === "template" ? (
                          <MenuItem icon={<ClipboardList size={14} />} onClick={() => act(async () => navigate(`/sop/${(await api.post<SopRow>(`/sops/${s.id}/duplicate`, { kind: "sop" })).id}`), "SOP creado desde la plantilla")}>Crear SOP con esta plantilla</MenuItem>
                        ) : (
                          <MenuItem icon={<LayoutTemplate size={14} />} onClick={() => act(() => api.post(`/sops/${s.id}/duplicate`, { kind: "template" }), "Guardado como plantilla")}>Guardar como plantilla</MenuItem>
                        )}
                        <MenuItem icon={<Copy size={14} />} onClick={() => act(() => api.post(`/sops/${s.id}/duplicate`), "Duplicado")}>Duplicar</MenuItem>
                        <MenuItem icon={<Archive size={14} />} onClick={() => act(() => api.post(`/sops/${s.id}/archive`), "Archivado")}>Archivar</MenuItem>
                      </>
                    )}
                  </ActionMenu>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <Badge>v{s.version}</Badge>
                {s.status === "draft" && <Badge className="text-warning bg-warning/10">Borrador</Badge>}
                {s.category && <Badge color={s.color}>{s.category}</Badge>}
                {s.owner && (
                  <span className="inline-flex items-center gap-1 text-subtle">
                    <User size={11} aria-hidden /> {s.owner}
                  </span>
                )}
              </div>
              {(s.objective || s.description) && <p className="text-sm text-subtle line-clamp-2">{s.objective ?? s.description}</p>}
              <p className="text-xs text-subtle tabular-nums mt-auto">
                {s.stages} etapas · {s.procedures} procedimientos · {s.activities} actividades
              </p>
              {s.kind === "sop" && s.activities > 0 && <ProgressBar value={s.progress} color={s.color} label={`Avance de ${s.name}`} className="h-1.5" />}
            </li>
          ))}
        </ul>
      )}

      <SopForm open={creating} onClose={() => setCreating(false)} kind={kind} categories={data?.categories ?? []} onSaved={(s) => navigate(`/sop/${s.id}`)} />
    </>
  );
}

function SopDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [sop, setSop] = useState<SopRow | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setSop(await api.get<SopRow>(`/sops/${id}`));
    } catch {
      setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    load();
    api.get<ListResult>("/sops?status=all").then((r) => setCategories(r.categories)).catch(() => undefined);
    window.addEventListener("gt:sync-applied", load);
    return () => window.removeEventListener("gt:sync-applied", load);
  }, [load]);

  const runOp: OpRunner = useCallback(
    async (op) => {
      try {
        const r = await api.post<{ sop: SopRow; createdId: string | null }>(`/sops/${id}/ops`, op);
        setSop(r.sop);
        return { ok: true, createdId: r.createdId };
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo guardar");
        return { ok: false };
      }
    },
    [id]
  );

  if (missing) return <Empty title="No encontrado" description="Puede que se haya eliminado." action={<Link to="/sop" className="text-primary text-sm">Volver a SOP</Link>} />;
  if (!sop) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Cargando">
        <Loader2 className="animate-spin text-subtle" />
      </div>
    );
  }

  const archived = sop.status === "archived";
  const stats = structureStats(sop.stages);
  const back = sop.kind === "template" ? "/sop?tipo=plantillas" : "/sop";
  const act = (fn: () => Promise<unknown>, msg: string, after?: () => void) => runAction(fn, msg, after ?? load);
  const dt = (iso: string) => new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });

  return (
    <article className="max-w-5xl mx-auto space-y-4" aria-label={sop.name}>
      <div className="flex flex-wrap items-center gap-2">
        <Link to={back} className="h-9 px-2 -ml-2 inline-flex items-center gap-1 rounded-md text-sm text-subtle hover:text-text hover:bg-muted">
          <ArrowLeft size={16} /> {sop.kind === "template" ? "Plantillas" : "SOP"}
        </Link>
        <div className="ml-auto flex flex-wrap gap-1">
          {archived ? (
            <>
              <Button size="sm" onClick={() => act(() => api.post(`/sops/${sop.id}/restore`), "Restaurado")}>
                <ArchiveRestore size={14} /> Restaurar
              </Button>
              <Button size="sm" variant="danger" onClick={() => confirm(`¿Eliminar «${sop.name}» definitivamente?`) && act(() => api.delete(`/sops/${sop.id}`), "Eliminado definitivamente", () => navigate(back))}>
                <Trash2 size={14} /> Eliminar
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil size={14} /> Editar datos
              </Button>
              {sop.kind === "template" ? (
                <Button size="sm" onClick={() => act(async () => navigate(`/sop/${(await api.post<SopRow>(`/sops/${sop.id}/duplicate`, { kind: "sop" })).id}`), "SOP creado desde la plantilla", () => undefined)}>
                  <ClipboardList size={14} /> Crear SOP con esta plantilla
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => act(async () => navigate(`/sop/${(await api.post<SopRow>(`/sops/${sop.id}/duplicate`, { kind: "template" })).id}`), "Guardado como plantilla", () => undefined)}>
                  <FileStack size={14} /> Guardar como plantilla
                </Button>
              )}
              <ActionMenu label="Más acciones">
                {sop.kind === "template" && <MenuItem icon={<FolderPlus size={14} />} onClick={() => navigate(`/proyectos?new=1&plantilla=${sop.id}`)}>Usar en un proyecto profesional</MenuItem>}
                <MenuItem icon={<Copy size={14} />} onClick={() => act(async () => navigate(`/sop/${(await api.post<SopRow>(`/sops/${sop.id}/duplicate`)).id}`), "Duplicado", () => undefined)}>Duplicar</MenuItem>
                <MenuItem icon={<Archive size={14} />} onClick={() => act(() => api.post(`/sops/${sop.id}/archive`), "Archivado")}>Archivar</MenuItem>
                <MenuItem icon={<Trash2 size={14} />} danger onClick={() => confirm(`¿Eliminar «${sop.name}» definitivamente? Se guardará antes una copia de seguridad automática.`) && act(() => api.delete(`/sops/${sop.id}`), "Eliminado definitivamente", () => navigate(back))}>Eliminar</MenuItem>
              </ActionMenu>
            </>
          )}
        </div>
      </div>

      <header className="gt-surface p-4 border-l-4 space-y-2" style={{ borderLeftColor: sop.color }}>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="gt-heading text-2xl break-words">{sop.name}</h1>
          <Badge>{sop.kind === "template" ? "Plantilla" : "SOP"}</Badge>
          <Badge>v{sop.version}</Badge>
          <Badge className={cn(sop.status === "active" && "text-success bg-success/10", sop.status === "draft" && "text-warning bg-warning/10")}>{STATUS_LABEL[sop.status]}</Badge>
          {sop.category && <Badge color={sop.color}>{sop.category}</Badge>}
        </div>
        {sop.objective && (
          <p className="text-sm">
            <span className="text-xs font-medium text-subtle uppercase tracking-wide block">Objetivo</span>
            {sop.objective}
          </p>
        )}
        {sop.description && <p className="text-sm text-subtle whitespace-pre-line">{sop.description}</p>}
        <p className="text-xs text-subtle flex flex-wrap gap-x-3">
          {sop.owner && <span>Responsable: {sop.owner}</span>}
          <span>Creado {dt(sop.createdAt)}</span>
          <span>Modificado {dt(sop.updatedAt)}</span>
          <span className="tabular-nums">{stats.procedures} procedimientos · {stats.checksDone}/{stats.checks} verificaciones</span>
        </p>
        {sop.kind === "template" && <p className="text-xs text-subtle">Al usar esta plantilla (en un SOP o en un proyecto profesional) se crea una copia independiente: editarla aquí no cambia lo ya creado.</p>}
      </header>

      {archived && <p className="text-sm text-warning">Está archivado: restáuralo para editarlo.</p>}

      <StructureEditor stages={sop.stages} run={runOp} accent={sop.color} readOnly={archived} today={localDateKey()} />

      <SopForm open={editing} onClose={() => setEditing(false)} sop={sop} kind={sop.kind} categories={categories} onSaved={setSop} />
    </article>
  );
}
