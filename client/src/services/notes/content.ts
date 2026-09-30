/**
 * Contenido enriquecido de las notas.
 *
 * Se guarda como JSON estructurado de ProseMirror/TipTap (no como HTML): el
 * editor lo vuelve a construir con su esquema, así que nunca se inyecta HTML
 * con `innerHTML`. Aun así, todo JSON que entra (editor, sincronización,
 * copias) pasa por `sanitizeDoc`, con listas blancas de nodos, marcas y
 * atributos: un color como `red; background:url(...)` o un enlace
 * `javascript:` no llegan nunca al DOM.
 */

import { findCalculations } from "./math";

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export const EMPTY_DOC: DocNode = { type: "doc", content: [{ type: "paragraph" }] };

/* ---------------------------------------------------------- listas blancas */

export const FONT_FAMILIES = [
  { label: "Predeterminada", value: null },
  { label: "Sans (Inter)", value: "Inter, system-ui, sans-serif" },
  { label: "Serif (Georgia)", value: "Georgia, 'Times New Roman', serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Trebuchet", value: "'Trebuchet MS', sans-serif" },
  { label: "Monoespaciada", value: "'Courier New', ui-monospace, monospace" },
] as const;

export const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px"] as const;

export const TEXT_COLORS = ["#111827", "#6b7280", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#2563eb", "#7c3aed", "#db2777"] as const;

const FONT_SET = new Set<string>(FONT_FAMILIES.map((f) => f.value).filter((v): v is NonNullable<typeof v> => !!v));
const SIZE_SET = new Set<string>(FONT_SIZES);
const ALIGN = new Set(["left", "center", "right", "justify"]);

const BLOCKS = new Set(["paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "horizontalRule"]);
const INLINE = new Set(["text", "hardBreak"]);
const MARKS = new Set(["bold", "italic", "underline", "strike", "link", "textStyle"]);

export const MAX_DOC_NODES = 50_000;
export const MAX_DOC_TEXT = 200_000;
const MAX_DEPTH = 24;

/** Color seguro en `#rrggbb` (acepta `#rgb` y `rgb(r, g, b)`), o null. */
export function safeColor(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  const m = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/);
  if (m && [m[1], m[2], m[3]].every((x) => Number(x) <= 255)) return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("")}`;
  return null;
}

/** Solo http(s), mailto y tel. Nada de `javascript:`, `data:` ni rutas relativas raras. */
export function safeHref(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length > 2000 || /[\u0000-\u001f\s]/.test(s)) return null;
  try {
    const u = new URL(s);
    return ["http:", "https:", "mailto:", "tel:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- limpieza */

interface Budget {
  nodes: number;
  text: number;
}

function cleanMarks(marks: unknown): DocNode["marks"] {
  if (!Array.isArray(marks)) return undefined;
  const out: NonNullable<DocNode["marks"]> = [];
  const seen = new Set<string>();
  for (const m of marks) {
    if (!m || typeof m !== "object" || !MARKS.has((m as any).type) || seen.has((m as any).type)) continue;
    const type = (m as any).type as string;
    const a = ((m as any).attrs ?? {}) as Record<string, unknown>;
    if (type === "link") {
      const href = safeHref(a.href);
      if (!href) continue; // enlace peligroso: se conserva el texto sin enlace
      out.push({ type, attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow", class: null } });
    } else if (type === "textStyle") {
      const attrs: Record<string, unknown> = {};
      if ("color" in a) attrs.color = a.color === null ? null : safeColor(a.color);
      if ("fontFamily" in a) attrs.fontFamily = typeof a.fontFamily === "string" && FONT_SET.has(a.fontFamily) ? a.fontFamily : null;
      if ("fontSize" in a) attrs.fontSize = typeof a.fontSize === "string" && SIZE_SET.has(a.fontSize) ? a.fontSize : null;
      // Un estilo sin ningún valor no aporta nada.
      if (Object.values(attrs).every((x) => x === null)) continue;
      out.push({ type, attrs });
    } else out.push({ type });
    seen.add(type);
  }
  return out.length ? out : undefined;
}

function cleanNode(n: unknown, depth: number, budget: Budget): DocNode | null {
  if (!n || typeof n !== "object" || depth > MAX_DEPTH) return null;
  const type = (n as any).type;
  if (typeof type !== "string") return null;
  if (++budget.nodes > MAX_DOC_NODES) return null;

  if (type === "text") {
    let text = typeof (n as any).text === "string" ? (n as any).text : "";
    text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
    if (!text) return null;
    if (budget.text + text.length > MAX_DOC_TEXT) text = text.slice(0, Math.max(0, MAX_DOC_TEXT - budget.text));
    budget.text += text.length;
    if (!text) return null;
    const marks = cleanMarks((n as any).marks);
    return marks ? { type, text, marks } : { type, text };
  }
  if (type === "hardBreak") return { type };

  const children = Array.isArray((n as any).content) ? ((n as any).content as unknown[]) : [];
  const content = children.map((c) => cleanNode(c, depth + 1, budget)).filter((c): c is DocNode => !!c);
  const a = ((n as any).attrs ?? {}) as Record<string, unknown>;

  if (type === "doc") return { type, content: content.length ? content : [{ type: "paragraph" }] };
  if (!BLOCKS.has(type)) {
    // Bloque desconocido: se conserva su texto como párrafo (nunca se pierde contenido).
    const inline = content.flatMap((c) => (INLINE.has(c.type) ? [c] : c.content ?? []).filter((x) => INLINE.has(x.type)));
    return inline.length ? { type: "paragraph", content: inline } : null;
  }
  const out: DocNode = { type };
  if (type === "paragraph" || type === "heading") {
    const attrs: Record<string, unknown> = {};
    if ("textAlign" in a) attrs.textAlign = typeof a.textAlign === "string" && ALIGN.has(a.textAlign) ? a.textAlign : null;
    if (type === "heading") attrs.level = [1, 2, 3].includes(Number(a.level)) ? Number(a.level) : 1;
    if (Object.keys(attrs).length) out.attrs = attrs;
    const inline = content.filter((c) => INLINE.has(c.type));
    if (inline.length) out.content = inline;
    return out;
  }
  if (type === "orderedList") {
    const start = Number(a.start);
    out.attrs = { start: Number.isInteger(start) && start >= 1 && start <= 1_000_000 ? start : 1 };
    if ("type" in a) out.attrs.type = a.type === null || ["1", "a", "A", "i", "I"].includes(String(a.type)) ? a.type : null;
  }
  if (type === "horizontalRule") return out;
  // Listas y citas contienen bloques; un texto suelto se envuelve en párrafo.
  const blocks = content.map((c) => (INLINE.has(c.type) ? { type: "paragraph", content: [c] } : c));
  const valid = type === "bulletList" || type === "orderedList" ? blocks.map((b) => (b.type === "listItem" ? b : { type: "listItem", content: [b] })) : blocks;
  out.content = valid.length ? valid : [{ type: "paragraph" }];
  return out;
}

/** Documento limpio y válido a partir de cualquier entrada. */
export function sanitizeDoc(input: unknown): DocNode {
  const budget: Budget = { nodes: 0, text: 0 };
  const root = input && typeof input === "object" && (input as any).type === "doc" ? input : { type: "doc", content: Array.isArray(input) ? input : [] };
  return cleanNode(root, 0, budget) ?? { ...EMPTY_DOC };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => deepEqual(x, (b as unknown[])[i]));
  const ka = Object.keys(a as object).filter((k) => (a as any)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as any)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => deepEqual((a as any)[k], (b as any)[k]));
}

/** ¿El documento ya está limpio? (para validar filas sincronizadas sin reescribirlas) */
export function isSafeDoc(input: unknown): boolean {
  return deepEqual(sanitizeDoc(input), input);
}

/* ------------------------------------------------------------ conversiones */

/** Texto plano: para buscar, vistas previas y exportar como .txt. */
export function docToText(doc: DocNode): string {
  const lines: string[] = [];
  const inline = (n: DocNode): string => (n.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : c.type === "hardBreak" ? "\n" : inline(c))).join("");
  const walk = (n: DocNode, prefix = "") => {
    if (n.type === "paragraph" || n.type === "heading") lines.push(prefix + inline(n));
    else if (n.type === "horizontalRule") lines.push("---");
    else if (n.type === "bulletList" || n.type === "orderedList") {
      let k = Number(n.attrs?.start ?? 1);
      for (const item of n.content ?? []) {
        const mark = n.type === "bulletList" ? "• " : `${k++}. `;
        (item.content ?? []).forEach((b, i) => walk(b, i === 0 ? prefix + mark : prefix + "   "));
      }
    } else for (const c of n.content ?? []) walk(c, prefix);
  };
  walk(doc);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Documento a partir de texto plano (una línea = un párrafo). */
export function textToDoc(text: string): DocNode {
  const paras = text.replace(/\r\n?/g, "\n").split("\n");
  return sanitizeDoc({ type: "doc", content: paras.map((p) => (p ? { type: "paragraph", content: [{ type: "text", text: p }] } : { type: "paragraph" })) });
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** HTML autónomo y seguro (se genera del JSON ya limpio, escapando todo). */
export function docToHtml(input: DocNode): string {
  const doc = sanitizeDoc(input);
  const markOpen = (m: NonNullable<DocNode["marks"]>[number]) => {
    switch (m.type) {
      case "bold":
        return ["<strong>", "</strong>"];
      case "italic":
        return ["<em>", "</em>"];
      case "underline":
        return ["<u>", "</u>"];
      case "strike":
        return ["<s>", "</s>"];
      case "link":
        return [`<a href="${escHtml(String(m.attrs?.href))}" target="_blank" rel="noopener noreferrer nofollow">`, "</a>"];
      case "textStyle": {
        const a = m.attrs ?? {};
        const css = [a.color && `color:${a.color}`, a.fontFamily && `font-family:${a.fontFamily}`, a.fontSize && `font-size:${a.fontSize}`].filter(Boolean).join(";");
        return css ? [`<span style="${escHtml(css)}">`, "</span>"] : ["", ""];
      }
      default:
        return ["", ""];
    }
  };
  const render = (n: DocNode): string => {
    const inner = () => (n.content ?? []).map(render).join("");
    const align = n.attrs?.textAlign ? ` style="text-align:${n.attrs.textAlign}"` : "";
    switch (n.type) {
      case "doc":
        return inner();
      case "text": {
        let html = escHtml(n.text ?? "");
        for (const m of [...(n.marks ?? [])].reverse()) {
          const [o, c] = markOpen(m);
          html = o + html + c;
        }
        return html;
      }
      case "hardBreak":
        return "<br>";
      case "paragraph":
        return `<p${align}>${inner()}</p>`;
      case "heading":
        return `<h${n.attrs?.level}${align}>${inner()}</h${n.attrs?.level}>`;
      case "bulletList":
        return `<ul>${inner()}</ul>`;
      case "orderedList":
        return `<ol start="${Number(n.attrs?.start ?? 1)}">${inner()}</ol>`;
      case "listItem":
        return `<li>${inner()}</li>`;
      case "blockquote":
        return `<blockquote>${inner()}</blockquote>`;
      case "horizontalRule":
        return "<hr>";
      default:
        return inner();
    }
  };
  return render(doc);
}

/** Markdown (lo que Markdown no tiene —color, tipografía, subrayado— se omite). */
export function docToMarkdown(input: DocNode): string {
  const doc = sanitizeDoc(input);
  const esc = (s: string) => s.replace(/([\\`*_[\]#>~|])/g, "\\$1");
  const inline = (n: DocNode): string =>
    (n.content ?? [])
      .map((c) => {
        if (c.type === "hardBreak") return "  \n";
        let t = esc(c.text ?? "");
        const has = (x: string) => c.marks?.some((m) => m.type === x);
        if (has("bold")) t = `**${t}**`;
        if (has("italic")) t = `_${t}_`;
        if (has("strike")) t = `~~${t}~~`;
        const link = c.marks?.find((m) => m.type === "link");
        if (link) t = `[${t}](${String(link.attrs?.href).replace(/[()]/g, encodeURIComponent)})`;
        return t;
      })
      .join("");
  const blocks: string[] = [];
  const walk = (n: DocNode, indent = "") => {
    if (n.type === "paragraph") blocks.push(indent + inline(n));
    else if (n.type === "heading") blocks.push(`${"#".repeat(Number(n.attrs?.level ?? 1))} ${inline(n)}`);
    else if (n.type === "horizontalRule") blocks.push("---");
    else if (n.type === "blockquote") (n.content ?? []).forEach((c) => walk(c, `${indent}> `));
    else if (n.type === "bulletList" || n.type === "orderedList") {
      let k = Number(n.attrs?.start ?? 1);
      for (const item of n.content ?? []) {
        const mark = n.type === "bulletList" ? "- " : `${k++}. `;
        (item.content ?? []).forEach((b, i) => {
          if (b.type === "paragraph") blocks.push(`${indent}${i === 0 ? mark : "   "}${inline(b)}`);
          else walk(b, `${indent}   `);
        });
      }
    } else (n.content ?? []).forEach((c) => walk(c, indent));
  };
  walk(doc);
  return blocks.join("\n\n").replace(/\n\n(?=(\s*(- |\d+\. )))/g, "\n") + "\n";
}

/* ------------------------------------------------ resultados de cálculos */

/**
 * Copia del documento con los resultados automáticos escritos como texto
 * («200+200=» -> «200+200=400»). En el editor esos resultados se DIBUJAN
 * sin guardarse (así nunca se duplican ni mueven el cursor); aquí se
 * materializan para exportar, buscar y mostrar vistas previas.
 */
export function withCalculatedResults(input: DocNode, opts: { enabled: boolean; decimals: number | null }): DocNode {
  const doc = sanitizeDoc(input);
  if (!opts.enabled) return doc;
  const visit = (n: DocNode): DocNode => {
    if (n.type !== "paragraph" && n.type !== "heading") return n.content ? { ...n, content: n.content.map(visit) } : n;
    const inline = n.content ?? [];
    const text = inline.map((c) => (c.type === "text" ? c.text ?? "" : "￼")).join("");
    const inserts = findCalculations(text, { decimals: opts.decimals }).filter((c) => c.result !== null && !c.manual);
    if (!inserts.length) return n;
    const at = new Map(inserts.map((c) => [c.eq + 1, c.result!]));
    const out: DocNode[] = [];
    let offset = 0;
    for (const c of inline) {
      const len = c.type === "text" ? (c.text ?? "").length : 1;
      if (c.type !== "text") {
        out.push(c);
        offset += len;
        continue;
      }
      let last = 0;
      for (let k = 1; k <= len; k++) {
        const result = at.get(offset + k);
        if (result === undefined) continue;
        out.push({ ...c, text: c.text!.slice(last, k) }, { type: "text", text: result, ...(c.marks ? { marks: c.marks } : {}) });
        last = k;
      }
      if (last < len) out.push({ ...c, text: c.text!.slice(last) });
      offset += len;
    }
    return { ...n, content: out };
  };
  return visit(doc);
}
