// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { docToText, isSafeDoc, sanitizeDoc, withCalculatedResults, type DocNode } from "@/services/notes/content";
import { noteExtensions } from "./extensions";
import { autoResults, fixResults } from "./mathCalc";

const editors: Editor[] = [];
function make(content: unknown = "", math = { enabled: true, decimals: null as number | null }) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const e = new Editor({ element, extensions: noteExtensions(math), content: content as any });
  editors.push(e);
  return e;
}
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
  document.body.innerHTML = "";
});

const results = (e: Editor) => autoResults(e.state).map((r) => r.result);
const type = (e: Editor, text: string) => e.commands.insertContent(text);

describe("formato enriquecido", () => {
  it("negrita, cursiva, subrayado, tachado, tipografía, tamaño, color, títulos, listas, alineación y enlaces", () => {
    const e = make();
    e.commands.setContent('<p>hola mundo</p><h2>Subtítulo</h2><p>cuerpo</p><ul><li><p>uno</p></li></ul><ol><li><p>dos</p></li></ol><p><a href="https://ejemplo.com">enlace</a></p>');
    e.commands.setTextSelection({ from: 1, to: 11 });
    e.chain().toggleBold().toggleItalic().toggleUnderline().toggleStrike().setFontFamily("Georgia, 'Times New Roman', serif").setFontSize("20px").setColor("#dc2626").run();
    for (const m of ["bold", "italic", "underline", "strike"]) expect(e.isActive(m)).toBe(true);
    expect(e.getAttributes("textStyle")).toMatchObject({ color: "#dc2626", fontSize: "20px", fontFamily: "Georgia, 'Times New Roman', serif" });
    e.chain().setNode("heading", { level: 1 }).setTextAlign("center").run();
    expect(e.isActive("heading", { level: 1 })).toBe(true);
    // Volver a «cuerpo de texto».
    e.commands.setTextSelection(15);
    expect(e.isActive("heading", { level: 2 })).toBe(true);

    const json = e.getJSON() as DocNode;
    expect(json.content!.map((n) => n.type)).toEqual(["heading", "heading", "paragraph", "bulletList", "orderedList", "paragraph"]);
    expect(json.content![0].attrs).toMatchObject({ level: 1, textAlign: "center" });
    expect(json.content![0].content![0].marks!.map((m) => m.type).sort()).toEqual(["bold", "italic", "strike", "textStyle", "underline"]);
    expect(json.content![5].content![0].marks![0]).toMatchObject({ type: "link", attrs: { href: "https://ejemplo.com" } });
    // Lo que produce el editor cumple las listas blancas y se guarda sin perder nada.
    expect(sanitizeDoc(json).content![0]).toEqual(json.content![0]);
    expect(isSafeDoc(sanitizeDoc(json))).toBe(true);
    expect(docToText(json)).toBe("hola mundo\nSubtítulo\ncuerpo\n• uno\n1. dos\nenlace");
  });

  it("guardar y volver a abrir conserva el formato exactamente", () => {
    const e = make();
    e.commands.setContent("<p><strong><em>a</em></strong> <s>b</s> <u>c</u></p>");
    e.commands.setTextSelection({ from: 1, to: 2 });
    e.chain().setColor("#2563eb").setFontFamily("'Courier New', ui-monospace, monospace").setFontSize("28px").run();
    const saved = sanitizeDoc(e.getJSON());
    const reopened = make(saved);
    expect(sanitizeDoc(reopened.getJSON())).toEqual(saved);
    expect(reopened.getHTML()).toContain("color: #2563eb");
  });

  it("el HTML pegado peligroso no entra en el documento", () => {
    const e = make();
    e.commands.setContent('<p onclick="x()">ok <a href="javascript:alert(1)">mal</a><script>alert(1)</script><span style="color: red; background: url(//evil)">rojo</span></p><iframe src="about:blank"></iframe>');
    const json = JSON.stringify(e.getJSON());
    expect(json).not.toMatch(/javascript|script|iframe|evil|onclick|about:blank/);
    expect(docToText(e.getJSON() as DocNode)).toBe("ok malrojo");
  });

  it("deshacer y rehacer", () => {
    const e = make("<p>uno</p>");
    e.commands.setTextSelection(4);
    type(e, " dos");
    expect(e.getText()).toBe("uno dos");
    e.commands.undo();
    expect(e.getText()).toBe("uno");
    e.commands.redo();
    expect(e.getText()).toBe("uno dos");
  });
});

