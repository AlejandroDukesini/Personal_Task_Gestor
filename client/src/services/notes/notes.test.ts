import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { DB_VERSION, loadDb, migrate } from "@/services/localDb";
import { call, expectStatus } from "@/test/helpers";
import { buildOffer, validateOffer } from "@/services/manualsync/engine";
import { docToHtml, docToMarkdown, docToText, isSafeDoc, safeColor, safeHref, sanitizeDoc, textToDoc, type DocNode } from "./content";
import { __resetFilesForTests, collectGarbage, getFile, hasFile, inspectAttachment, putFile, releaseFiles, safeFileName } from "./files";
import { contrastRatio, readableOn } from "./icons";

const doc = (...paras: string[]): DocNode => textToDoc(paras.join("\n"));
const newNote = (over: Record<string, unknown> = {}) => call("POST", "/notes", { title: "Nota", content: doc("Hola"), ...over });
const list = (qs = "") => call("GET", `/notes${qs ? `?${qs}` : ""}`);

describe("modelo y migración", () => {
  it("la migración 5 añade notas y categorías sin tocar nada existente", () => {
    const old = { version: 4, tasks: [{ id: "t1", title: "x" }], finCategories: [{ id: "f" }], settings: {} };
    const db = migrate(structuredClone(old));
    expect(db.version).toBe(DB_VERSION);
    expect(db.tasks).toEqual(old.tasks);
    expect(db.finCategories).toEqual(old.finCategories);
    expect(db.notes).toEqual([]);
    expect(db.noteCategories.map((c) => c.id)).toContain("notecat-work");
  });

  it("una base nueva trae categorías de notas iniciales con ids fijos", () => {
    expect(loadDb().noteCategories.map((c) => c.name)).toEqual(["Personal", "Trabajo", "Estudios", "Ideas", "Finanzas", "Proyectos"]);
  });
});

