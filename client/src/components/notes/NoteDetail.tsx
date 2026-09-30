import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import type { Editor } from "@tiptap/react";
import { Archive, ArchiveRestore, ArrowLeft, Check, CloudOff, Copy, Download, Eye, Loader2, Pencil, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { api } from "@/services/api";
import { loadDb, type NoteAttachment, type NoteRow } from "@/services/localDb";
import { docToHtml, docToMarkdown, docToText, withCalculatedResults, type DocNode } from "@/services/notes/content";
import { clearDraft, draftIsNewer, readDraft, writeDraft, type NoteDraft } from "@/services/notes/drafts";
import { flushStorage } from "@/services/storage";
import { errorMessage } from "@/components/finance/shared";
import { cn } from "@/lib/utils";
import { NoteEditor } from "./editor/NoteEditor";
import { AttachmentsPanel } from "./AttachmentsPanel";
import { ColorPicker, IconPicker } from "./pickers";
import { NoteIcon } from "./NoteIcon";
import type { NoteCategory } from "./CategoryManager";

type Meta = Pick<NoteRow, "title" | "description" | "categoryId" | "subcategoryId" | "color" | "icon" | "mathEnabled" | "mathDecimals">;
type Status = "saved" | "pending" | "saving" | "error";

const SAVE_DELAY = 900;
const DRAFT_DELAY = 300;

const metaOf = (n: NoteRow): Meta => ({
  title: n.title,
  description: n.description,
  categoryId: n.categoryId,
  subcategoryId: n.subcategoryId,
  color: n.color,
  icon: n.icon,
  mathEnabled: n.mathEnabled,
  mathDecimals: n.mathDecimals,
});

/**
 * Los binarios de adjuntos que ya no usa ninguna nota NO se borran al momento:
 * las copias de seguridad (incluida la previa a este borrado) aún pueden
 * necesitarlos para restaurar la nota completa. Se liberan a petición en
 * Ajustes › Copias de seguridad y recuperación.
 */
async function release(_keys: string[]) {
  /* intencionadamente vacío */
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function NoteDetail({ id, categories, startEditing, onChanged }: { id: string; categories: NoteCategory[]; startEditing: boolean; onChanged: () => void }) {
  const navigate = useNavigate();
  const [note, setNote] = useState<NoteRow | null>(null);
  const [missing, setMissing] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [editing, setEditing] = useState(startEditing);
  const [status, setStatus] = useState<Status>("saved");
  const [showMeta, setShowMeta] = useState(false);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [editorKey, setEditorKey] = useState(0);

  const editorRef = useRef<Editor | null>(null);
  const metaRef = useRef<Meta | null>(null);
  const noteRef = useRef<NoteRow | null>(null);
  const dirtyMeta = useRef(new Set<keyof Meta>());
  const dirtyContent = useRef(false);
  const version = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const draftTimer = useRef<ReturnType<typeof setTimeout>>();
  const saving = useRef<Promise<boolean> | null>(null);
  metaRef.current = meta;
  noteRef.current = note;

  const load = useCallback(async () => {
    try {
      const n = await api.get<NoteRow>(`/notes/${id}`);
      setNote(n);
      setMeta(metaOf(n));
      const d = readDraft(id);
      setDraft(draftIsNewer(d, n.updatedAt) ? d : null);
      if (d && !draftIsNewer(d, n.updatedAt)) clearDraft(id);
    } catch {
      setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const isDirty = () => dirtyContent.current || dirtyMeta.current.size > 0;

  /** Cambios pendientes como parche (el documento solo se serializa aquí). */
  const buildPatch = (): Record<string, unknown> => {
    const patch: Record<string, unknown> = {};
    for (const k of dirtyMeta.current) patch[k] = metaRef.current?.[k];
    if (dirtyContent.current && editorRef.current) patch.content = editorRef.current.getJSON();
    return patch;
  };

  /** Guarda lo pendiente. Nunca hay dos guardados a la vez; lo que llegue durante uno se guarda después. */
  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(saveTimer.current);
    if (saving.current) await saving.current;
    if (!isDirty() || !noteRef.current || noteRef.current.deletedAt) return true;
    const sentVersion = version.current;
    const patch = buildPatch();
    if (typeof patch.title === "string" && !patch.title.trim()) {
      setStatus("error");
      return false; // un título vacío no se guarda; se avisa en el campo
    }
    setStatus("saving");
    const run = (async () => {
      try {
        const r = await api.put<{ note: NoteRow; orphanFileKeys: string[] }>(`/notes/${noteRef.current!.id}`, patch);
        setNote(r.note);
        if (version.current === sentVersion) {
          dirtyMeta.current.clear();
          dirtyContent.current = false;
          setStatus("saved");
          // El borrador de recuperación solo se borra cuando la escritura en
          // disco (IndexedDB, asíncrona) ha terminado: si la pestaña se cierra
          // antes, el borrador sigue ahí para recuperarlo.
          flushStorage().then(() => {
            if (version.current === sentVersion) clearDraft(r.note.id);
          });
        } else {
          setStatus("pending");
          saveTimer.current = setTimeout(() => flush(), SAVE_DELAY);
        }
        await release(r.orphanFileKeys);
        onChanged();
        return true;
      } catch (e) {
        setStatus("error");
        toast.error(`No se pudo guardar: ${errorMessage(e)}. Tus cambios siguen en este dispositivo.`);
        return false;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = run;
    return run;
  }, [onChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Marca un cambio: agrupa escrituras (autoguardado diferido) y guarda borrador de recuperación. */
  const touch = useCallback(() => {
    version.current++;
    setStatus("pending");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => flush(), SAVE_DELAY);
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      if (noteRef.current) writeDraft(noteRef.current.id, noteRef.current.updatedAt, buildPatch());
    }, DRAFT_DELAY);
  }, [flush]); // eslint-disable-line react-hooks/exhaustive-deps

  const setField = <K extends keyof Meta>(k: K, v: Meta[K]) => {
    setMeta((m) => (m ? { ...m, [k]: v } : m));
    metaRef.current = metaRef.current ? { ...metaRef.current, [k]: v } : null;
    dirtyMeta.current.add(k);
    touch();
  };

  // Guardar al salir: al cambiar de página, al ocultar la pestaña y al cerrarla.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      if (noteRef.current) writeDraft(noteRef.current.id, noteRef.current.updatedAt, buildPatch());
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
  }, [flush]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cambios llegados de otro dispositivo: se recargan si aquí no hay nada pendiente.
  useEffect(() => {
    const onSync = async () => {
      if (isDirty()) return;
      try {
        const n = await api.get<NoteRow>(`/notes/${id}`);
        if (n.updatedAt === noteRef.current?.updatedAt) return;
        setNote(n);
        setMeta(metaOf(n));
        setEditorKey((k) => k + 1);
      } catch {
        setMissing(true);
      }
    };
    window.addEventListener("gt:sync-applied", onSync);
    return () => window.removeEventListener("gt:sync-applied", onSync);
  }, [id]);

  async function saveAttachments(next: NoteAttachment[]) {
    await flush();
    const r = await api.put<{ note: NoteRow; orphanFileKeys: string[] }>(`/notes/${id}`, { attachments: next });
    setNote(r.note);
    await release(r.orphanFileKeys);
    onChanged();
  }

  async function action(fn: () => Promise<unknown>, message: string, after?: () => void) {
    if (!(await flush())) return;
    try {
      await fn();
      toast.success(message);
      onChanged();
      after ? after() : load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function recoverDraft() {
    if (!draft || !note) return;
    const { content, ...rest } = draft.patch as Record<string, unknown>;
    setMeta((m) => ({ ...(m as Meta), ...(rest as Partial<Meta>) }));
    for (const k of Object.keys(rest)) dirtyMeta.current.add(k as keyof Meta);
    if (content) {
      setNote({ ...note, content });
      dirtyContent.current = true;
      setEditorKey((k) => k + 1);
    }
    setDraft(null);
    setEditing(true);
    touch();
    toast.success("Cambios recuperados");
  }

  function exportAs(kind: "md" | "html" | "txt") {
    if (!note || !editorRef.current) return;
    const doc = withCalculatedResults(editorRef.current.getJSON() as DocNode, { enabled: meta!.mathEnabled, decimals: meta!.mathDecimals });
    const base = (meta!.title || "nota").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
    if (kind === "md") download(`${base}.md`, `# ${meta!.title}\n\n${docToMarkdown(doc)}`, "text/markdown;charset=utf-8");
    else if (kind === "txt") download(`${base}.txt`, `${meta!.title}\n\n${docToText(doc)}\n`, "text/plain;charset=utf-8");
    else {
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(meta!.title)}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6}</style></head><body><h1>${esc(meta!.title)}</h1>${docToHtml(doc)}</body></html>`;
      download(`${base}.html`, html, "text/html;charset=utf-8");
    }
  }

  if (missing) {
    return <Empty title="Nota no encontrada" description="Puede que se haya eliminado definitivamente." action={<Link to="/notas" className="text-primary text-sm">Volver a las notas</Link>} />;
  }
  if (!note || !meta) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Cargando nota">
        <Loader2 className="animate-spin text-subtle" />
      </div>
    );
  }

  const trashed = !!note.deletedAt;
  const canEdit = editing && !trashed;
  const cat = categories.find((c) => c.id === meta.categoryId);
  const sub = categories.find((c) => c.id === meta.subcategoryId);
  const accent = meta.color ?? cat?.color ?? "#64748b";
  const subs = categories.filter((c) => c.parentId && c.parentId === meta.categoryId);

  return (
    <article className="max-w-4xl mx-auto space-y-4" aria-label={`Nota ${meta.title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={async () => {
            if ((await flush()) || confirm("No se pudieron guardar los últimos cambios (quedan como borrador en este dispositivo). ¿Salir igualmente?")) navigate("/notas");
          }}
          className="h-9 px-2 -ml-2 inline-flex items-center gap-1 rounded-md text-sm text-subtle hover:text-text hover:bg-muted"
        >
          <ArrowLeft size={16} /> Notas
        </button>
        <SaveStatus status={status} onRetry={() => flush()} />
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {!trashed && (
            <Button size="sm" variant={editing ? "secondary" : "primary"} onClick={() => (editing ? flush().then(() => setEditing(false)) : setEditing(true))}>
              {editing ? (
                <>
                  <Eye size={14} /> Ver
                </>
              ) : (
                <>
                  <Pencil size={14} /> Editar
                </>
              )}
            </Button>
          )}
          {trashed ? (
            <>
              <Button size="sm" onClick={() => action(() => api.post(`/notes/${id}/restore`), "Nota restaurada")}>
                <RotateCcw size={14} /> Restaurar
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (!confirm("¿Eliminar definitivamente? No se podrá recuperar.")) return;
                  action(
                    async () => release((await api.delete<{ orphanFileKeys: string[] }>(`/notes/${id}/purge`)).orphanFileKeys),
                    "Nota eliminada definitivamente",
                    () => navigate("/notas?status=trash")
                  );
                }}
              >
                <Trash2 size={14} /> Eliminar definitivamente
              </Button>
            </>
          ) : (
            <>
              <IconBtn label="Duplicar" onClick={() => action(async () => navigate(`/notas/${(await api.post<NoteRow>(`/notes/${id}/duplicate`)).id}`), "Nota duplicada", () => undefined)}>
                <Copy size={16} />
              </IconBtn>
              <IconBtn label={note.archived ? "Desarchivar" : "Archivar"} onClick={() => action(() => api.post(`/notes/${id}/${note.archived ? "unarchive" : "archive"}`), note.archived ? "Nota desarchivada" : "Nota archivada")}>
                {note.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
              </IconBtn>
              <ExportMenu onExport={exportAs} />
              <IconBtn
                label="Eliminar (a la papelera)"
                danger
                onClick={() => {
                  if (!confirm(`¿Enviar «${meta.title}» a la papelera? Podrás restaurarla después.`)) return;
                  action(() => api.delete(`/notes/${id}`), "Nota enviada a la papelera", () => navigate("/notas"));
                }}
              >
                <Trash2 size={16} />
              </IconBtn>
            </>
          )}
        </div>
      </div>

      {draft && (
        <div role="alert" className="rounded-md border border-warning/60 bg-warning/10 p-3 text-sm flex flex-wrap items-center gap-2">
          <span className="flex-1 min-w-[12rem]">Hay cambios sin guardar de una sesión anterior ({new Date(draft.savedAt).toLocaleString()}).</span>
          <Button size="sm" onClick={recoverDraft}>
            Recuperar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              clearDraft(id);
              setDraft(null);
            }}
          >
            Descartar
          </Button>
        </div>
      )}
      {trashed && <p className="text-sm text-warning">Esta nota está en la papelera: restáurala para editarla.</p>}
      {note.archived && !trashed && <Badge>Archivada</Badge>}

      <header className="rounded-lg border-l-4 pl-3 space-y-2" style={{ borderColor: accent }}>
        <div className="flex items-start gap-3">
          <span className="h-11 w-11 shrink-0 rounded-lg flex items-center justify-center mt-0.5" style={{ background: `${accent}22`, color: accent }}>
            <NoteIcon name={meta.icon} size={22} />
          </span>
          <div className="flex-1 min-w-0">
            {canEdit ? (
              <input
                aria-label="Título"
                value={meta.title}
                maxLength={200}
                placeholder="Título de la nota"
                aria-invalid={!meta.title.trim() || undefined}
                onChange={(e) => setField("title", e.target.value)}
                className={cn("w-full bg-transparent gt-heading text-2xl outline-none border-b border-transparent focus:border-border", !meta.title.trim() && "border-danger")}
              />
            ) : (
              <h1 className="gt-heading text-2xl break-words">{meta.title}</h1>
            )}
            {!meta.title.trim() && canEdit && <p className="text-xs text-danger mt-1">El título es obligatorio.</p>}
            {canEdit ? (
              <input
                aria-label="Descripción breve"
                value={meta.description ?? ""}
                maxLength={1000}
                placeholder="Descripción breve (opcional)"
                onChange={(e) => setField("description", e.target.value || null)}
                className="w-full bg-transparent text-sm text-subtle outline-none mt-1"
              />
            ) : (
              meta.description && <p className="text-sm text-subtle mt-1">{meta.description}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
          {cat && (
            <Badge color={cat.color}>
              <NoteIcon name={cat.icon} size={12} /> {cat.name}
            </Badge>
          )}
          {sub && (
            <Badge color={sub.color}>
              <NoteIcon name={sub.icon} size={12} /> {sub.name}
            </Badge>
          )}
          <span>Creada {new Date(note.createdAt).toLocaleString()}</span>
          <span>· Modificada {new Date(note.updatedAt).toLocaleString()}</span>
          {canEdit && (
            <button className="ml-auto inline-flex items-center gap-1 h-8 px-2 rounded-md hover:bg-muted hover:text-text" onClick={() => setShowMeta((v) => !v)} aria-expanded={showMeta}>
              <SlidersHorizontal size={14} /> Categoría, color y símbolo
            </button>
          )}
        </div>
      </header>

      {canEdit && showMeta && (
        <section className="gt-surface p-3 space-y-4" aria-label="Organización y apariencia">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Categoría">
              <Select value={meta.categoryId ?? ""} onChange={(e) => {
                const v = e.target.value || null;
                setField("categoryId", v);
                if (meta.subcategoryId && categories.find((c) => c.id === meta.subcategoryId)?.parentId !== v) setField("subcategoryId", null);
              }}>
                <option value="">Sin categoría</option>
                {categories.filter((c) => !c.parentId).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Subcategoría">
              <Select value={meta.subcategoryId ?? ""} disabled={!subs.length} onChange={(e) => setField("subcategoryId", e.target.value || null)}>
                <option value="">{subs.length ? "Ninguna" : "La categoría no tiene subcategorías"}</option>
                {subs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <ColorPicker value={meta.color} allowDefault label="Color de la nota (predeterminado: el de su categoría)" onChange={(v) => setField("color", v)} />
          <IconPicker value={meta.icon} onChange={(v) => setField("icon", v)} />
        </section>
      )}

      <NoteEditor
        key={editorKey}
        content={note.content}
        editable={canEdit}
        math={{ enabled: meta.mathEnabled, decimals: meta.mathDecimals }}
        onReady={(e) => (editorRef.current = e)}
        onDirty={() => {
          dirtyContent.current = true;
          touch();
        }}
        onMathChange={(m) => {
          if (m.enabled !== meta.mathEnabled) setField("mathEnabled", m.enabled);
          if (m.decimals !== meta.mathDecimals) setField("mathDecimals", m.decimals);
        }}
      />

      <AttachmentsPanel attachments={note.attachments} editable={canEdit} onChange={saveAttachments} />
    </article>
  );
}

function SaveStatus({ status, onRetry }: { status: Status; onRetry: () => void }) {
  const map = {
    saved: { icon: <Check size={14} />, text: "Guardado", cls: "text-success" },
    pending: { icon: <Pencil size={14} />, text: "Cambios sin guardar…", cls: "text-subtle" },
    saving: { icon: <Loader2 size={14} className="animate-spin" />, text: "Guardando…", cls: "text-subtle" },
    error: { icon: <CloudOff size={14} />, text: "No guardado", cls: "text-danger" },
  }[status];
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1 text-xs", map.cls)}>
      {map.icon} {map.text}
      {status === "error" && (
        <button className="underline ml-1" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </span>
  );
}

function IconBtn({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={cn("h-9 w-9 inline-flex items-center justify-center rounded-md text-subtle hover:bg-muted", danger ? "hover:text-danger" : "hover:text-text")}>
      {children}
    </button>
  );
}

function ExportMenu({ onExport }: { onExport: (k: "md" | "html" | "txt") => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <IconBtn label="Exportar" onClick={() => setOpen((v) => !v)}>
        <Download size={16} />
      </IconBtn>
      {open && (
        <div className="absolute right-0 top-10 z-20 gt-surface-pop p-1 w-44" role="menu">
          {(
            [
              ["md", "Markdown (.md)"],
              ["html", "HTML (.html)"],
              ["txt", "Texto (.txt)"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="menuitem"
              className="w-full text-left text-sm px-2 py-2 rounded hover:bg-muted"
              onClick={() => {
                onExport(k);
                setOpen(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
