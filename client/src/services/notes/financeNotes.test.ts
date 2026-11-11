import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { DB_VERSION, loadDb, migrate, mutate } from "@/services/localDb";
import { call, expectStatus, makeAccount, makeTx } from "@/test/helpers";
import { buildOffer, validateOffer } from "@/services/manualsync/engine";
import { textToDoc } from "./content";

const fin = (over: Record<string, unknown> = {}) => call("POST", "/notes", { space: "finance", title: "Nota financiera", content: textToDoc("Hola"), ...over });
const list = (qs = "") => call("GET", `/notes?${qs}`);

describe("notas financieras: modelo y migración", () => {
  it("la migración 9 añade las categorías financieras sin reescribir notas existentes", () => {
    const oldNote = { id: "n1", title: "Antigua", description: null, content: { type: "doc", content: [] }, text: "", categoryId: null, subcategoryId: null, color: null, icon: "FileText", attachments: [], archived: false, deletedAt: null, mathEnabled: true, mathDecimals: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const old = { version: 8, notes: [oldNote], noteCategories: [{ id: "notecat-work", name: "Trabajo" }], settings: {} };
    const db = migrate(structuredClone(old));
    expect(db.version).toBe(DB_VERSION);
    expect(db.notes).toEqual([oldNote]); // intacta: sin `space`, `pinned`…
    const finCats = db.noteCategories.filter((c) => c.space === "finance").map((c) => c.name);
    expect(finCats).toEqual(["Ideas financieras", "Planes de ahorro", "Deudas", "Pagos pendientes", "Inversiones", "Presupuestos", "Compras futuras", "Objetivos económicos", "Observaciones"]);
  });

  it("no resucita una categoría financiera que el usuario borró en otro dispositivo", () => {
    const old = { version: 8, noteCategories: [], tombstones: [{ collection: "noteCategories", id: "notecat-fin-debts", deletedAt: "2026-01-01T00:00:00.000Z" }], settings: {} };
    const db = migrate(structuredClone(old));
    expect(db.noteCategories.map((c) => c.id)).not.toContain("notecat-fin-debts");
  });

  it("una base nueva trae ambos blocs con sus categorías", async () => {
    expect((await call("GET", "/notes/categories?space=finance")).map((c: any) => c.id)).toContain("notecat-fin-savings");
    expect((await call("GET", "/notes/categories")).map((c: any) => c.id)).not.toContain("notecat-fin-savings");
  });
});

describe("notas financieras: CRUD, búsqueda y organización", () => {
  it("cada bloc lista solo sus notas y cuenta lo suyo", async () => {
    await call("POST", "/notes", { title: "General", content: textToDoc("x") });
    const n = await fin({ title: "Plan de ahorro para computador", categoryId: "notecat-fin-savings" });
    expect(n.space).toBe("finance");
    const f = await list("space=finance");
    expect(f.items.map((x: any) => x.title)).toEqual(["Plan de ahorro para computador"]);
    expect(f.counts.active).toBe(1);
    const g = await list();
    expect(g.items.map((x: any) => x.title)).toEqual(["General"]);
  });

  it("no mezcla categorías entre blocs", async () => {
    await expectStatus(400, fin({ categoryId: "notecat-work" }));
    await expectStatus(400, call("POST", "/notes", { title: "x", categoryId: "notecat-fin-debts" }));
    const n = await fin();
    await expectStatus(400, call("PUT", `/notes/${n.id}`, { categoryId: "notecat-work" }));
    // Categoría nueva en el bloc financiero y su subcategoría.
    const cat = await call("POST", "/notes/categories", { name: "Viajes", space: "finance" });
    expect(cat.space).toBe("finance");
    const sub = await call("POST", "/notes/categories", { name: "Japón", parentId: cat.id });
    expect(sub.space).toBe("finance");
    // Mismo nombre permitido en el otro bloc, no repetido en el mismo.
    await call("POST", "/notes/categories", { name: "Viajes" });
    await expectStatus(409, call("POST", "/notes/categories", { name: "viajes", space: "finance" }));
  });

  it("fijar, etiquetas y fecha: editar, buscar y filtrar", async () => {
    const a = await fin({ title: "Deuda tarjeta", tags: ["Tarjeta", "urgente", "tarjeta", "  "], date: "2026-12-05", categoryId: "notecat-fin-debts" });
    expect(a.tags).toEqual(["Tarjeta", "urgente"]); // sin repetidas ni vacías
    const b = await fin({ title: "Inversión CDT" });
    await call("PUT", `/notes/${b.id}`, { pinned: true });
    expect((await list("space=finance")).items.map((x: any) => x.title)).toEqual(["Inversión CDT", "Deuda tarjeta"]);
    expect((await list("space=finance&tag=TARJETA")).items.map((x: any) => x.title)).toEqual(["Deuda tarjeta"]);
    expect((await list("space=finance&q=urgente")).items.map((x: any) => x.title)).toEqual(["Deuda tarjeta"]);
    expect((await list("space=finance&dateField=date&from=2026-12-01&to=2026-12-31")).items.map((x: any) => x.title)).toEqual(["Deuda tarjeta"]);
    expect((await list("space=finance")).tags).toEqual(["Tarjeta", "urgente"]);
    await expectStatus(400, call("PUT", `/notes/${a.id}`, { date: "2026-13-45" }));
  });

  it("archivar, papelera, restaurar y eliminar definitivamente", async () => {
    const n = await fin({ title: "Compra futura: bici" });
    await call("POST", `/notes/${n.id}/archive`);
    expect((await list("space=finance&status=archived")).items).toHaveLength(1);
    await call("POST", `/notes/${n.id}/unarchive`);
    await call("DELETE", `/notes/${n.id}`);
    expect((await list("space=finance&status=trash")).items).toHaveLength(1);
    await call("POST", `/notes/${n.id}/restore`);
    await call("DELETE", `/notes/${n.id}`);
    await call("DELETE", `/notes/${n.id}/purge`);
    expect(loadDb().notes.find((x) => x.id === n.id)).toBeUndefined();
  });

  it("una nota duplicada sigue en el bloc financiero y sin fijar", async () => {
    const n = await fin({ title: "Presupuesto", pinned: true });
    const copy = await call("POST", `/notes/${n.id}/duplicate`);
    expect(copy).toMatchObject({ space: "finance", pinned: false });
  });

  it("las notas nunca crean ni modifican movimientos, cuentas ni presupuestos", async () => {
    const acc = await makeAccount({ initialBalance: 500_000 });
    await makeTx({ accountId: acc.id, amount: 20_000 });
    const snapshot = () => JSON.stringify({ a: loadDb().finAccounts, t: loadDb().finTransactions, b: loadDb().finBudgets, g: loadDb().finGoals, r: loadDb().finRecurring });
    const before = snapshot();
    const n = await fin({ title: "Pago pendiente $200.000", content: textToDoc("Pagar 200000 el viernes"), date: "2026-12-01" });
    await call("PUT", `/notes/${n.id}`, { content: textToDoc("Pagar 250000"), tags: ["pago"] });
    await call("DELETE", `/notes/${n.id}`);
    await call("DELETE", `/notes/${n.id}/purge`);
    expect(snapshot()).toBe(before);
  });

  it("las notas antiguas (sin campos v9) se leen con valores por defecto", async () => {
    const n = await call("POST", "/notes", { title: "Vieja", content: textToDoc("x") });
    mutate((db) => {
      const row = db.notes.find((x) => x.id === n.id)!;
      delete row.space;
      delete row.pinned;
      delete row.tags;
      delete row.date;
    });
    const item = (await list()).items[0];
    expect(item).toMatchObject({ title: "Vieja", space: "general", pinned: false, tags: [], date: null });
  });

  it("la sincronización acepta notas financieras válidas", async () => {
    const n = await fin({ title: "Sync", tags: ["a"], date: "2026-11-30" });
    const offer = buildOffer(loadDb(), { deviceId: "pc", name: "PC" } as any, null, null);
    expect(offer.entries.some((e: any) => e.key === `notes:${n.id}`)).toBe(true);
    expect(validateOffer(offer).errors).toEqual([]);
    const tampered = structuredClone(offer);
    (tampered.entries.find((e: any) => e.key === `notes:${n.id}`)!.row as any).space = "otro";
    expect(validateOffer(tampered).errors.length).toBeGreaterThan(0);
  });
});