describe("CRUD de notas", () => {
  it("crear con todos los campos, consultar y editar", async () => {
    const sub = await call("POST", "/notes/categories", { name: "Reuniones", parentId: "notecat-work" });
    const n = await newNote({
      title: "Acta",
      description: "Resumen semanal",
      content: doc("Punto 1", "Punto 2"),
      categoryId: "notecat-work",
      subcategoryId: sub.id,
      color: "#0ea5e9",
      icon: "Briefcase",
    });
    expect(n).toMatchObject({ title: "Acta", categoryId: "notecat-work", subcategoryId: sub.id, color: "#0ea5e9", icon: "Briefcase", archived: false, deletedAt: null, text: "Punto 1\nPunto 2" });
    expect(n.createdAt).toBe(n.updatedAt);

    const got = await call("GET", `/notes/${n.id}`);
    expect(got.content).toEqual(n.content);

    await new Promise((r) => setTimeout(r, 5));
    const upd = await call("PUT", `/notes/${n.id}`, { title: "Acta final", content: doc("Nuevo"), color: null, icon: "Star", mathDecimals: 2 });
    expect(upd.note).toMatchObject({ title: "Acta final", text: "Nuevo", color: null, icon: "Star", mathDecimals: 2 });
    expect(upd.note.updatedAt > n.updatedAt).toBe(true);
    expect(upd.note.createdAt).toBe(n.createdAt);
  });

  it("título obligatorio; contenido vacío permitido", async () => {
    await expectStatus(400, call("POST", "/notes", { title: "  " }));
    const n = await call("POST", "/notes", { title: "Solo título" });
    expect(n.text).toBe("");
    expect(n.content).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("categoría y subcategoría coherentes", async () => {
    const sub = await call("POST", "/notes/categories", { name: "Tesis", parentId: "notecat-study" });
    // Solo subcategoría: la categoría se deduce.
    const n = await newNote({ subcategoryId: sub.id });
    expect(n.categoryId).toBe("notecat-study");
    await expectStatus(400, newNote({ categoryId: "notecat-work", subcategoryId: sub.id }));
    await expectStatus(400, newNote({ categoryId: sub.id }));
    // Cambiar de categoría descarta la subcategoría que ya no encaja.
    const moved = await call("PUT", `/notes/${n.id}`, { categoryId: "notecat-ideas" });
    expect(moved.note).toMatchObject({ categoryId: "notecat-ideas", subcategoryId: null });
  });

  it("duplicar: id y fechas propias, mismo contenido y adjuntos compartidos", async () => {
    const att = { id: "a1", fileKey: "a".repeat(64), name: "f.pdf", label: null, kind: "pdf", mime: "application/pdf", size: 10, addedAt: new Date().toISOString() };
    const n = await newNote({ color: "#ef4444", icon: "Lightbulb", categoryId: "notecat-ideas", attachments: [att] });
    const d = await call("POST", `/notes/${n.id}/duplicate`);
    expect(d.id).not.toBe(n.id);
    expect(d).toMatchObject({ title: "Nota (copia)", color: "#ef4444", icon: "Lightbulb", categoryId: "notecat-ideas", content: n.content });
    expect(d.attachments[0].fileKey).toBe(att.fileKey);
    expect(d.attachments[0].id).not.toBe("a1");
  });

  it("archivar y desarchivar", async () => {
    const n = await newNote();
    await call("POST", `/notes/${n.id}/archive`);
    expect((await list()).items).toHaveLength(0);
    expect((await list("status=archived")).items).toHaveLength(1);
    await call("POST", `/notes/${n.id}/unarchive`);
    expect((await list()).items).toHaveLength(1);
  });

  it("papelera: borrar, restaurar y eliminar definitivamente", async () => {
    const n = await newNote();
    await call("DELETE", `/notes/${n.id}`);
    expect((await list()).counts).toEqual({ active: 0, archived: 0, trash: 1 });
    await expectStatus(409, call("PUT", `/notes/${n.id}`, { title: "x" }));
    await call("POST", `/notes/${n.id}/restore`);
    expect((await list()).items).toHaveLength(1);
    await expectStatus(409, call("DELETE", `/notes/${n.id}/purge`));
    await call("DELETE", `/notes/${n.id}`);
    await call("DELETE", `/notes/${n.id}/purge`);
    expect(loadDb().notes).toHaveLength(0);
    expect(loadDb().tombstones.some((t) => t.collection === "notes" && t.id === n.id)).toBe(true);
  });

  it("vaciar la papelera informa de los archivos que quedan sin usar (no los compartidos)", async () => {
    const shared = "b".repeat(64);
    const only = "c".repeat(64);
    const att = (id: string, fileKey: string) => ({ id, fileKey, name: "x.png", label: null, kind: "png", mime: "image/png", size: 1, addedAt: new Date().toISOString() });
    const a = await newNote({ attachments: [att("1", shared), att("2", only)] });
    await newNote({ attachments: [att("3", shared)] });
    await call("DELETE", `/notes/${a.id}`);
    const res = await call("POST", "/notes/trash/empty");
    expect(res).toEqual({ purged: 1, orphanFileKeys: [only] });
  });

  it("el contenido se sanea siempre al guardar", async () => {
    const evil = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "clic", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
        { type: "script", content: [{ type: "text", text: "alert(1)" }] },
        { type: "paragraph", content: [{ type: "text", text: "rojo", marks: [{ type: "textStyle", attrs: { color: "red; background:url(//evil)" } }] }] },
      ],
    };
    const n = await newNote({ content: evil });
    expect(JSON.stringify(n.content)).not.toMatch(/javascript|evil|script/);
    expect(n.text).toBe("clic\nalert(1)\nrojo"); // el texto se conserva, lo peligroso no
  });
});

