/**
 * Importación y exportación de datos financieros.
 *
 * Todo fichero importado se trata como entrada NO confiable y se procesa en
 * dos pasos: `plan*` valida y describe qué pasaría (sin escribir nada) y
 * `apply*` ejecuta ese mismo plan dentro de `mutate`, que es atómico. Si hay
 * un solo error, no se aplica nada: una importación a medias deja saldos que
 * no cuadran con ningún estado real.
 *
 * No se importa SQL: ejecutar un script recibido de fuera sería ejecutar código
 * arbitrario sobre los datos. El SQL solo se EXPORTA (ver `sql.ts`).
 */

import { z } from "zod";
import {
  ApiError,
  FINANCE_COLLECTIONS,
  ensureOwnerTags,
  newId,
  nowIso,
  tagOwnerActive,
  type Db,
  type FinCategoryRow,
  type FinTransactionRow,
  type TagRow,
} from "@/services/localDb";
import { stripDangerousKeys } from "@/services/routeKit";
import { parseMoney, toInputValue } from "@/lib/money";
import { FINANCE_ROW_SCHEMAS } from "./schemas";
import { isDateKey } from "./dates";

export const EXPORT_FORMAT = "gestion-tareas/finance";
export const EXPORT_VERSION = 1;
const MAX_ROWS = 50_000;

type Collection = (typeof FINANCE_COLLECTIONS)[number];

/* ---------------------------------------------------------------- exportar */

export function exportFinance(db: Db) {
  const tagIds = new Set(db.finTransactions.flatMap((t) => t.tagIds));
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: nowIso(),
    defaultCurrency: db.settings.currency,
    data: {
      finAccounts: db.finAccounts,
      finCategories: db.finCategories,
      finTransactions: db.finTransactions,
      finBudgets: db.finBudgets,
      finGoals: db.finGoals,
      finRecurring: db.finRecurring,
      finTags: db.finTags,
      // Solo las etiquetas que usan los movimientos: el resto no es de finanzas.
      tags: db.tags.filter((t) => tagIds.has(t.id)),
    },
  };
}

/* -------------------------------------------------------- importar (JSON) */

export interface ImportIssue {
  collection: string;
  index: number;
  id?: string;
  message: string;
}

export interface ImportSummary {
  valid: boolean;
  errors: ImportIssue[];
  warnings: string[];
  counts: Record<string, { insert: number; update: number; unchanged: number; skipped: number }>;
}

interface Plan {
  summary: ImportSummary;
  rows: Partial<Record<Collection, { row: any; action: "insert" | "update" }[]>>;
  tagMap: Map<string, string>;
  newTags: TagRow[];
}

const tagSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).default("#64748b"),
  icon: z.string().max(40).nullable().default(null),
});

const envelope = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.number().int().min(1).max(EXPORT_VERSION),
  data: z.record(z.unknown()),
});

/** Igualdad de contenido estable (orden de claves independiente). */
function sameContent(a: unknown, b: unknown): boolean {
  const norm = (v: any): any =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]))
        : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

