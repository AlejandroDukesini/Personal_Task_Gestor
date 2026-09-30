/**
 * Ficheros de prueba construidos en el momento (no se versionan datos reales):
 *   - una copia de Cashew con su esquema SQLite real (v4x),
 *   - un `.xlsx` mínimo pero auténtico (ZIP + XML, comprimido con deflate).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

export function sqliteAvailable(): any | null {
  try {
    return createRequire(import.meta.url)("node:sqlite").DatabaseSync;
  } catch {
    return null;
  }
}

/** Crea una base SQLite en disco con `setup` y devuelve sus bytes. */
export function buildSqlite(setup: (db: any) => void): Uint8Array {
  const DatabaseSync = sqliteAvailable();
  if (!DatabaseSync) throw new Error("node:sqlite no disponible");
  const dir = mkdtempSync(path.join(tmpdir(), "gt-import-"));
  const file = path.join(dir, "db.sqlite");
  const db = new DatabaseSync(file);
  try {
    // Como en Cashew real: hay referencias huérfanas (transferencias cuya pareja se borró).
    db.exec("PRAGMA foreign_keys = OFF; BEGIN");
    setup(db);
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  const bytes = new Uint8Array(readFileSync(file));
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}

// Esquema tal cual lo crea Cashew (tablas relevantes).
const CASHEW_SCHEMA = `
CREATE TABLE "wallets" ("date_created" INTEGER NOT NULL, "date_time_modified" INTEGER NULL, "order" INTEGER NOT NULL, "archived" INTEGER NOT NULL DEFAULT 0 CHECK ("archived" IN (0, 1)), "name" TEXT NOT NULL, "colour" TEXT NULL, "icon_name" TEXT NULL, "emoji_icon_name" TEXT NULL, "wallet_pk" TEXT NOT NULL, "currency" TEXT NULL, "currency_format" TEXT NULL, "decimals" INTEGER NOT NULL DEFAULT 2, "home_page_widget_display" TEXT NULL DEFAULT NULL, PRIMARY KEY ("wallet_pk"));
CREATE TABLE "categories" ("date_created" INTEGER NOT NULL, "date_time_modified" INTEGER NULL, "order" INTEGER NOT NULL, "archived" INTEGER NOT NULL DEFAULT 0 CHECK ("archived" IN (0, 1)), "name" TEXT NOT NULL, "colour" TEXT NULL, "icon_name" TEXT NULL, "emoji_icon_name" TEXT NULL, "category_pk" TEXT NOT NULL, "income" INTEGER NOT NULL DEFAULT 0 CHECK ("income" IN (0, 1)), "method_added" INTEGER NULL, "main_category_pk" TEXT NULL DEFAULT NULL REFERENCES categories (category_pk), PRIMARY KEY ("category_pk"));
CREATE TABLE "objectives" ("date_created" INTEGER NOT NULL, "date_time_modified" INTEGER NULL, "order" INTEGER NOT NULL, "archived" INTEGER NOT NULL DEFAULT 0 CHECK ("archived" IN (0, 1)), "name" TEXT NOT NULL, "colour" TEXT NULL, "pinned" INTEGER NOT NULL DEFAULT 0 CHECK ("pinned" IN (0, 1)), "icon_name" TEXT NULL, "emoji_icon_name" TEXT NULL, "objective_pk" TEXT NOT NULL, "type" INTEGER NOT NULL DEFAULT 0, "amount" REAL NOT NULL, "end_date" INTEGER NULL, "income" INTEGER NOT NULL DEFAULT 0 CHECK ("income" IN (0, 1)), "wallet_fk" TEXT NOT NULL DEFAULT '0' REFERENCES wallets (wallet_pk), PRIMARY KEY ("objective_pk"));
CREATE TABLE "transactions" ("date_created" INTEGER NOT NULL, "date_time_modified" INTEGER NULL, "name" TEXT NOT NULL, "transaction_pk" TEXT NOT NULL, "paired_transaction_fk" TEXT NULL DEFAULT NULL REFERENCES transactions (transaction_pk), "amount" REAL NOT NULL, "note" TEXT NOT NULL, "category_fk" TEXT NOT NULL REFERENCES categories (category_pk), "sub_category_fk" TEXT NULL DEFAULT NULL REFERENCES categories (category_pk), "wallet_fk" TEXT NOT NULL DEFAULT '0' REFERENCES wallets (wallet_pk), "original_date_due" INTEGER NULL DEFAULT 1790721617, "income" INTEGER NOT NULL DEFAULT 0 CHECK ("income" IN (0, 1)), "period_length" INTEGER NULL, "reoccurrence" INTEGER NULL, "end_date" INTEGER NULL, "upcoming_transaction_notification" INTEGER NULL DEFAULT 1 CHECK ("upcoming_transaction_notification" IN (0, 1)), "type" INTEGER NULL, "paid" INTEGER NOT NULL DEFAULT 0 CHECK ("paid" IN (0, 1)), "created_another_future_transaction" INTEGER NULL DEFAULT 0 CHECK ("created_another_future_transaction" IN (0, 1)), "skip_paid" INTEGER NOT NULL DEFAULT 0 CHECK ("skip_paid" IN (0, 1)), "method_added" INTEGER NULL, "transaction_owner_email" TEXT NULL, "transaction_original_owner_email" TEXT NULL, "shared_key" TEXT NULL, "shared_old_key" TEXT NULL, "shared_status" INTEGER NULL, "shared_date_updated" INTEGER NULL, "shared_reference_budget_pk" TEXT NULL, "objective_fk" TEXT NULL REFERENCES objectives (objective_pk), "objective_loan_fk" TEXT NULL REFERENCES objectives (objective_pk), "budget_fks_exclude" TEXT NULL, PRIMARY KEY ("transaction_pk"));
CREATE TABLE "app_settings" ("settings_pk" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "settings_j_s_o_n" TEXT NOT NULL, "date_updated" INTEGER NOT NULL);
`;

/** 2026-09-21 (segundos Unix, como `date_created` de Cashew). */
export const T0 = 1790000000;

export interface CashewTx {
  pk: string;
  at: number;
  name?: string;
  amount: number;
  note?: string;
  cat: string;
  sub?: string | null;
  wallet?: string;
  income?: 0 | 1;
  paid?: 0 | 1;
  paired?: string | null;
  objective?: string | null;
}

/** Caso de prueba representativo del archivo real (ver `cashew.ts`). */
export const CASHEW_TXS: CashewTx[] = [
  { pk: "t1", at: T0, name: "Saldo inicial", amount: 131400, note: "Saldo total actualizado\nBilletera: $131,400", cat: "0", income: 1 },
  { pk: "t2", at: T0 + 100, name: "", amount: 68000, cat: "c-in", sub: "c-sal", income: 1 },
  { pk: "t3", at: T0 + 200, name: "Almuerzo", amount: -5000, cat: "c-out", sub: "c-food", note: "x".repeat(6000) },
  // Transferencia: dos «Corrección de Balance» enlazadas solo desde una pata, a 1 s.
  { pk: "t4", at: T0 + 300, name: "Ahorros Transferir de", amount: -40000, cat: "0", paired: "t5" },
  { pk: "t5", at: T0 + 301, name: "Ahorros Transferir a", amount: 39999.99999999999, cat: "0", wallet: "w-nequi", income: 1 },
  { pk: "t6", at: T0 + 400, name: "", amount: -1000, cat: "0", wallet: "w-nequi", paired: "borrada" },
  { pk: "t7", at: T0 + 500, name: "Arriendo", amount: -20000, cat: "c-out", paid: 0 },
  { pk: "t8", at: T0 + 600, name: "USDT", amount: -5, cat: "c-out", wallet: "w-usdt" },
  { pk: "t9", at: T0 + 700, name: "Satoshis", amount: 0.00007, cat: "c-in", wallet: "w-btc", income: 1 },
  { pk: "t10", at: T0 + 800, name: "Cumpleaños", amount: 10000, cat: "c-in", sub: "c-gift-in", income: 1 },
  { pk: "t11", at: T0 + 900, name: "Regalo mamá", amount: -3000, cat: "c-out", sub: "c-gift-out" },
  { pk: "t12", at: T0 + 1000, name: "Ahorro patineta", amount: 2000, cat: "c-in", income: 1, objective: "o1" },
];

export function buildCashewDb(txs: CashewTx[] = CASHEW_TXS): Uint8Array {
  return buildSqlite((db) => {
    db.exec(CASHEW_SCHEMA);
    const w = db.prepare(`INSERT INTO wallets (date_created, "order", archived, name, wallet_pk, currency, decimals) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    w.run(T0, 0, 0, "Billetera Principal", "0", "cop", 2);
    w.run(T0, 1, 0, "Nequi", "w-nequi", "cop", 2);
    w.run(T0, 2, 1, "BNC - USDT", "w-usdt", "usdt", 10);
    w.run(T0, 3, 1, "BNC - BTC", "w-btc", "btc", 10);
    const c = db.prepare(`INSERT INTO categories (date_created, "order", name, colour, category_pk, income, main_category_pk) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    c.run(T0, 0, "Corrección de Balance", "0xff607d8b", "0", 0, null);
    c.run(T0, 1, "Ingresos", "0xff66bb6a", "c-in", 1, null);
    c.run(T0, 2, "Salario Almacén", null, "c-sal", 0, "c-in");
    c.run(T0, 3, "Gastos", "0xffef5350", "c-out", 0, null);
    c.run(T0, 4, "Comida", "0xffffa726", "c-food", 0, "c-out");
    c.run(T0, 5, "Regalos", null, "c-gift-in", 0, "c-in");
    c.run(T0, 6, "Regalos", null, "c-gift-out", 0, "c-out");
    db.prepare(`INSERT INTO objectives (date_created, "order", name, objective_pk, amount, income, wallet_fk) VALUES (?, 0, ?, ?, ?, 1, '0')`).run(T0, "Patineta Eléctrica", "o1", 500000);
    db.prepare(`INSERT INTO app_settings (settings_j_s_o_n, date_updated) VALUES (?, ?)`).run(JSON.stringify({ big: "y".repeat(20000) }), T0);
    const t = db.prepare(
      `INSERT INTO transactions (date_created, name, transaction_pk, paired_transaction_fk, amount, note, category_fk, sub_category_fk, wallet_fk, income, paid, objective_fk)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const x of txs) {
      t.run(x.at, x.name ?? "", x.pk, x.paired ?? null, x.amount, x.note ?? "", x.cat, x.sub ?? null, x.wallet ?? "0", x.income ?? 0, x.paid ?? 1, x.objective ?? null);
    }
  });
}

/* ------------------------------------------------------------------- XLSX */

function crc32(data: Uint8Array): number {
  let c = ~0;
  for (const b of data) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** ZIP real (deflate) con los ficheros indicados. */
export async function buildZip(files: Record<string, string>): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = enc.encode(content);
    const comp = await deflateRaw(raw);
    const nameBytes = enc.encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 8, true);
    local.setUint32(14, crc32(raw), true);
    local.setUint32(18, comp.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(10, 8, true);
    cen.setUint32(16, crc32(raw), true);
    cen.setUint32(20, comp.length, true);
    cen.setUint32(24, raw.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, comp);
    central.push(new Uint8Array(cen.buffer), nameBytes);
    offset += 30 + nameBytes.length + comp.length;
  }
  const cenSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * Extracto bancario típico: título antes de la cabecera, fechas como serial
 * con formato de fecha, débito/crédito en columnas separadas y fila de totales.
 */
export function bankStatementXlsx(): Promise<Uint8Array> {
  const shared = ["Extracto Banco Ejemplo", "Fecha", "Descripción", "Débito", "Crédito", "Saldo", "Supermercado", "27/09/2026", "Total"];
  const s = (i: number) => `<c t="s"><v>${i}</v></c>`;
  return buildZip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Movimientos" sheetId="1" r:id="rId1"/><sheet name="Vacía" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<?xml version="1.0"?><sst>${shared.map((x) => `<si><t>${x}</t></si>`).join("")}</sst>`,
    "xl/styles.xml": `<?xml version="1.0"?><styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1">${s(0)}</row>
      <row r="3">${s(1).replace("<c ", '<c r="A3" ')}${s(2)}${s(3)}${s(4)}${s(5)}</row>
      <row r="4"><c r="A4" s="1"><v>46291</v></c><c r="B4" t="s"><v>6</v></c><c r="C4"><v>45000.5</v></c><c r="E4"><v>954999.5</v></c></row>
      <row r="5"><c r="A5" s="2"><v>46292.5</v></c><c r="B5" t="inlineStr"><is><r><t>Nó</t></r><r><t>mina</t></r></is></c><c r="D5"><v>2500000</v></c></row>
      <row r="6"><c r="A6" t="s"><v>7</v></c><c r="B6" t="inlineStr"><is><t>Café &amp; pan</t></is></c><c r="C6" t="str"><v>3500</v></c></row>
      <row r="7"><c r="A7" t="s"><v>8</v></c><c r="C7"><v>48500.5</v></c><c r="D7"><v>2500000</v></c></row>
      <row r="8"><c r="A8" t="b"><v>1</v></c></row>
    </sheetData></worksheet>`,
    "xl/worksheets/sheet2.xml": `<?xml version="1.0"?><worksheet><sheetData/></worksheet>`,
  });
}
