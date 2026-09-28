import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Renderizador de Markdown básico.
 *
 * Decisión de diseño: construye elementos de React, nunca HTML en crudo. Al no
 * existir un `dangerouslySetInnerHTML`, no hay superficie de XSS aunque la
 * descripción venga de una copia de seguridad ajena o de otro dispositivo por
 * sincronización — el marcado que el usuario escriba se escapa solo.
 *
 * Soporta: encabezados (#..###), listas con y sin orden, checklists,
 * citas, reglas, bloques y fragmentos de código, negrita, cursiva, tachado y
 * enlaces (solo http/https/mailto).
 */

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

/** Solo se enlazan esquemas inertes: descarta `javascript:` y `data:`. */
function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Aplica el formato de línea (negrita, código, enlaces...) de forma recursiva. */
function inline(text: string, keyPrefix = ""): ReactNode[] {
  const parts = text.split(INLINE).filter((p) => p !== "" && p !== undefined);

  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;

    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={key} className="gt-mono text-[0.85em] bg-muted rounded px-1 py-0.5">
          {part.slice(1, -1)}
        </code>
      );
    }
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={key}>{inline(part.slice(2, -2), key)}</strong>;
    }
    if (part.startsWith("~~") && part.endsWith("~~")) {
      return (
        <span key={key} className="line-through opacity-70">
          {inline(part.slice(2, -2), key)}
        </span>
      );
    }
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      if (part.length > 2) return <em key={key}>{inline(part.slice(1, -1), key)}</em>;
    }

    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const href = safeHref(link[2].trim());
      if (!href) return <Fragment key={key}>{link[1]}</Fragment>;
      return (
        <a
          key={key}
          href={href}
          target="_blank"
          // noopener/noreferrer: la pestaña abierta no recibe window.opener.
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:opacity-80"
        >
          {link[1]}
        </a>
      );
    }

    return <Fragment key={key}>{part}</Fragment>;
  });
}

interface Block {
  type: "p" | "h1" | "h2" | "h3" | "ul" | "ol" | "quote" | "code" | "hr";
  lines: string[];
  lang?: string;
}

/** Agrupa las líneas en bloques antes de renderizar (listas, código, citas). */
function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") { i++; continue; }

    // Bloque de código cercado: se consume literal hasta el cierre.
    const fence = /^```(\w*)\s*$/.exec(line.trim());
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) body.push(lines[i++]);
      i++; // cierre
      blocks.push({ type: "code", lines: body, lang: fence[1] || undefined });
      continue;
    }

    if (/^(---|\*\*\*|___)\s*$/.test(line.trim())) {
      blocks.push({ type: "hr", lines: [] });
      i++;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: `h${heading[1].length}` as Block["type"], lines: [heading[2]] });
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ type: "quote", lines: body });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        body.push(lines[i++].replace(/^\s*[-*+]\s+/, ""));
      }
      blocks.push({ type: "ul", lines: body });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        body.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      }
      blocks.push({ type: "ol", lines: body });
      continue;
    }

    // Párrafo: líneas seguidas hasta un salto en blanco o el inicio de otro bloque.
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3}\s|>|\s*[-*+]\s|\s*\d+[.)]\s|```|---)/.test(lines[i])
    ) {
      body.push(lines[i++]);
    }
    blocks.push({ type: "p", lines: body });
  }

  return blocks;
}

/** Ítem de lista, con soporte para `- [ ]` / `- [x]`. */
function ListItem({ text, k }: { text: string; k: string }) {
  const task = /^\[( |x|X)\]\s+(.*)$/.exec(text);
  if (!task) return <li>{inline(text, k)}</li>;
  const done = task[1].toLowerCase() === "x";
  return (
    <li className="list-none -ml-5 flex items-start gap-2">
      <input
        type="checkbox"
        checked={done}
        readOnly
        // Solo lectura: el checklist editable de verdad es `SubtaskList`.
        className="mt-1 accent-primary pointer-events-none"
        tabIndex={-1}
      />
      <span className={cn(done && "line-through text-subtle")}>{inline(task[2], k)}</span>
    </li>
  );
}

export function Markdown({ children, className }: { children?: string | null; className?: string }) {
  if (!children?.trim()) return null;
  const blocks = parseBlocks(children);

  return (
    <div className={cn("text-sm leading-relaxed space-y-3", className)}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.type) {
          case "h1":
            return <h3 key={k} className="gt-heading text-base">{inline(b.lines[0], k)}</h3>;
          case "h2":
            return <h4 key={k} className="gt-heading text-sm">{inline(b.lines[0], k)}</h4>;
          case "h3":
            return <h5 key={k} className="gt-heading text-sm text-subtle">{inline(b.lines[0], k)}</h5>;
          case "hr":
            return <hr key={k} className="border-t border-t-theme border-border" />;
          case "code":
            return (
              <pre
                key={k}
                className="gt-mono text-xs bg-muted rounded-md p-3 overflow-x-auto"
                data-lang={b.lang}
              >
                <code>{b.lines.join("\n")}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote key={k} className="border-l-2 border-primary/50 pl-3 text-subtle italic">
                {inline(b.lines.join(" "), k)}
              </blockquote>
            );
          case "ul":
            return (
              <ul key={k} className="list-disc pl-5 space-y-1">
                {b.lines.map((l, j) => (
                  <ListItem key={`${k}-${j}`} text={l} k={`${k}-${j}`} />
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={k} className="list-decimal pl-5 space-y-1">
                {b.lines.map((l, j) => (
                  <li key={`${k}-${j}`}>{inline(l, `${k}-${j}`)}</li>
                ))}
              </ol>
            );
          default:
            return <p key={k}>{inline(b.lines.join(" "), k)}</p>;
        }
      })}
    </div>
  );
}
