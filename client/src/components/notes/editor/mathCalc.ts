/**
 * Cálculos automáticos dentro del editor.
 *
 * Cómo funciona:
 *   - El resultado de `200+200=` NO se escribe en el documento: se DIBUJA
 *     como una decoración justo después del `=`. Así nunca se duplica, nunca
 *     mueve el cursor y se actualiza solo al cambiar la expresión.
 *   - Solo se recalculan los párrafos afectados por cada cambio (no todo el
 *     documento en cada pulsación).
 *   - El usuario decide: dejar el resultado automático, convertirlo en texto
 *     normal (clic en el resultado o Ctrl/Cmd+Mayús+Intro) o escribirlo a
 *     mano. Un resultado escrito a mano que no coincide se marca.
 *   - Una expresión incompleta o con división entre cero se subraya de forma
 *     discreta con el motivo; nunca se muestra un resultado incorrecto.
 */

import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { findCalculations } from "@/services/notes/math";

export interface MathOptions {
  enabled: boolean;
  decimals: number | null;
}

interface MathState extends MathOptions {
  decos: DecorationSet;
}

export const mathKey = new PluginKey<MathState>("noteMath");

/** Resultado automático en la posición `pos` (justo tras un `=`), si lo hay. */
interface AutoResult {
  pos: number;
  result: string;
}

function blockDecorations(node: PMNode, start: number, opts: MathOptions): Decoration[] {
  if (!opts.enabled || !node.isTextblock) return [];
  // Un carácter por posición: el texto y los nodos hoja (saltos de línea) ocupan 1.
  const text = node.textBetween(0, node.content.size, undefined, "￼");
  if (!text.includes("=")) return [];
  const base = start + 1;
  const out: Decoration[] = [];
  for (const c of findCalculations(text, { decimals: opts.decimals })) {
    const exprFrom = base + c.from;
    const eqTo = base + c.eq + 1;
    if (c.error) {
      out.push(Decoration.inline(exprFrom, eqTo, { class: "note-calc-error", title: `${c.error}: corrige la expresión`, "aria-invalid": "true" }));
      continue;
    }
    if (c.manual) {
      const mFrom = base + c.manual.from;
      const mTo = base + c.manual.to;
      if (c.manual.mismatch) {
        out.push(Decoration.inline(mFrom, mTo, { class: "note-calc-mismatch", title: `El resultado calculado es ${c.result}` }));
      } else {
        out.push(Decoration.inline(exprFrom, mTo, { class: "note-calc-expr note-calc-checked", title: "Resultado comprobado" }));
      }
      continue;
    }
    out.push(Decoration.inline(exprFrom, eqTo, { class: "note-calc-expr" }));
    out.push(
      Decoration.widget(eqTo, (view, getPos) => resultWidget(view, getPos, c.result!, c.exact), {
        side: 1,
        ignoreSelection: true,
        // Misma clave = mismo nodo DOM: no se redibuja si el resultado no cambia.
        key: `calc:${c.result}`,
        marks: [],
      })
    );
  }
  return out;
}

function resultWidget(view: EditorView, getPos: () => number | undefined, result: string, exact: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = "note-calc-result";
  el.textContent = result;
  el.contentEditable = "false";
  el.setAttribute("data-calc-result", result);
  el.setAttribute("role", "button");
  el.title = `${exact ? "" : "Resultado redondeado. "}Resultado automático: clic para fijarlo como texto`;
  el.setAttribute("aria-label", `Resultado ${result}. Fijar como texto`);
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("click", (e) => {
    e.preventDefault();
    const pos = getPos();
    if (!view.editable || pos === undefined) return;
    view.dispatch(view.state.tr.insertText(result, pos));
    view.focus();
  });
  return el;
}

function fullSet(doc: PMNode, opts: MathOptions): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      decos.push(...blockDecorations(node, pos, opts));
      return false;
    }
    return true;
  });
  return DecorationSet.create(doc, decos);
}