export function planFinanceImport(db: Db, raw: unknown, mode: "merge" | "newer"): Plan {
  const errors: ImportIssue[] = [];
  const warnings: string[] = [];
  const counts: ImportSummary["counts"] = {};
  const plan: Plan = { summary: { valid: false, errors, warnings, counts }, rows: {}, tagMap: new Map(), newTags: [] };

  const env = envelope.safeParse(stripDangerousKeys(raw));
  if (!env.success) {
    errors.push({
      collection: "fichero",
      index: -1,
      message: `No es una exportación de finanzas válida (se esperaba formato «${EXPORT_FORMAT}» v${EXPORT_VERSION}).`,
    });
    return plan;
  }
  const data = env.data.data;

  // Etiquetas: se reutiliza la existente con el mismo nombre para no duplicar.
  const tags = z.array(tagSchema).max(1000).safeParse(data.tags ?? []);
  if (!tags.success) {
    errors.push({ collection: "tags", index: -1, message: "Etiquetas con formato incorrecto" });
  } else {
    for (const t of tags.data) {
      const byId = db.tags.find((x) => x.id === t.id);
      const byName = db.tags.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
      if (byId) plan.tagMap.set(t.id, byId.id);
      else if (byName) plan.tagMap.set(t.id, byName.id);
      else {
        plan.newTags.push({ id: t.id, name: t.name, color: t.color, icon: t.icon });
        plan.tagMap.set(t.id, t.id);
      }
    }
  }

  const tombstoneAt = new Map(db.tombstones.map((t) => [`${t.collection}:${t.id}`, Date.parse(t.deletedAt)]));
  // Estado resultante (para comprobar referencias entre lo existente y lo nuevo).
  const ids: Record<Collection, Set<string>> = Object.fromEntries(
    FINANCE_COLLECTIONS.map((c) => [c, new Set((db[c] as { id: string }[]).map((r) => r.id))])
  ) as Record<Collection, Set<string>>;

  for (const c of FINANCE_COLLECTIONS) {
    counts[c] = { insert: 0, update: 0, unchanged: 0, skipped: 0 };
    const list = data[c] ?? [];
    if (!Array.isArray(list)) {
      errors.push({ collection: c, index: -1, message: "Debe ser una lista" });
      continue;
    }
    if (list.length > MAX_ROWS) {
      errors.push({ collection: c, index: -1, message: `Más de ${MAX_ROWS} filas` });
      continue;
    }
    const seen = new Set<string>();
    const out: { row: any; action: "insert" | "update" }[] = [];
    list.forEach((item, index) => {
      const parsed = FINANCE_ROW_SCHEMAS[c].safeParse(item);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        errors.push({
          collection: c,
          index,
          id: typeof (item as any)?.id === "string" ? (item as any).id : undefined,
          message: `${issue.path.join(".") || "fila"}: ${issue.message}`,
        });
        return;
      }
      const row: any = parsed.data;
      if (seen.has(row.id)) {
        errors.push({ collection: c, index, id: row.id, message: "Id repetido dentro del fichero" });
        return;
      }
      seen.add(row.id);
      if (c === "finTransactions") {
        row.tagIds = [...new Set((row.tagIds as string[]).map((id) => plan.tagMap.get(id) ?? (db.tags.some((t) => t.id === id) ? id : null)).filter(Boolean))];
      }

      const killed = tombstoneAt.get(`${c}:${row.id}`);
      if (killed !== undefined && killed >= Date.parse(row.updatedAt)) {
        counts[c].skipped++; // se borró aquí después de exportarse
        return;
      }
      const existing = (db[c] as any[]).find((r) => r.id === row.id);
      if (!existing) {
        out.push({ row, action: "insert" });
        counts[c].insert++;
        ids[c].add(row.id);
      } else if (sameContent(existing, row)) {
        counts[c].unchanged++;
      } else if (mode === "newer" && Date.parse(existing.updatedAt) >= Date.parse(row.updatedAt)) {
        counts[c].skipped++; // lo local es igual de reciente o más
      } else {
        if (c === "finAccounts" && existing.currency !== row.currency) {
          const used = db.finTransactions.some((t) => t.accountId === row.id || t.toAccountId === row.id);
          if (used) {
            errors.push({ collection: c, index, id: row.id, message: "Cambiaría la moneda de una cuenta con movimientos" });
            return;
          }
        }
        out.push({ row, action: "update" });
        counts[c].update++;
      }
    });
    plan.rows[c] = out;
  }

  // Integridad referencial sobre el estado resultante.
  const ref = (c: Collection, id: string | null | undefined, from: string, index: number, rowId: string) => {
    if (id && !ids[c].has(id)) {
      errors.push({ collection: from, index, id: rowId, message: `Referencia a ${c} inexistente: ${id}` });
    }
  };
  (plan.rows.finTransactions ?? []).forEach(({ row }, i) => {
    ref("finAccounts", row.accountId, "finTransactions", i, row.id);
    ref("finAccounts", row.toAccountId, "finTransactions", i, row.id);
    ref("finCategories", row.categoryId, "finTransactions", i, row.id);
    ref("finGoals", row.goalId, "finTransactions", i, row.id);
    if (row.kind === "transfer" && (!row.toAccountId || row.toAccountId === row.accountId)) {
      errors.push({ collection: "finTransactions", index: i, id: row.id, message: "Transferencia sin destino válido" });
    }
    if (row.kind !== "adjustment" && row.amount <= 0) {
      errors.push({ collection: "finTransactions", index: i, id: row.id, message: "Importe no positivo" });
    }
    for (const a of row.allocations ?? []) ref("finTags", a.tagId, "finTransactions", i, row.id);
  });
  (plan.rows.finTags ?? []).forEach(({ row }, i) => {
    ref(row.ownerType === "budget" ? "finBudgets" : "finGoals", row.ownerId, "finTags", i, row.id);
  });
  (plan.rows.finBudgets ?? []).forEach(({ row }, i) => {
    row.categoryIds.forEach((id: string) => ref("finCategories", id, "finBudgets", i, row.id));
    row.accountIds.forEach((id: string) => ref("finAccounts", id, "finBudgets", i, row.id));
  });
  (plan.rows.finGoals ?? []).forEach(({ row }, i) => {
    row.accountIds.forEach((id: string) => ref("finAccounts", id, "finGoals", i, row.id));
  });
  (plan.rows.finRecurring ?? []).forEach(({ row }, i) => {
    ref("finAccounts", row.accountId, "finRecurring", i, row.id);
    ref("finAccounts", row.toAccountId, "finRecurring", i, row.id);
    ref("finCategories", row.categoryId, "finRecurring", i, row.id);
    ref("finGoals", row.goalId, "finRecurring", i, row.id);
    for (const a of row.allocations ?? []) ref("finTags", a.tagId, "finRecurring", i, row.id);
  });

  if (plan.newTags.length) warnings.push(`Se crearán ${plan.newTags.length} etiqueta(s) nueva(s).`);
  plan.summary.valid = errors.length === 0;
  // Los errores se acotan para no devolver 50.000 líneas a la interfaz.
  plan.summary.errors = errors.slice(0, 200);
  return plan;
}