describe("búsqueda, filtros, orden y paginación", () => {
  beforeEach(async () => {
    await call("POST", "/notes", { title: "Presupuesto viaje", content: doc("Hotel en Cartagena"), categoryId: "notecat-finance" });
    await call("POST", "/notes", { title: "Ideas app", description: "Móvil", content: doc("Modo oscuro"), categoryId: "notecat-ideas" });
    await call("POST", "/notes", {
      title: "Contrato",
      content: doc("Firmar"),
      attachments: [{ id: "x", fileKey: "d".repeat(64), name: "arriendo.pdf", label: "Contrato firmado", kind: "pdf", mime: "application/pdf", size: 5, addedAt: new Date().toISOString() }],
    });
  });

  it("busca en título, descripción, contenido, categoría y adjuntos, sin tildes", async () => {
    expect((await list("q=cartagena")).items.map((n: any) => n.title)).toEqual(["Presupuesto viaje"]);
    expect((await list("q=movil")).items.map((n: any) => n.title)).toEqual(["Ideas app"]);
    expect((await list("q=finanzas")).items.map((n: any) => n.title)).toEqual(["Presupuesto viaje"]);
    expect((await list("q=arriendo")).items.map((n: any) => n.title)).toEqual(["Contrato"]);
    expect((await list("q=contrato firmado")).items).toHaveLength(1);
    expect((await list("q=nada existe")).items).toHaveLength(0);
  });

  it("filtros por categoría, sin categoría, adjuntos y fechas", async () => {
    expect((await list("categoryId=notecat-ideas")).total).toBe(1);
    expect((await list("categoryId=none")).items.map((n: any) => n.title)).toEqual(["Contrato"]);
    expect((await list("hasAttachments=1")).total).toBe(1);
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect((await list(`from=${key}&to=${key}`)).total).toBe(3);
    expect((await list("to=2000-01-01")).total).toBe(0);
  });

  it("orden por título y categoría; las listas no incluyen el documento", async () => {
    const byTitle = await list("sort=title&dir=asc");
    expect(byTitle.items.map((n: any) => n.title)).toEqual(["Contrato", "Ideas app", "Presupuesto viaje"]);
    expect(byTitle.items[0].content).toBeUndefined();
    expect(byTitle.items[0].preview).toBe("Firmar");
    const byCat = await list("sort=category&dir=asc");
    expect(byCat.items.map((n: any) => n.title)).toEqual(["Presupuesto viaje", "Ideas app", "Contrato"]);
  });

  it("paginación progresiva con muchas notas", async () => {
    for (let i = 0; i < 70; i++) await call("POST", "/notes", { title: `N${i}` });
    const p1 = await list("limit=30");
    expect(p1.items).toHaveLength(30);
    expect(p1.nextOffset).toBe(30);
    const p3 = await list("limit=30&offset=60");
    expect(p3.items).toHaveLength(13);
    expect(p3.nextOffset).toBeNull();
  });

  it("rendimiento: 3.000 notas se filtran y ordenan rápido", async () => {
    const db = loadDb();
    const base = db.notes[0];
    for (let i = 0; i < 3000; i++) db.notes.push({ ...base, id: `bulk-${i}`, title: `Nota ${i}`, text: `contenido ${i} palabra${i % 50}` });
    const t0 = performance.now();
    const r = await list("q=palabra7&sort=title");
    expect(r.total).toBe(60);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe("categorías y subcategorías", () => {
  it("crear, editar, validar nombres y un solo nivel", async () => {
    const c = await call("POST", "/notes/categories", { name: "Salud", color: "#22c55e", icon: "Heart" });
    const s = await call("POST", "/notes/categories", { name: "Médico", parentId: c.id });
    expect(s).toMatchObject({ parentId: c.id, color: "#22c55e", icon: "Heart" });
    await expectStatus(400, call("POST", "/notes/categories", { name: "Nivel 3", parentId: s.id }));
    await expectStatus(409, call("POST", "/notes/categories", { name: "salud" }));
    await expectStatus(400, call("POST", "/notes/categories", { name: "X", icon: "NoExiste" }));
    const r = await call("PUT", `/notes/categories/${c.id}`, { name: "Bienestar", color: "#14b8a6" });
    expect(r).toMatchObject({ name: "Bienestar", color: "#14b8a6" });
    const cats = await call("GET", "/notes/categories");
    expect(cats.find((x: any) => x.id === s.id).parentId).toBe(c.id);
  });

  it("borrar una categoría con notas: reasignar, dejar sin categoría o papelera (nada se pierde)", async () => {
    const c = await call("POST", "/notes/categories", { name: "Temporal" });
    const s = await call("POST", "/notes/categories", { name: "Sub", parentId: c.id });
    const a = await newNote({ categoryId: c.id });
    const b = await newNote({ subcategoryId: s.id });
    await expectStatus(400, call("POST", `/notes/categories/${c.id}/delete`, { strategy: "reassign" }));
    await expectStatus(400, call("POST", `/notes/categories/${c.id}/delete`, { strategy: "reassign", targetId: s.id }));
    const res = await call("POST", `/notes/categories/${c.id}/delete`, { strategy: "reassign", targetId: "notecat-ideas" });
    expect(res).toEqual({ deleted: 2, affectedNotes: 2 });
    const notes = loadDb().notes;
    expect(notes.find((n) => n.id === a.id)).toMatchObject({ categoryId: "notecat-ideas", subcategoryId: null, deletedAt: null });
    expect(notes.find((n) => n.id === b.id)).toMatchObject({ categoryId: "notecat-ideas", subcategoryId: null });
    expect(loadDb().noteCategories.some((x) => x.id === c.id || x.id === s.id)).toBe(false);
  });

  it("borrar solo una subcategoría deja las notas en la principal; «papelera» es recuperable", async () => {
    const s = await call("POST", "/notes/categories", { name: "Recetas", parentId: "notecat-personal" });
    const n = await newNote({ subcategoryId: s.id });
    await call("POST", `/notes/categories/${s.id}/delete`, { strategy: "uncategorize" });
    expect(loadDb().notes.find((x) => x.id === n.id)).toMatchObject({ categoryId: "notecat-personal", subcategoryId: null });

    const c = await call("POST", "/notes/categories", { name: "Basura" });
    const m = await newNote({ categoryId: c.id });
    await call("POST", `/notes/categories/${c.id}/delete`, { strategy: "trash" });
    expect(loadDb().notes.find((x) => x.id === m.id)!.deletedAt).not.toBeNull();
    const restored = await call("POST", `/notes/${m.id}/restore`);
    expect(restored).toMatchObject({ deletedAt: null, categoryId: null });
  });
});

describe("sincronización y copias", () => {
  it("las notas viajan en la sincronización y se validan al llegar", async () => {
    const n = await newNote({ title: "Sincronizada" });
    const offer = buildOffer(loadDb(), { deviceId: "pc", name: "PC" } as any, null, null);
    expect(offer.entries.some((e) => e.key === `notes:${n.id}`)).toBe(true);
    expect(validateOffer(offer).errors).toEqual([]);
    const tampered = structuredClone(offer);
    const entry = tampered.entries.find((e) => e.key === `notes:${n.id}`)!;
    (entry.row as any).content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] };
    expect(validateOffer(tampered).errors.join()).toMatch(/nota no válida/);
  });

  it("copia de seguridad: exporta e importa notas y categorías, rechaza contenido inseguro", async () => {
    const n = await newNote({ title: "En la copia" });
    const backup = await call("GET", "/backup/export");
    expect(backup.data.notes.map((x: any) => x.id)).toContain(n.id);
    expect(backup.data.noteCategories.length).toBeGreaterThan(0);
    await call("POST", "/backup/import", { data: backup.data, replace: true });
    expect(loadDb().notes.find((x) => x.id === n.id)?.title).toBe("En la copia");
    const bad = structuredClone(backup.data);
    bad.notes[0].content = { type: "doc", content: [{ type: "iframe" }] };
    await expectStatus(400, call("POST", "/backup/import", { data: bad }));
  });
});

describe("contenido enriquecido (formato estructurado)", () => {
  const rich: DocNode = {
    type: "doc",
    content: [
      { type: "heading", attrs: { textAlign: null, level: 1 }, content: [{ type: "text", text: "Título" }] },
      { type: "heading", attrs: { textAlign: "center", level: 2 }, content: [{ type: "text", text: "Subtítulo" }] },
      {
        type: "paragraph",
        attrs: { textAlign: null },
        content: [
          { type: "text", text: "negrita", marks: [{ type: "bold" }, { type: "italic" }] },
          { type: "text", text: " color", marks: [{ type: "textStyle", attrs: { color: "#dc2626", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "20px" } }] },
          { type: "text", text: " enlace", marks: [{ type: "link", attrs: { href: "https://ejemplo.com/a?b=1", target: "_blank", rel: "noopener noreferrer nofollow", class: null } }] },
          { type: "text", text: " tachado", marks: [{ type: "strike" }, { type: "underline" }] },
        ],
      },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "uno" }] }] }] },
      { type: "orderedList", attrs: { start: 3, type: null }, content: [{ type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "tres" }] }] }] },
    ],
  };

  it("un documento correcto se conserva idéntico (sin pérdida de formato)", () => {
    expect(sanitizeDoc(rich)).toEqual(rich);
    expect(isSafeDoc(rich)).toBe(true);
  });

  it("valores de estilo fuera de las listas blancas se descartan", () => {
    expect(safeColor("#ABC")).toBe("#aabbcc");
    expect(safeColor("rgb(255, 0, 10)")).toBe("#ff000a");
    expect(safeColor("red; background:url(x)")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>")).toBeNull();
    expect(safeHref("mailto:a@b.co")).toBe("mailto:a@b.co");
    const bad = sanitizeDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "textStyle", attrs: { fontFamily: "Comic; x:y", fontSize: "999px", color: "#123456" } }] }] }] });
    expect(bad.content![0].content![0].marks).toEqual([{ type: "textStyle", attrs: { color: "#123456", fontFamily: null, fontSize: null } }]);
  });

  it("límites de tamaño y estructura reparada", () => {
    const huge = sanitizeDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a".repeat(300_000) }] }] });
    expect(docToText(huge).length).toBe(200_000);
    const loose = sanitizeDoc({ type: "doc", content: [{ type: "bulletList", content: [{ type: "paragraph", content: [{ type: "text", text: "suelto" }] }] }] });
    expect(loose.content![0].content![0].type).toBe("listItem");
  });

  it("exporta a texto, Markdown y HTML escapado", () => {
    expect(docToText(rich)).toBe("Título\nSubtítulo\nnegrita color enlace tachado\n• uno\n3. tres");
    const md = docToMarkdown(rich);
    expect(md).toContain("# Título");
    expect(md).toContain("## Subtítulo");
    expect(md).toContain("_**negrita**_");
    expect(md).toContain("[ enlace](https://ejemplo.com/a?b=1)");
    expect(md).toContain("- uno\n3. tres");
    const html = docToHtml(rich);
    expect(html).toContain('<h2 style="text-align:center">Subtítulo</h2>');
    expect(html).toContain('<span style="color:#dc2626;font-family:Georgia, &#39;Times New Roman&#39;, serif;font-size:20px"> color</span>');
    expect(html).toContain('<ol start="3">');
    expect(docToHtml(textToDoc("<img src=x onerror=alert(1)>"))).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
  });
});

