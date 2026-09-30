import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Calculator,
  CheckCheck,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Palette,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import toast from "react-hot-toast";
import { docToText, FONT_FAMILIES, FONT_SIZES, safeHref, sanitizeDoc, TEXT_COLORS, textToDoc } from "@/services/notes/content";
import { cn } from "@/lib/utils";
import { noteExtensions } from "./extensions";
import { fixResults, type MathOptions } from "./mathCalc";

interface Props {
  content: unknown;
  editable: boolean;
  math: MathOptions;
  /** Se llama en cada cambio (barato: no serializa el documento). */
  onDirty?: () => void;
  onReady?: (editor: Editor | null) => void;
  onMathChange?: (math: MathOptions) => void;
}

export function NoteEditor({ content, editable, math, onDirty, onReady, onMathChange }: Props) {
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  const editor = useEditor({
    extensions: noteExtensions(math),
    content: sanitizeDoc(content),
    editable,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: "note-content min-h-[40vh] px-1 py-2", "aria-label": "Contenido de la nota", role: "textbox", "aria-multiline": "true" },
    },
    onUpdate: () => onDirtyRef.current?.(),
    // Contenido que el esquema no admite (p. ej. de una versión futura): se conserva el texto.
    enableContentCheck: true,
    onContentError: ({ editor: e, disableCollaboration }) => {
      disableCollaboration();
      e.commands.setContent(textToDoc(docToText(sanitizeDoc(content))));
    },
  });

  useEffect(() => {
    onReady?.(editor);
    return () => onReady?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    // Sin emitir «update»: cambiar a modo edición no es un cambio del contenido.
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  useEffect(() => {
    editor?.commands.setMathOptions(math);
  }, [editor, math.enabled, math.decimals]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) return null;
  return (
    <div className="flex flex-col gap-2">
      {editable && <Toolbar editor={editor} math={math} onMathChange={onMathChange} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // no roba la selección del editor
      onClick={onClick}
      className={cn(
        "h-9 min-w-9 px-2 shrink-0 inline-flex items-center justify-center rounded-md text-sm transition-colors disabled:opacity-40",
        active ? "bg-primary/15 text-primary" : "text-subtle hover:bg-muted hover:text-text"
      )}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="w-px h-6 bg-border shrink-0 mx-0.5" aria-hidden />;

function Toolbar({ editor, math, onMathChange }: { editor: Editor; math: MathOptions; onMathChange?: (m: MathOptions) => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      link: e.isActive("link"),
      block: e.isActive("heading", { level: 1 }) ? "h1" : e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : "p",
      align: (["center", "right", "justify"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
      font: (e.getAttributes("textStyle").fontFamily as string | undefined) ?? "",
      size: (e.getAttributes("textStyle").fontSize as string | undefined) ?? "",
      color: (e.getAttributes("textStyle").color as string | undefined) ?? "",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const [palette, setPalette] = useState(false);
  const c = () => editor.chain().focus();

  function setBlock(v: string) {
    if (v === "p") c().setParagraph().run();
    else c().setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run();
  }

  function editLink() {
    const current = editor.getAttributes("link").href as string | undefined;
    const input = window.prompt("Dirección del enlace (https://…, mailto:…)", current ?? "https://");
    if (input === null) return;
    if (!input.trim()) {
      c().extendMarkRange("link").unsetLink().run();
      return;
    }
    const href = safeHref(/^[a-z]+:/i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
    if (!href) {
      toast.error("Enlace no válido: usa una dirección http(s), mailto o tel");
      return;
    }
    if (editor.state.selection.empty && !s.link) c().insertContent({ type: "text", text: input.trim(), marks: [{ type: "link", attrs: { href } }] }).run();
    else c().extendMarkRange("link").setLink({ href }).run();
  }

  return (
    <div
      role="toolbar"
      aria-label="Formato del texto"
      className="sticky top-0 z-10 -mx-1 px-1 py-1 bg-surface/95 backdrop-blur border-b border-border flex items-center gap-0.5 overflow-x-auto sm:flex-wrap"
    >
      <ToolButton label="Deshacer (Ctrl+Z)" disabled={!s.canUndo} onClick={() => c().undo().run()}>
        <Undo2 size={16} />
      </ToolButton>
      <ToolButton label="Rehacer (Ctrl+Y)" disabled={!s.canRedo} onClick={() => c().redo().run()}>
        <Redo2 size={16} />
      </ToolButton>
      <Sep />
      <select aria-label="Estilo de párrafo" value={s.block} onChange={(e) => setBlock(e.target.value)} className="gt-field h-9 text-sm px-2 shrink-0 w-[7.5rem]">
        <option value="p">Cuerpo</option>
        <option value="h1">Título</option>
        <option value="h2">Subtítulo</option>
        <option value="h3">Sección</option>
      </select>
      <select
        aria-label="Tipografía"
        value={s.font}
        onChange={(e) => (e.target.value ? c().setFontFamily(e.target.value).run() : c().unsetFontFamily().run())}
        className="gt-field h-9 text-sm px-2 shrink-0 w-[10rem]"
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f.label} value={f.value ?? ""} style={f.value ? { fontFamily: f.value } : undefined}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Tamaño del texto"
        value={s.size}
        onChange={(e) => (e.target.value ? c().setFontSize(e.target.value).run() : c().unsetFontSize().run())}
        className="gt-field h-9 text-sm px-2 shrink-0 w-[6.75rem]"
      >
        <option value="">Tamaño</option>
        {FONT_SIZES.map((z) => (
          <option key={z} value={z}>
            {z.replace("px", "")}
          </option>
        ))}
      </select>
      <Sep />
      <ToolButton label="Negrita (Ctrl+B)" active={s.bold} onClick={() => c().toggleBold().run()}>
        <Bold size={16} />
      </ToolButton>
      <ToolButton label="Cursiva (Ctrl+I)" active={s.italic} onClick={() => c().toggleItalic().run()}>
        <Italic size={16} />
      </ToolButton>
      <ToolButton label="Subrayado (Ctrl+U)" active={s.underline} onClick={() => c().toggleUnderline().run()}>
        <Underline size={16} />
      </ToolButton>
      <ToolButton label="Tachado" active={s.strike} onClick={() => c().toggleStrike().run()}>
        <Strikethrough size={16} />
      </ToolButton>
      <div className="relative shrink-0">
        <ToolButton label="Color del texto" active={!!s.color} onClick={() => setPalette((v) => !v)}>
          <Palette size={16} style={s.color ? { color: s.color } : undefined} />
        </ToolButton>
        {palette && (
          <div className="absolute left-0 top-10 z-20 gt-surface-pop p-2 w-52 space-y-2" onMouseDown={(e) => e.preventDefault()}>
            <div className="grid grid-cols-5 gap-1.5">
              {TEXT_COLORS.map((col) => (
                <button
                  key={col}
                  type="button"
                  aria-label={`Color ${col}`}
                  className={cn("h-7 w-7 rounded-md border border-border", s.color === col && "ring-2 ring-primary ring-offset-1")}
                  style={{ background: col }}
                  onClick={() => {
                    c().setColor(col).run();
                    setPalette(false);
                  }}
                />
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs">
              Personalizado
              <input type="color" className="h-7 w-10 p-0 border border-border rounded" value={s.color || "#111827"} onChange={(e) => c().setColor(e.target.value).run()} />
            </label>
            <button
              type="button"
              className="text-xs text-subtle hover:text-text"
              onClick={() => {
                c().unsetColor().run();
                setPalette(false);
              }}
            >
              Color predeterminado
            </button>
          </div>
        )}
      </div>
      <Sep />
      <ToolButton label="Lista con viñetas" active={s.bullet} onClick={() => c().toggleBulletList().run()}>
        <List size={16} />
      </ToolButton>
      <ToolButton label="Lista numerada" active={s.ordered} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered size={16} />
      </ToolButton>
      <Sep />
      {(
        [
          ["left", AlignLeft, "Alinear a la izquierda"],
          ["center", AlignCenter, "Centrar"],
          ["right", AlignRight, "Alinear a la derecha"],
          ["justify", AlignJustify, "Justificar"],
        ] as const
      ).map(([a, Icon, label]) => (
        <ToolButton key={a} label={label} active={s.align === a} onClick={() => c().setTextAlign(a).run()}>
          <Icon size={16} />
        </ToolButton>
      ))}
      <Sep />
      <ToolButton label={s.link ? "Editar enlace" : "Insertar enlace"} active={s.link} onClick={editLink}>
        <Link2 size={16} />
      </ToolButton>
      {s.link && (
        <ToolButton label="Quitar enlace" onClick={() => c().extendMarkRange("link").unsetLink().run()}>
          <Link2Off size={16} />
        </ToolButton>
      )}
      <Sep />
      <ToolButton label={math.enabled ? "Desactivar cálculos automáticos" : "Activar cálculos automáticos"} active={math.enabled} onClick={() => onMathChange?.({ ...math, enabled: !math.enabled })}>
        <Calculator size={16} />
      </ToolButton>
      {math.enabled && (
        <>
          <select
            aria-label="Decimales de los resultados"
            value={math.decimals ?? ""}
            onChange={(e) => onMathChange?.({ ...math, decimals: e.target.value === "" ? null : Number(e.target.value) })}
            className="gt-field h-9 text-sm px-2 shrink-0 w-[9.5rem]"
          >
            <option value="">Decimales: auto</option>
            {[0, 1, 2, 3, 4, 6, 8].map((d) => (
              <option key={d} value={d}>
                {d} decimales
              </option>
            ))}
          </select>
          <ToolButton
            label="Fijar los resultados como texto (Ctrl+Mayús+Intro fija el del cursor)"
            onClick={() => {
              const n = fixResults(editor);
              toast.success(n ? `${n} resultado(s) fijados como texto` : "No hay resultados automáticos que fijar");
            }}
          >
            <CheckCheck size={16} />
          </ToolButton>
        </>
      )}
    </div>
  );
}