export function applyFinanceImport(db: Db, raw: unknown, mode: "merge" | "newer"): ImportSummary {
  const plan = planFinanceImport(db, raw, mode);
  if (!plan.summary.valid) {
    const first = plan.summary.errors[0];
    throw new ApiError(400, `Importación cancelada: ${plan.summary.errors.length} error(es). Primero: ${first?.message ?? "formato"}`);
  }
  db.tags.push(...plan.newTags);
  for (const c of FINANCE_COLLECTIONS) {
    const target = db[c] as any[];
    for (const { row, action } of plan.rows[c] ?? []) {
      if (action === "insert") target.push(row);
      else {
        const i = target.findIndex((r) => r.id === row.id);
        // En modo `merge` lo importado manda aunque sea más antiguo: se sella
        // con una marca nueva para que la sincronización no lo deshaga.
        target[i] = mode === "merge" ? { ...row, updatedAt: nowIso() } : row;
      }
    }
  }
  // Copias anteriores a las etiquetas financieras: se generan las que falten.
  ensureOwnerTags(db);
  return plan.summary;
}

/* ------------------------------------------------------------------ CSV */

const KIND_ALIASES: Record<string, FinTransactionRow["kind"]> = {
  ingreso: "income",
  income: "income",
  gasto: "expense",
  expense: "expense",
  egreso: "expense",
  transferencia: "transfer",
  transfer: "transfer",
  correccion: "adjustment",
  corrección: "adjustment",
  ajuste: "adjustment",
  adjustment: "adjustment",
};

const KIND_LABEL: Record<FinTransactionRow["kind"], string> = {
  income: "ingreso",
  expense: "gasto",
  transfer: "transferencia",
  adjustment: "correccion",
};

const HEADER_ALIASES: Record<string, string> = {
  id: "id",
  fecha: "date",
  date: "date",
  tipo: "kind",
  type: "kind",
  kind: "kind",
  importe: "amount",
  monto: "amount",
  valor: "amount",
  amount: "amount",
  cuenta: "account",
  account: "account",
  cuenta_destino: "toAccount",
  destino: "toAccount",
  to_account: "toAccount",
  importe_destino: "toAmount",
  to_amount: "toAmount",
  categoria: "category",
  categoría: "category",
  category: "category",
  concepto: "concept",
  concept: "concept",
  descripcion: "description",
  descripción: "description",
  description: "description",
  etiquetas: "tags",
  tags: "tags",
  motivo: "reason",
  reason: "reason",
  finalidades: "purposes",
  purposes: "purposes",
};

