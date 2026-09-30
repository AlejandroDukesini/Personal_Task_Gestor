/**
 * Configuración del editor de notas (TipTap / ProseMirror).
 *
 * El esquema solo admite los nodos y marcas que acepta `sanitizeDoc`; lo que
 * se pegue fuera de él (scripts, iframes, estilos arbitrarios) el propio
 * editor lo descarta al analizar el HTML pegado, y lo que quede se sanea al
 * guardar. Los enlaces solo aceptan http(s), mailto y tel.
 */

import type { AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import { Placeholder } from "@tiptap/extensions";
import { safeHref } from "@/services/notes/content";
import { MathCalc, type MathOptions } from "./mathCalc";

export function noteExtensions(math: MathOptions, placeholder = "Escribe aquí… Prueba un cálculo: 200+200="): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      code: false,
      codeBlock: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        protocols: ["mailto", "tel"],
        isAllowedUri: (url) => !!safeHref(url),
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
    }),
    TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
    Placeholder.configure({ placeholder }),
    MathCalc.configure(math),
  ];
}
