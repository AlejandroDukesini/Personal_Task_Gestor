import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Download, ExternalLink, FileWarning, Paperclip, Pencil, RefreshCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { newId, type NoteAttachment } from "@/services/localDb";
import { formatBytes, getFile, inspectAttachment, MAX_NOTE_BYTES, putFile, typeOf } from "@/services/notes/files";
import { MAX_ATTACHMENTS } from "@/services/notes/schemas";
import { cn } from "@/lib/utils";

interface Props {
  attachments: NoteAttachment[];
  editable: boolean;
  /** Guarda la nueva lista de adjuntos (la nota se guarda de inmediato). */
  onChange: (next: NoteAttachment[]) => Promise<void>;
}

async function toAttachment(file: File, total: number): Promise<{ att?: NoteAttachment; error?: string }> {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const r = inspectAttachment(file.name, file.size, head);
  if (!r.ok || !r.type) return { error: r.error };
  if (total + file.size > MAX_NOTE_BYTES) return { error: `«${r.name}»: la nota superaría ${formatBytes(MAX_NOTE_BYTES)} de adjuntos` };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileKey = await putFile(bytes);
  return {
    att: { id: newId(), fileKey, name: r.name, label: null, kind: r.type.kind, mime: r.type.mime, size: file.size, addedAt: new Date().toISOString() },
  };
}

/** URL temporal de un adjunto, con el MIME de nuestro registro (nunca el del archivo). */
async function blobUrl(a: NoteAttachment, forDownload = false): Promise<string | null> {
  const bytes = await getFile(a.fileKey);
  if (!bytes) return null;
  const mime = forDownload ? "application/octet-stream" : typeOf(a.kind)?.mime ?? "application/octet-stream";
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
}

