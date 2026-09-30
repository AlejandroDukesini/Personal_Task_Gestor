import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { Archive, ArchiveRestore, Copy, FolderCog, LayoutGrid, List as ListIcon, Loader2, MoreVertical, Paperclip, Plus, RotateCcw, Search, StickyNote, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { api } from "@/services/api";
import { loadDb, newId, type NoteRow } from "@/services/localDb";
import type { NoteSummary, NoteSort, NoteStatus } from "@/services/notes/query";
import { collectGarbage, releaseFiles } from "@/services/notes/files";
import { errorMessage } from "@/components/finance/shared";
import { cn } from "@/lib/utils";
import { CategoryManager, type NoteCategory } from "@/components/notes/CategoryManager";
import { NoteDetail } from "@/components/notes/NoteDetail";
import { NoteIcon } from "@/components/notes/NoteIcon";

interface ListResult {
  items: NoteSummary[];
  total: number;
  nextOffset: number | null;
  counts: { active: number; archived: number; trash: number };
}

const VIEW_KEY = "gestion-tareas:notes-view";

function useCategories() {
  const [categories, setCategories] = useState<NoteCategory[]>([]);
  const reload = useCallback(() => {
    api.get<NoteCategory[]>("/notes/categories").then(setCategories).catch(() => undefined);
  }, []);
  useEffect(() => {
    reload();
    window.addEventListener("gt:sync-applied", reload);
    return () => window.removeEventListener("gt:sync-applied", reload);
  }, [reload]);
  return { categories, reload };
}

export function Notes() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { categories, reload } = useCategories();

  // Limpieza de archivos huérfanos (p. ej. si una pestaña se cerró a mitad de adjuntar).
  useEffect(() => {
    const inUse = new Set(loadDb().notes.flatMap((n) => n.attachments.map((a) => a.fileKey)));
    collectGarbage(inUse).catch(() => undefined);
  }, []);

  if (id) return <NoteDetail key={id} id={id} categories={categories} startEditing={params.get("edit") === "1"} onChanged={reload} />;
  return <NotesList categories={categories} reloadCategories={reload} />;
}