/** Parser CSV RFC 4180 (comillas, saltos de línea dentro de campo). Detecta `,` o `;`. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/** Hash no criptográfico estable (cyrb53) para ids deterministas de importación. */
export function stableHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function parseCsvDate(v: string): string | null {
  const s = v.trim();
  if (isDateKey(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // DD/MM/AAAA
  if (m) {
    const key = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return isDateKey(key) ? key : null;
  }
  return null;
}

export interface CsvOptions {
  defaultAccountId?: string | null;
  createCategories?: boolean;
}

export interface CsvSummary {
  valid: boolean;
  total: number;
  toImport: number;
  duplicates: number;
  errors: { line: number; message: string }[];
  warnings: string[];
  newCategories: string[];
  preview: { line: number; date: string; kind: string; amount: number; account: string; concept: string; duplicate: boolean }[];
}

interface CsvPlan {
  summary: CsvSummary;
  transactions: FinTransactionRow[];
  categories: FinCategoryRow[];
}

export function planCsvImport(db: Db, text: string, options: CsvOptions = {}): CsvPlan {
  const summary: CsvSummary = {
    valid: false,
    total: 0,
    toImport: 0,
    duplicates: 0,
    errors: [],
    warnings: [],
    newCategories: [],
    preview: [],
  };
  const plan: CsvPlan = { summary, transactions: [], categories: [] };
  const rows = parseCsv(text);
  if (rows.length < 2) {
    summary.errors.push({ line: 1, message: "El CSV no tiene cabecera y al menos una fila" });
    return plan;
  }
  if (rows.length - 1 > MAX_ROWS) {
    summary.errors.push({ line: 1, message: `Más de ${MAX_ROWS} filas` });
    return plan;
  }

  const header = rows[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/\s+/g, "_")] ?? null);
  for (const need of ["date", "amount", "concept"]) {
    if (!header.includes(need)) {
      summary.errors.push({ line: 1, message: `Falta la columna obligatoria «${need === "date" ? "fecha" : need === "amount" ? "importe" : "concepto"}»` });
    }
  }
  if (!header.includes("account") && !options.defaultAccountId) {
    summary.errors.push({ line: 1, message: "Falta la columna «cuenta» y no se eligió una cuenta por defecto" });
  }
  if (summary.errors.length) return plan;

  const accountByName = new Map(
    db.finAccounts.filter((a) => !a.archived).map((a) => [a.name.trim().toLowerCase(), a])
  );
  const defaultAccount = options.defaultAccountId
    ? db.finAccounts.find((a) => a.id === options.defaultAccountId)
    : undefined;
  const categoryByName = new Map(db.finCategories.map((c) => [c.name.trim().toLowerCase(), c]));
  const tagByName = new Map(db.tags.map((t) => [t.name.trim().toLowerCase(), t]));
  // Finalidades: solo etiquetas de presupuestos/metas activos, por nombre.
  const purposeByName = new Map(
    (db.finTags ?? []).filter((t) => tagOwnerActive(db, t)).map((t) => [t.name.toLowerCase(), t])
  );
  const existingIds = new Set(db.finTransactions.map((t) => t.id));
  // Huella de movimientos ya registrados a mano: misma fecha, cuenta, tipo e importe.
  const existingPrints = new Set(
    db.finTransactions.map((t) => `${t.date}|${t.accountId}|${t.kind}|${t.amount}`)
  );
  const occurrences = new Map<string, number>();
  const unknownTags = new Set<string>();
  const ts = nowIso();

  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    summary.total++;
    const get = (k: string) => {
      const idx = header.indexOf(k);
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };
    const fail = (message: string) => summary.errors.push({ line, message });

    const date = parseCsvDate(get("date"));
    if (!date) return fail(`Fecha no válida: «${get("date")}» (usa AAAA-MM-DD o DD/MM/AAAA)`);

    let amount = parseMoney(get("amount"));
    if (amount === null) return fail(`Importe no válido: «${get("amount")}»`);

    const kindText = get("kind").toLowerCase();
    let kind = kindText ? KIND_ALIASES[kindText] : undefined;
    if (kindText && !kind) return fail(`Tipo desconocido: «${get("kind")}»`);
    if (!kind) kind = amount < 0 ? "expense" : "income"; // sin columna tipo: el signo manda
    if (kind !== "adjustment") amount = Math.abs(amount);
    if (amount === 0) return fail("Importe 0");

    const accountName = get("account");
    const account = accountName ? accountByName.get(accountName.toLowerCase()) : defaultAccount;
    if (!account) return fail(`Cuenta no encontrada: «${accountName}»`);

    let toAccountId: string | null = null;
    let toAmount: number | null = null;
    if (kind === "transfer") {
      const to = accountByName.get(get("toAccount").toLowerCase());
      if (!to || to.id === account.id) return fail("Transferencia sin cuenta de destino válida");
      toAccountId = to.id;
      if (to.currency !== account.currency) {
        toAmount = parseMoney(get("toAmount"));
        if (!toAmount || toAmount <= 0) return fail("Transferencia entre monedas sin «importe_destino»");
      }
    }

    const concept = get("concept").slice(0, 120);
    if (!concept) return fail("Concepto vacío");

    let categoryId: string | null = null;
    const catName = get("category");
    if (catName && (kind === "income" || kind === "expense")) {
      let cat = categoryByName.get(catName.toLowerCase());
      if (!cat && options.createCategories) {
        cat = {
          id: newId(),
          name: catName.slice(0, 60),
          kind,
          color: "#64748b",
          icon: "Tag",
          archived: false,
          createdAt: ts,
          updatedAt: ts,
        };
        categoryByName.set(catName.toLowerCase(), cat);
        plan.categories.push(cat);
        summary.newCategories.push(cat.name);
      }
      if (!cat) summary.warnings.push(`Línea ${line}: categoría «${catName}» no existe; queda sin categoría.`);
      else if (cat.kind !== "both" && cat.kind !== kind) {
        return fail(`La categoría «${cat.name}» no es de ${kind === "income" ? "ingreso" : "gasto"}`);
      } else categoryId = cat.id;
    }

    // Finalidades: "#Ordenador=500|#ViajeJapon=300". Nunca se deducen solas.
    const allocations: { id: string; tagId: string; amount: number; flow: "assign" | "use" }[] = [];
    const purposeText = get("purposes");
    if (purposeText) {
      let bad: string | null = null;
      for (const part of purposeText.split("|").map((x) => x.trim()).filter(Boolean)) {
        const [rawName, rawAmount] = part.split("=");
        const tag = purposeByName.get(rawName.replace(/^#/, "").trim().toLowerCase());
        const cents = rawAmount === undefined ? null : parseMoney(rawAmount);
        if (!tag) {
          bad = `Finalidad desconocida o inactiva: «${rawName.trim()}»`;
          break;
        }
        if (!cents || cents <= 0) {
          bad = `Importe de finalidad no válido: «${part}»`;
          break;
        }
        allocations.push({
          id: "",
          tagId: tag.id,
          amount: cents,
          flow: kind === "expense" || (kind === "adjustment" && amount < 0) ? "use" : "assign",
        });
      }
      if (bad) return fail(bad);
      const cap = kind === "transfer" ? toAmount ?? amount : Math.abs(amount);
      if (allocations.reduce((sum, a) => sum + a.amount, 0) > cap) {
        return fail("Las finalidades suman más que el importe");
      }
    }

    const tagIds: string[] = [];
    for (const name of get("tags").split("|").map((s) => s.trim()).filter(Boolean)) {
      const tag = tagByName.get(name.toLowerCase());
      if (tag) tagIds.push(tag.id);
      else unknownTags.add(name);
    }

    // Id determinista: reimportar el mismo fichero (o hacerlo en dos
    // dispositivos) no duplica. El índice de aparición distingue dos cafés
    // idénticos el mismo día dentro del mismo fichero.
    const print = `${date}|${account.id}|${kind}|${amount}|${concept.toLowerCase()}`;
    const n = (occurrences.get(print) ?? 0) + 1;
    occurrences.set(print, n);
    const explicitId = get("id");
    const id = explicitId && /^[\w:-]{1,128}$/.test(explicitId) ? explicitId : `csv-${stableHash(`${print}#${n}`)}`;
    allocations.forEach((a, k) => (a.id = `${id}-a${k}`.slice(0, 128)));

    const duplicate =
      existingIds.has(id) || (n === 1 && existingPrints.has(`${date}|${account.id}|${kind}|${amount}`));
    if (summary.preview.length < 50) {
      summary.preview.push({ line, date, kind, amount, account: account.name, concept, duplicate });
    }
    if (duplicate) {
      summary.duplicates++;
      return;
    }

    plan.transactions.push({
      id,
      kind,
      amount,
      accountId: account.id,
      toAccountId,
      toAmount,
      categoryId,
      date,
      concept,
      description: get("description").slice(0, 2000) || null,
      tagIds,
      goalId: null,
      allocations,
      recurringId: null,
      reason: kind === "adjustment" ? get("reason").slice(0, 300) || "Importado desde CSV" : null,
      createdAt: ts,
      updatedAt: ts,
    });
  });

  if (unknownTags.size) summary.warnings.push(`Etiquetas desconocidas ignoradas: ${[...unknownTags].join(", ")}`);
  summary.toImport = plan.transactions.length;
  summary.valid = summary.errors.length === 0;
  summary.errors = summary.errors.slice(0, 200);
  summary.warnings = summary.warnings.slice(0, 50);
  return plan;
}