export function AttachmentsPanel({ attachments, editable, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ att: NoteAttachment; kind: "image" | "text"; src: string } | null>(null);
  const total = attachments.reduce((s, a) => s + a.size, 0);

  async function addFiles(files: File[]) {
    if (!files.length) return;
    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      toast.error(`Máximo ${MAX_ATTACHMENTS} adjuntos por nota`);
      return;
    }
    setBusy(true);
    const added: NoteAttachment[] = [];
    const errors: string[] = [];
    let size = total;
    try {
      for (const f of files) {
        const r = await toAttachment(f, size);
        if (r.att) {
          added.push(r.att);
          size += r.att.size;
        } else if (r.error) errors.push(r.error);
      }
      if (added.length) {
        await onChange([...attachments, ...added]);
        toast.success(`${added.length} archivo(s) adjuntado(s)`);
      }
      errors.forEach((e) => toast.error(e, { duration: 6000 }));
    } catch (e) {
      toast.error(`No se pudo guardar el archivo: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function replace(id: string, file: File) {
    const old = attachments.find((a) => a.id === id);
    if (!old) return;
    setBusy(true);
    try {
      const r = await toAttachment(file, total - old.size);
      if (r.error || !r.att) {
        toast.error(r.error ?? "No se pudo reemplazar");
        return;
      }
      await onChange(attachments.map((a) => (a.id === id ? { ...r.att!, id, label: old.label } : a)));
      toast.success("Archivo reemplazado");
    } finally {
      setBusy(false);
      setReplacing(null);
    }
  }

  async function open(a: NoteAttachment) {
    const type = typeOf(a.kind);
    if (type?.preview === "image") {
      const src = await blobUrl(a);
      if (!src) return toast.error("Este archivo no está en este dispositivo (se adjuntó en otro)");
      setPreview({ att: a, kind: "image", src });
    } else if (type?.preview === "text") {
      const bytes = await getFile(a.fileKey);
      if (!bytes) return toast.error("Este archivo no está en este dispositivo (se adjuntó en otro)");
      // Se muestra como texto plano (nunca como HTML), y como mucho 200 KB.
      setPreview({ att: a, kind: "text", src: new TextDecoder().decode(bytes.subarray(0, 200_000)) });
    } else if (type?.preview === "pdf") {
      const url = await blobUrl(a);
      if (!url) return toast.error("Este archivo no está en este dispositivo (se adjuntó en otro)");
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } else await download(a);
  }

  async function download(a: NoteAttachment) {
    const url = await blobUrl(a, true);
    if (!url) return toast.error("Este archivo no está en este dispositivo (se adjuntó en otro)");
    const link = document.createElement("a");
    link.href = url;
    link.download = a.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function remove(a: NoteAttachment) {
    if (!confirm(`¿Quitar «${a.label ?? a.name}» de la nota?`)) return;
    await onChange(attachments.filter((x) => x.id !== a.id));
  }

  async function rename(a: NoteAttachment) {
    const next = prompt("Nombre o descripción del adjunto", a.label ?? a.name);
    if (next === null) return;
    const label = next.trim().slice(0, 160);
    await onChange(attachments.map((x) => (x.id === a.id ? { ...x, label: label && label !== a.name ? label : null } : x)));
  }

  useEffect(() => () => {
    if (preview?.kind === "image") URL.revokeObjectURL(preview.src);
  }, [preview]);

  return (
    <section
      aria-label="Archivos adjuntos"
      className={cn("rounded-md border border-dashed p-3 space-y-2 transition-colors", dragging ? "border-primary bg-primary/5" : "border-border")}
      onDragOver={(e) => {
        if (!editable) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!editable) return;
        e.preventDefault();
        setDragging(false);
        addFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <Paperclip size={14} aria-hidden /> Adjuntos {attachments.length > 0 && <span className="text-subtle font-normal">({attachments.length} · {formatBytes(total)})</span>}
        </h3>
        {editable && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => inputRef.current?.click()} loading={busy}>
            <Upload size={14} /> Adjuntar
          </Button>
        )}
      </div>
      {editable && <p className="text-xs text-subtle">Arrastra aquí o elige archivos: PDF, imágenes, Word, Excel, PowerPoint, texto… (máx. 15 MB cada uno).</p>}
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; addFiles(f); }} />
      <input ref={replaceRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f && replacing) replace(replacing, f); }} />
      {attachments.length > 0 && (
        <ul className="divide-y divide-border">
          {attachments.map((a) => (
            <AttachmentRow
              key={a.id}
              a={a}
              editable={editable}
              onOpen={() => open(a).catch((e) => toast.error((e as Error).message))}
              onDownload={() => download(a).catch((e) => toast.error((e as Error).message))}
              onRename={() => rename(a)}
              onReplace={() => {
                setReplacing(a.id);
                replaceRef.current?.click();
              }}
              onRemove={() => remove(a)}
            />
          ))}
        </ul>
      )}

      <Dialog open={!!preview} onClose={() => setPreview(null)} title={preview ? preview.att.label ?? preview.att.name : ""} size="lg">
        {preview?.kind === "image" && <img src={preview.src} alt={preview.att.label ?? preview.att.name} className="max-h-[70vh] w-auto mx-auto rounded-md" />}
        {preview?.kind === "text" && <pre className="max-h-[70vh] overflow-auto text-xs whitespace-pre-wrap break-words gt-surface p-3">{preview.src}</pre>}
      </Dialog>
    </section>
  );
}

function AttachmentRow({ a, editable, onOpen, onDownload, onRename, onReplace, onRemove }: { a: NoteAttachment; editable: boolean; onOpen: () => void; onDownload: () => void; onRename: () => void; onReplace: () => void; onRemove: () => void }) {
  const type = typeOf(a.kind);
  const [thumb, setThumb] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    getFile(a.fileKey)
      .then((bytes) => {
        if (!alive) return;
        if (!bytes) return setMissing(true);
        if (type?.preview === "image") {
          url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: type.mime }));
          setThumb(url);
        }
      })
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [a.fileKey, type]);

  const btn = "h-9 w-9 inline-flex items-center justify-center rounded-md text-subtle hover:text-text hover:bg-muted";
  return (
    <li className="py-2 flex items-center gap-3">
      <button type="button" onClick={onOpen} className="h-12 w-12 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center text-[10px] font-semibold uppercase text-subtle" aria-label={`Abrir ${a.label ?? a.name}`}>
        {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : missing ? <FileWarning size={18} aria-hidden /> : a.name.split(".").pop()}
      </button>
      <div className="flex-1 min-w-0">
        <button type="button" onClick={onOpen} className="block text-sm font-medium truncate max-w-full text-left hover:underline">
          {a.label ?? a.name}
        </button>
        <p className="text-xs text-subtle truncate">
          {a.label ? `${a.name} · ` : ""}
          {type?.label ?? a.kind} · {formatBytes(a.size)} · {new Date(a.addedAt).toLocaleDateString()}
          {missing && <span className="text-warning"> · no disponible en este dispositivo</span>}
        </p>
      </div>
      <div className="flex items-center shrink-0">
        {type?.preview && (
          <button className={btn} onClick={onOpen} aria-label="Abrir" title="Abrir">
            <ExternalLink size={15} />
          </button>
        )}
        <button className={btn} onClick={onDownload} aria-label="Descargar" title="Descargar">
          <Download size={15} />
        </button>
        {editable && (
          <>
            <button className={btn} onClick={onRename} aria-label="Renombrar" title="Nombre o descripción">
              <Pencil size={15} />
            </button>
            <button className={btn} onClick={onReplace} aria-label="Reemplazar" title="Reemplazar por otro archivo">
              <RefreshCw size={15} />
            </button>
            <button className={cn(btn, "hover:text-danger")} onClick={onRemove} aria-label="Quitar" title="Quitar">
              <Trash2 size={15} />
            </button>
          </>
        )}
      </div>
    </li>
  );
}