/** Rangos (en el documento final) que tocó una transacción. */
function changedRanges(tr: Transaction): [number, number][] {
  const out: [number, number][] = [];
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => out.push([rest.map(newStart, -1), rest.map(newEnd, 1)]));
  });
  return out;
}

function applyTr(tr: Transaction, prev: MathState, state: EditorState): MathState {
  const meta = tr.getMeta(mathKey) as Partial<MathOptions> | undefined;
  if (meta) {
    const opts = { enabled: meta.enabled ?? prev.enabled, decimals: meta.decimals !== undefined ? meta.decimals : prev.decimals };
    return { ...opts, decos: fullSet(state.doc, opts) };
  }
  if (!tr.docChanged) return prev;
  let decos = prev.decos.map(tr.mapping, tr.doc);
  const seen = new Set<number>();
  for (const [from, to] of changedRanges(tr)) {
    const a = Math.max(0, Math.min(from, tr.doc.content.size));
    const b = Math.max(a, Math.min(to, tr.doc.content.size));
    tr.doc.nodesBetween(a, b, (node, pos) => {
      if (!node.isTextblock) return true;
      if (!seen.has(pos)) {
        seen.add(pos);
        decos = decos.remove(decos.find(pos, pos + node.nodeSize));
        decos = decos.add(tr.doc, blockDecorations(node, pos, prev));
      }
      return false;
    });
  }
  return { ...prev, decos };
}

/** Resultados automáticos visibles (para fijarlos como texto). */
export function autoResults(state: EditorState, from = 0, to = state.doc.content.size): AutoResult[] {
  const s = mathKey.getState(state);
  if (!s) return [];
  return s.decos
    .find(from, to, (spec) => typeof spec.key === "string" && spec.key.startsWith("calc:"))
    .map((d) => ({ pos: d.from, result: (d.spec.key as string).slice(5) }));
}

/** Convierte en texto normal los resultados automáticos del rango (todo el documento por defecto). */
export function fixResults(editor: Editor, from?: number, to?: number): number {
  const found = autoResults(editor.state, from, to).sort((a, b) => b.pos - a.pos);
  if (!found.length) return 0;
  const tr = editor.state.tr;
  for (const r of found) tr.insertText(r.result, r.pos);
  editor.view.dispatch(tr);
  return found.length;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    noteMath: {
      /** Activa/desactiva los cálculos o cambia los decimales. */
      setMathOptions: (opts: Partial<MathOptions>) => ReturnType;
      /** Fija como texto el resultado junto al cursor (o todos los de la selección). */
      fixCalculation: () => ReturnType;
    };
  }
}

export const MathCalc = Extension.create<MathOptions>({
  name: "noteMath",

  addOptions() {
    return { enabled: true, decimals: null };
  },

  addCommands() {
    return {
      setMathOptions:
        (opts) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(mathKey, opts);
          return true;
        },
      fixCalculation:
        () =>
        ({ state, tr, dispatch }) => {
          const { from, to, empty } = state.selection;
          const found = autoResults(state, empty ? Math.max(0, from - 1) : from, empty ? Math.min(state.doc.content.size, from + 1) : to).sort((a, b) => b.pos - a.pos);
          if (!found.length) return false;
          if (dispatch) for (const r of found) tr.insertText(r.result, r.pos);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-Shift-Enter": () => this.editor.commands.fixCalculation() };
  },

  addProseMirrorPlugins() {
    const initial: MathOptions = { enabled: this.options.enabled, decimals: this.options.decimals };
    return [
      new Plugin<MathState>({
        key: mathKey,
        state: {
          init: (_config, state) => ({ ...initial, decos: fullSet(state.doc, initial) }),
          apply: (tr, prev, _old, state) => applyTr(tr, prev, state),
        },
        props: {
          decorations: (state) => mathKey.getState(state)?.decos,
        },
      }),
    ];
  },
});