function NotesList({ categories, reloadCategories }: { categories: NoteCategory[]; reloadCategories: () => void }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<ListResult | null>(null);
  const [items, setItems] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [view, setView] = useState<"cards" | "list">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  });
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [managing, setManaging] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const status = (params.get("status") as NoteStatus) || "active";
  const categoryId = params.get("categoryId") ?? "";
  const subcategoryId = params.get("subcategoryId") ?? "";
  const sort = (params.get("sort") as NoteSort) || "updated";
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const hasAttachments = params.get("hasAttachments") === "1";

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  const query = useMemo(() => {
    const p = new URLSearchParams({ status, sort, dir, limit: "30" });
    if (params.get("q")) p.set("q", params.get("q")!);
    if (categoryId) p.set("categoryId", categoryId);
    if (subcategoryId) p.set("subcategoryId", subcategoryId);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (hasAttachments) p.set("hasAttachments", "1");
    return p.toString();
  }, [params, status, sort, dir, categoryId, subcategoryId, from, to, hasAttachments]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<ListResult>(`/notes?${query}`);
      setData(r);
      setItems(r.items);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const more = useCallback(async () => {
    if (!data?.nextOffset || loading) return;
    setLoading(true);
    try {
      const r = await api.get<ListResult>(`/notes?${query}&offset=${data.nextOffset}`);
      setData(r);
      setItems((prev) => [...prev, ...r.items]);
    } finally {
      setLoading(false);
    }
  }, [data, loading, query]);

  useEffect(() => {
    load();
    window.addEventListener("gt:sync-applied", load);
    return () => window.removeEventListener("gt:sync-applied", load);
  }, [load]);

  // Búsqueda con pequeño retardo: no se filtra en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) set({ q: q.trim() || null });
    }, 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carga progresiva al llegar al final de la lista.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && more(), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more]);

  function changeView(v: "cards" | "list") {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* sin almacenamiento */
    }
  }

  async function act(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      toast.success(message);
      load();
      reloadCategories();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const release = async (keys: string[]) => {
    const inUse = new Set(loadDb().notes.flatMap((n) => n.attachments.map((a) => a.fileKey)));
    await releaseFiles(keys, inUse).catch(() => undefined);
  };

  const top = categories.filter((c) => !c.parentId);
  const subs = categories.filter((c) => c.parentId && c.parentId === categoryId);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const filtersActive = !!(params.get("q") || categoryId || subcategoryId || from || to || hasAttachments);

  return (
    <div>
      <PageHeader
        title="Notas"
        description="Notas con formato, adjuntos y cálculos automáticos."
        actions={
          <>
            <Button variant="outline" onClick={() => setManaging(true)}>
              <FolderCog size={16} /> Categorías
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> Nueva nota
            </Button>
          </>
        }
      />

      <div className="flex gap-1 mb-3 overflow-x-auto" role="tablist" aria-label="Estado">
        {(
          [
            ["active", "Activas", data?.counts.active],
            ["archived", "Archivadas", data?.counts.archived],
            ["trash", "Papelera", data?.counts.trash],
          ] as const
        ).map(([k, label, n]) => (
          <button
            key={k}
            role="tab"
            aria-selected={status === k}
            onClick={() => set({ status: k === "active" ? null : k })}
            className={cn("h-9 px-3 rounded-md text-sm whitespace-nowrap", status === k ? "bg-primary/10 text-primary font-medium" : "text-subtle hover:bg-muted hover:text-text")}
          >
            {label} {n !== undefined && <span className="tabular-nums text-xs opacity-80">{n}</span>}
          </button>
        ))}
      </div>

      <section className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-2 items-end mb-4" aria-label="Buscar y filtrar">
        <div className="col-span-2 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
          <Input aria-label="Buscar notas" placeholder="Buscar en título, contenido, categorías, adjuntos…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select aria-label="Categoría" value={categoryId} onChange={(e) => set({ categoryId: e.target.value || null, subcategoryId: null })}>
          <option value="">Todas las categorías</option>
          <option value="none">Sin categoría</option>
          {top.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Subcategoría" value={subcategoryId} disabled={!subs.length} onChange={(e) => set({ subcategoryId: e.target.value || null })}>
          <option value="">{subs.length ? "Todas las subcategorías" : "Sin subcategorías"}</option>
          {subs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Ordenar" value={`${sort}:${dir}`} onChange={(e) => { const [s, d] = e.target.value.split(":"); set({ sort: s, dir: d }); }}>
          <option value="updated:desc">Modificadas recientemente</option>
          <option value="updated:asc">Modificadas hace más tiempo</option>
          <option value="created:desc">Creadas recientemente</option>
          <option value="created:asc">Creadas hace más tiempo</option>
          <option value="title:asc">Título (A-Z)</option>
          <option value="title:desc">Título (Z-A)</option>
          <option value="category:asc">Categoría</option>
        </Select>
        <div className="flex items-center justify-end gap-1">
          <button aria-label="Vista de tarjetas" aria-pressed={view === "cards"} onClick={() => changeView("cards")} className={cn("h-9 w-9 rounded-md inline-flex items-center justify-center", view === "cards" ? "bg-primary/10 text-primary" : "text-subtle hover:bg-muted")}>
            <LayoutGrid size={16} />
          </button>
          <button aria-label="Vista de lista" aria-pressed={view === "list"} onClick={() => changeView("list")} className={cn("h-9 w-9 rounded-md inline-flex items-center justify-center", view === "list" ? "bg-primary/10 text-primary" : "text-subtle hover:bg-muted")}>
            <ListIcon size={16} />
          </button>
        </div>
        <Field label="Modificadas desde">
          <Input type="date" value={from} onChange={(e) => set({ from: e.target.value || null })} />
        </Field>
        <Field label="Hasta">
          <Input type="date" value={to} onChange={(e) => set({ to: e.target.value || null })} />
        </Field>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" className="accent-primary" checked={hasAttachments} onChange={(e) => set({ hasAttachments: e.target.checked ? "1" : null })} />
          <Paperclip size={14} aria-hidden /> Con adjuntos
        </label>
        {filtersActive && (
          <button
            className="text-sm text-subtle hover:text-text pb-2 inline-flex items-center gap-1 justify-self-start"
            onClick={() => {
              setQ("");
              set({ q: null, categoryId: null, subcategoryId: null, from: null, to: null, hasAttachments: null });
            }}
          >
            <X size={14} /> Quitar filtros
          </button>
        )}
      </section>

      {status === "trash" && (data?.counts.trash ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-sm text-subtle">
          Las notas de la papelera se pueden restaurar.
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            onClick={() => {
              if (!confirm("¿Vaciar la papelera? Las notas se eliminarán definitivamente.")) return;
              act(async () => release((await api.post<{ orphanFileKeys: string[] }>("/notes/trash/empty")).orphanFileKeys), "Papelera vaciada");
            }}
          >
            <Trash2 size={14} /> Vaciar papelera
          </Button>
        </div>
      )}

      {data && items.length === 0 && !loading ? (
        <Empty
          icon={StickyNote}
          title={filtersActive ? "Ninguna nota coincide" : status === "trash" ? "La papelera está vacía" : status === "archived" ? "No hay notas archivadas" : "Aún no tienes notas"}
          description={filtersActive ? "Prueba con otras palabras o quita filtros." : status === "active" ? "Crea tu primera nota: admite formato, adjuntos y cálculos como 200+200=." : undefined}
          action={status === "active" && !filtersActive ? <Button onClick={() => setCreating(true)}><Plus size={16} /> Nueva nota</Button> : undefined}
        />
      ) : (
        <ul className={view === "cards" ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3" : "divide-y divide-border gt-surface"} aria-busy={loading}>
          {items.map((n) => (
            <NoteItem
              key={n.id}
              note={n}
              view={view}
              category={n.categoryId ? catById.get(n.categoryId) : undefined}
              subcategory={n.subcategoryId ? catById.get(n.subcategoryId) : undefined}
              onOpen={() => navigate(`/notas/${n.id}`)}
              onEdit={() => navigate(`/notas/${n.id}?edit=1`)}
              onDuplicate={() => act(() => api.post(`/notes/${n.id}/duplicate`), "Nota duplicada")}
              onArchive={() => act(() => api.post(`/notes/${n.id}/${n.archived ? "unarchive" : "archive"}`), n.archived ? "Nota desarchivada" : "Nota archivada")}
              onDelete={() => confirm(`¿Enviar «${n.title}» a la papelera? Podrás restaurarla.`) && act(() => api.delete(`/notes/${n.id}`), "Nota enviada a la papelera")}
              onRestore={() => act(() => api.post(`/notes/${n.id}/restore`), "Nota restaurada")}
              onPurge={() => confirm(`¿Eliminar «${n.title}» definitivamente? No se podrá recuperar.`) && act(async () => release((await api.delete<{ orphanFileKeys: string[] }>(`/notes/${n.id}/purge`)).orphanFileKeys), "Nota eliminada definitivamente")}
            />
          ))}
        </ul>
      )}
      <div ref={sentinel} className="h-8" />
      {loading && (
        <div className="flex justify-center py-4" role="status" aria-label="Cargando notas">
          <Loader2 className="animate-spin text-subtle" size={20} />
        </div>
      )}
      {data?.nextOffset && !loading && (
        <div className="flex justify-center">
          <Button variant="ghost" onClick={more}>
            Cargar más ({data.total - items.length} restantes)
          </Button>
        </div>
      )}

      <NewNoteDialog open={creating} onClose={() => setCreating(false)} categories={categories} defaultCategory={categoryId && categoryId !== "none" ? categoryId : ""} />
      <CategoryManager open={managing} onClose={() => setManaging(false)} categories={categories} reload={() => { reloadCategories(); load(); }} />
    </div>
  );
}

interface ItemProps {
  note: NoteSummary;
  view: "cards" | "list";
  category?: NoteCategory;
  subcategory?: NoteCategory;
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onPurge: () => void;
}

function NoteItem({ note, view, category, subcategory, onOpen, onEdit, onDuplicate, onArchive, onDelete, onRestore, onPurge }: ItemProps) {
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  const accent = note.color ?? category?.color ?? "#64748b";
  const trashed = !!note.deletedAt;
  const dates = `Modificada ${new Date(note.updatedAt).toLocaleDateString()} · Creada ${new Date(note.createdAt).toLocaleDateString()}`;
  const chips = (
    <>
      {category && (
        <Badge color={category.color}>
          <NoteIcon name={category.icon} size={11} /> {category.name}
        </Badge>
      )}
      {subcategory && <Badge color={subcategory.color}>{subcategory.name}</Badge>}
      {note.attachments.length > 0 && (
        <span className="inline-flex items-center gap-0.5 text-xs text-subtle" title={`${note.attachments.length} adjunto(s)`}>
          <Paperclip size={12} aria-hidden /> {note.attachments.length}
          <span className="sr-only"> adjuntos</span>
        </span>
      )}
      {note.archived && !trashed && <Badge>Archivada</Badge>}
    </>
  );
  const actions = (
    <div className="relative shrink-0">
      <button className="h-9 w-9 inline-flex items-center justify-center rounded-md text-subtle hover:bg-muted" aria-label={`Acciones de ${note.title}`} aria-expanded={menu} onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}>
        <MoreVertical size={16} />
      </button>
      {menu && (
        <div className="absolute right-0 top-10 z-20 gt-surface-pop p-1 w-48" role="menu" onClick={(e) => { e.stopPropagation(); setMenu(false); }}>
          {trashed ? (
            <>
              <MenuItem onClick={onRestore} icon={<RotateCcw size={14} />}>Restaurar</MenuItem>
              <MenuItem onClick={onPurge} icon={<Trash2 size={14} />} danger>Eliminar definitivamente</MenuItem>
            </>
          ) : (
            <>
              <MenuItem onClick={onEdit} icon={<StickyNote size={14} />}>Editar</MenuItem>
              <MenuItem onClick={onDuplicate} icon={<Copy size={14} />}>Duplicar</MenuItem>
              <MenuItem onClick={onArchive} icon={note.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}>{note.archived ? "Desarchivar" : "Archivar"}</MenuItem>
              <MenuItem onClick={onDelete} icon={<Trash2 size={14} />} danger>Eliminar</MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  );

  if (view === "list") {
    return (
      <li className="flex items-center gap-3 p-3 hover:bg-muted/50">
        <span className="h-9 w-9 rounded-md flex items-center justify-center shrink-0" style={{ background: `${accent}22`, color: accent }}>
          <NoteIcon name={note.icon} size={17} />
        </span>
        <Link to={`/notas/${note.id}`} className="flex-1 min-w-0">
          <span className="block font-medium truncate">{note.title}</span>
          <span className="block text-xs text-subtle truncate">{note.preview || note.description || "Sin contenido"}</span>
        </Link>
        <div className="hidden md:flex items-center gap-1.5">{chips}</div>
        <span className="hidden lg:block text-xs text-subtle whitespace-nowrap">{new Date(note.updatedAt).toLocaleDateString()}</span>
        {actions}
      </li>
    );
  }
  return (
    <li
      className="gt-surface p-3 flex flex-col gap-2 border-l-4 cursor-pointer hover:shadow-md transition-shadow"
      style={{ borderLeftColor: accent, background: `linear-gradient(0deg, ${accent}0d, ${accent}0d), rgb(var(--surface))` }}
      onClick={onOpen}
    >
      <div className="flex items-start gap-2">
        <span className="h-9 w-9 rounded-md flex items-center justify-center shrink-0" style={{ background: `${accent}26`, color: accent }}>
          <NoteIcon name={note.icon} size={17} />
        </span>
        <Link to={`/notas/${note.id}`} className="flex-1 min-w-0 font-medium leading-snug line-clamp-2 break-words" onClick={(e) => e.stopPropagation()}>
          {note.title}
        </Link>
        {actions}
      </div>
      {note.description && <p className="text-sm text-subtle line-clamp-1">{note.description}</p>}
      <p className="text-sm text-subtle line-clamp-3 whitespace-pre-line min-h-[1.25rem]">{note.preview || "Sin contenido"}</p>
      <div className="flex flex-wrap items-center gap-1.5 mt-auto">{chips}</div>
      <p className="text-[11px] text-subtle">{dates}</p>
    </li>
  );
}

function MenuItem({ onClick, icon, danger, children }: { onClick: () => void; icon: React.ReactNode; danger?: boolean; children: React.ReactNode }) {
  return (
    <button role="menuitem" onClick={onClick} className={cn("w-full flex items-center gap-2 text-left text-sm px-2 py-2 rounded hover:bg-muted", danger && "text-danger")}>
      {icon} {children}
    </button>
  );
}

function NewNoteDialog({ open, onClose, categories, defaultCategory }: { open: boolean; onClose: () => void; categories: NoteCategory[]; defaultCategory: string }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState(defaultCategory);
  const [subcategoryId, setSubcategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  // Id generado una vez: un doble clic no crea dos notas.
  const idRef = useRef(newId());
  useEffect(() => {
    if (open) {
      setTitle("");
      setCategoryId(defaultCategory);
      setSubcategoryId("");
      idRef.current = newId();
    }
  }, [open, defaultCategory]);
  const subs = categories.filter((c) => c.parentId && c.parentId === categoryId);
  const cat = categories.find((c) => c.id === categoryId);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const n = await api.post<NoteRow>("/notes", { id: idRef.current, title: title.trim(), categoryId: categoryId || null, subcategoryId: subcategoryId || null, icon: cat?.icon });
      onClose();
      navigate(`/notas/${n.id}?edit=1`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Nueva nota" size="sm">
      <form className="space-y-3" onSubmit={create}>
        <Field label="Título">
          <Input required autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Presupuesto de la mudanza" />
        </Field>
        <Field label="Categoría">
          <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId(""); }}>
            <option value="">Sin categoría</option>
            {categories.filter((c) => !c.parentId).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        {subs.length > 0 && (
          <Field label="Subcategoría">
            <Select value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)}>
              <option value="">Ninguna</option>
              {subs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <p className="text-xs text-subtle">Podrás escribir el contenido, cambiar el color y el símbolo y adjuntar archivos después.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={!title.trim()}>
            Crear y escribir
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