export function applyCsvImport(db: Db, text: string, options: CsvOptions = {}): CsvSummary {
  const plan = planCsvImport(db, text, options);
  if (!plan.summary.valid) {
    throw new ApiError(400, `Importación cancelada: ${plan.summary.errors.length} error(es). Primero (línea ${plan.summary.errors[0]?.line}): ${plan.summary.errors[0]?.message}`);
  }
  db.finCategories.push(...plan.categories);
  db.finTransactions.push(...plan.transactions);
  return plan.summary;
}

/** Evita la inyección de fórmulas al abrir el CSV en Excel/Sheets. */
function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV de movimientos (reimportable: incluye `id`). */
export function transactionsToCsv(
  db: Pick<Db, "finAccounts" | "finCategories" | "tags"> & { finTags?: Db["finTags"] },
  txs: FinTransactionRow[]
): string {
  const purpose = new Map((db.finTags ?? []).map((t) => [t.id, t.name]));
  const acc = new Map(db.finAccounts.map((a) => [a.id, a]));
  const cat = new Map(db.finCategories.map((c) => [c.id, c.name]));
  const tag = new Map(db.tags.map((t) => [t.id, t.name]));
  const header = [
    "id",
    "fecha",
    "tipo",
    "importe",
    "moneda",
    "cuenta",
    "cuenta_destino",
    "importe_destino",
    "categoria",
    "concepto",
    "descripcion",
    "etiquetas",
    "motivo",
    "finalidades",
  ];
  const lines = [header.join(",")];
  for (const t of txs) {
    lines.push(
      [
        csvCell(t.id),
        t.date,
        KIND_LABEL[t.kind],
        toInputValue(t.amount),
        acc.get(t.accountId)?.currency ?? "",
        csvCell(acc.get(t.accountId)?.name ?? ""),
        csvCell(t.toAccountId ? acc.get(t.toAccountId)?.name ?? "" : ""),
        t.toAmount !== null ? toInputValue(t.toAmount) : "",
        csvCell(t.categoryId ? cat.get(t.categoryId) ?? "" : ""),
        csvCell(t.concept),
        csvCell(t.description ?? ""),
        csvCell(t.tagIds.map((id) => tag.get(id)).filter(Boolean).join("|")),
        csvCell(t.reason ?? ""),
        csvCell(
          (t.allocations ?? [])
            .filter((a) => purpose.has(a.tagId))
            .map((a) => `#${purpose.get(a.tagId)}=${toInputValue(a.amount)}`)
            .join("|")
        ),
      ].join(",")
    );
  }
  // BOM: Excel abre así el UTF-8 con tildes correctamente.
  return `﻿${lines.join("\r\n")}\r\n`;
}