describe("colores con contraste suficiente", () => {
  it("elige el texto más legible sobre cualquier color de la paleta", () => {
    // Texto normal (4.5:1) en claros/oscuros; en los tonos medios, al menos el
    // 3:1 de WCAG para texto en negrita/grande, que es como se usan las etiquetas.
    for (const bg of ["#ffffff", "#eab308", "#111827", "#22c55e"]) expect(contrastRatio(bg, readableOn(bg))).toBeGreaterThanOrEqual(4.5);
    for (const bg of ["#6366f1", "#a855f7", "#ec4899", "#64748b"]) expect(contrastRatio(bg, readableOn(bg))).toBeGreaterThanOrEqual(3);
  });
});

describe("archivos adjuntos", () => {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 10]);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
  const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0]);
  const txt = new TextEncoder().encode("hola\nmundo");

  it("acepta los tipos admitidos según su contenido", () => {
    expect(inspectAttachment("informe.pdf", 100, PDF)).toMatchObject({ ok: true, type: { kind: "pdf", preview: "pdf" } });
    expect(inspectAttachment("foto.PNG", 100, PNG).type?.kind).toBe("png");
    expect(inspectAttachment("carta.docx", 100, ZIP).type?.kind).toBe("docx");
    expect(inspectAttachment("datos.xlsx", 100, ZIP).type?.kind).toBe("xlsx");
    expect(inspectAttachment("notas.txt", 100, txt).type?.preview).toBe("text");
  });

  it("rechaza lo peligroso, lo disfrazado, lo vacío y lo demasiado grande", () => {
    expect(inspectAttachment("virus.exe", 10, EXE).error).toMatch(/seguridad/);
    expect(inspectAttachment("factura.pdf.exe", 10, EXE).error).toMatch(/seguridad/);
    expect(inspectAttachment("pagina.html", 10, txt).error).toMatch(/seguridad/);
    expect(inspectAttachment("dibujo.svg", 10, txt).error).toMatch(/seguridad/);
    expect(inspectAttachment("foto.png", 10, EXE).error).toMatch(/ejecutable/);
    expect(inspectAttachment("foto.png", 10, PDF).error).toMatch(/no corresponde/);
    expect(inspectAttachment("sin_extension", 10, txt).error).toMatch(/extensión/);
    expect(inspectAttachment("raro.xyz", 10, txt).error).toMatch(/no está entre/);
    expect(inspectAttachment("vacio.txt", 0, txt).error).toMatch(/vacío/);
    expect(inspectAttachment("grande.pdf", 16 * 1024 * 1024, PDF).error).toMatch(/15 MB/);
  });

  it("nombres de archivo seguros", () => {
    expect(safeFileName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(safeFileName("C:\\Users\\x\\informe final.pdf")).toBe("informe final.pdf");
    expect(safeFileName("  ..oculto?.pdf  ")).toBe("oculto.pdf");
    expect(safeFileName("fac\u202etxt.pdf")).toBe("factxt.pdf");
    expect(safeFileName("CON.txt")).toBe("_CON.txt");
    expect(safeFileName("a".repeat(300) + ".pdf").length).toBe(120);
  });

  describe("almacén", () => {
    beforeEach(() => __resetFilesForTests());

    it("guarda, deduplica por contenido y recupera", async () => {
      const k1 = await putFile(PDF);
      const k2 = await putFile(PDF.slice());
      expect(k1).toMatch(/^[0-9a-f]{64}$/);
      expect(k2).toBe(k1);
      expect(await getFile(k1)).toEqual(PDF);
      expect(await getFile("no-es-una-clave")).toBeNull();
    });

    it("no borra archivos que otra nota sigue usando; la limpieza quita huérfanos", async () => {
      const used = await putFile(PNG);
      const orphan = await putFile(txt);
      expect(await releaseFiles([used, orphan], new Set([used]))).toBe(1);
      expect(await hasFile(used)).toBe(true);
      expect(await hasFile(orphan)).toBe(false);
      const stray = await putFile(ZIP);
      expect(await collectGarbage(new Set([used]))).toBeGreaterThanOrEqual(1);
      expect(await hasFile(stray)).toBe(false);
      expect(await hasFile(used)).toBe(true);
    });
  });
});

describe("borradores de recuperación", () => {
  it("se ofrece recuperar solo lo que no llegó a guardarse", async () => {
    const { writeDraft, readDraft, draftIsNewer, clearDraft } = await import("./drafts");
    const n = await newNote();
    writeDraft(n.id, n.updatedAt, { title: "Cambio pendiente" });
    expect(draftIsNewer(readDraft(n.id), n.updatedAt)).toBe(true);
    // Si la nota se guardó después (otro guardado u otro dispositivo), el borrador ya no aplica.
    const upd = await call("PUT", `/notes/${n.id}`, { title: "Guardado" });
    expect(draftIsNewer(readDraft(n.id), upd.note.updatedAt)).toBe(false);
    clearDraft(n.id);
    expect(readDraft(n.id)).toBeNull();
    localStorage.setItem(`gestion-tareas:note-draft:${n.id}`, "{roto");
    expect(readDraft(n.id)).toBeNull();
  });
});