describe("cálculos automáticos en el editor", () => {
  it("muestra el resultado tras el igual sin escribirlo en el documento", () => {
    const e = make("<p></p>");
    type(e, "Compra: 200+200=");
    expect(results(e)).toEqual(["400"]);
    expect(e.view.dom.querySelector(".note-calc-result")?.textContent).toBe("400");
    expect(e.getText()).toBe("Compra: 200+200="); // la expresión se conserva tal cual
    // El cursor no salta: sigue justo detrás del «=».
    expect(e.state.selection.from).toBe(e.state.doc.content.size - 1);
  });

  it("se actualiza al modificar la expresión y no toca otros párrafos", () => {
    const e = make("<p>150+350=</p><p>texto 2026-09-26 y 25*4=</p>");
    expect(results(e)).toEqual(["500", "100"]);
    e.commands.insertContentAt(1, "1"); // «1150+350=»
    expect(results(e)).toEqual(["1500", "100"]);
    expect(e.getText({ blockSeparator: "\n" })).toBe("1150+350=\ntexto 2026-09-26 y 25*4=");
  });

  it("ejemplos combinados, decimales, negativos y porcentaje", () => {
    const e = make("<p>(200+300)*2= 12.5+7.5= -5+3= 0.1+0.2= 200*10%= 1/3=</p>");
    expect(results(e)).toEqual(["1000", "20", "-2", "0.3", "20", "0.3333333333"]);
    e.commands.setMathOptions({ decimals: 2 });
    expect(results(e)).toEqual(["1000.00", "20.00", "-2.00", "0.30", "20.00", "0.33"]);
  });

  it("incompletas y división entre cero: indicación discreta, sin resultado", () => {
    const e = make("<p>5/0= y 2+= y (1+2=</p>");
    expect(results(e)).toEqual([]);
    const errors = [...e.view.dom.querySelectorAll(".note-calc-error")].map((x) => x.getAttribute("title"));
    expect(errors).toEqual(["División entre cero: corrige la expresión", "Expresión incompleta: corrige la expresión", "Falta cerrar un paréntesis: corrige la expresión"]);
  });

  it("no calcula fechas, teléfonos ni cifras de palabras", () => {
    const e = make("<p>Cita 26/09/2026 = jueves, tel 300-555-1234= y ref abc12+3=</p>");
    expect(results(e)).toEqual([]);
    expect(e.view.dom.querySelector(".note-calc-error")).toBeNull();
  });

  it("resultado manual: se distingue y se avisa si no coincide", () => {
    const e = make("<p>2+2=4 y 3+3=7</p>");
    expect(results(e)).toEqual([]);
    const mismatch = e.view.dom.querySelector(".note-calc-mismatch");
    expect(mismatch?.textContent).toBe("7");
    expect(mismatch?.getAttribute("title")).toBe("El resultado calculado es 6");
  });

  it("fijar el resultado lo convierte en texto normal editable", () => {
    const e = make("<p>200+200= y 10*3=</p>");
    expect(fixResults(e)).toBe(2);
    expect(e.getText()).toBe("200+200=400 y 10*3=30");
    expect(results(e)).toEqual([]); // ya son resultados escritos (manuales)
    // Con el cursor junto a un «=», el atajo fija solo ese.
    const f = make("<p>1+1= 2+2=</p>");
    f.commands.setTextSelection(5); // tras el primer «=»
    expect(f.commands.fixCalculation()).toBe(true);
    expect(f.getText()).toBe("1+1=2 2+2=");
  });

  it("se puede desactivar por nota", () => {
    const e = make("<p>2+2=</p>", { enabled: false, decimals: null });
    expect(results(e)).toEqual([]);
    e.commands.setMathOptions({ enabled: true });
    expect(results(e)).toEqual(["4"]);
  });

  it("los resultados se materializan para exportar, buscar y previsualizar", () => {
    const e = make("<p>Total <strong>150+350=</strong> ok</p>");
    const doc = withCalculatedResults(e.getJSON() as DocNode, { enabled: true, decimals: null });
    expect(docToText(doc)).toBe("Total 150+350=500 ok");
    expect(doc.content![0].content![1]).toEqual({ type: "text", text: "150+350=", marks: [{ type: "bold" }] });
    expect(doc.content![0].content![2]).toEqual({ type: "text", text: "500", marks: [{ type: "bold" }] });
  });

  it("rendimiento: una nota larga con muchos cálculos sigue siendo fluida al escribir", () => {
    const paras = Array.from({ length: 400 }, (_, i) => `<p>Línea ${i}: ${i}+${i}= texto de relleno bastante largo para simular una nota real</p>`).join("");
    const e = make(paras);
    expect(autoResults(e.state)).toHaveLength(400);
    const t0 = performance.now();
    for (let k = 0; k < 50; k++) e.commands.insertContentAt(3, "x");
    const perKey = (performance.now() - t0) / 50;
    expect(perKey).toBeLessThan(30);
    expect(autoResults(e.state)).toHaveLength(400);
  });
});
