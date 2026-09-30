/**
 * Adaptador de copias de seguridad de Cashew (SQLite, exportadas como `.sql`).
 *
 * Estructura relevante (Cashew, esquema v4x):
 *   - `wallets`: `wallet_pk`, `name`, `currency` (minúsculas, p. ej. "cop"),
 *     `archived` (0/1). La billetera "0" es la principal.
 *   - `categories`: `category_pk`, `name`, `income` (0/1), `colour` (ARGB
 *     "0xff66bb6a"), `main_category_pk` (subcategorías). La categoría "0" es
 *     «Corrección de Balance».
 *   - `transactions`: `transaction_pk`, `name` (título, puede ir vacío),
 *     `amount` REAL con signo (negativo = gasto), `note`, `category_fk`,
 *     `sub_category_fk`, `wallet_fk`, `income` (0/1), `paid` (0 = pendiente),
 *     `date_created` (timestamp Unix en SEGUNDOS: es la fecha del movimiento),
 *     `paired_transaction_fk` (las dos patas de una transferencia),
 *     `objective_fk` (objetivo de ahorro).
 *   - `objectives`: `objective_pk`, `name`.
 *
 * Una transferencia en Cashew son DOS filas de «Corrección de Balance»
 * enlazadas; aquí se convierten en un único movimiento `transfer`, que es como
 * la app las modela (no son ingreso ni gasto). Las correcciones sueltas se
 * importan como `adjustment` con su signo.
 */

import { cleanText, isBalanceCorrection, parseColor, normKey, type Cell } from "./normalize";
import type { AccountHint, CashewSource, Extracted, RawRecord } from "./types";

export const CASHEW_TABLES = ["wallets", "categories", "transactions"] as const;
const REQUIRED_TX_COLUMNS = ["transaction_pk", "amount", "wallet_fk", "category_fk", "date_created"];

/** ¿Estas tablas SQLite son una copia de Cashew? */
export function looksLikeCashew(tables: { name: string; columns: string[] }[]): boolean {
  const tx = tables.find((t) => t.name === "transactions");
  return (
    CASHEW_TABLES.every((n) => tables.some((t) => t.name === n)) &&
    !!tx &&
    REQUIRED_TX_COLUMNS.every((c) => tx.columns.includes(c))
  );
}

const str = (v: Cell | undefined) => (v === null || v === undefined ? "" : String(v));
const num = (v: Cell | undefined) => (typeof v === "number" ? v : Number(v));

export function cashewRecords(src: CashewSource): Extracted {
  const wallets = new Map(src.wallets.map((w) => [str(w.wallet_pk), w]));
  const categories = new Map(src.categories.map((c) => [str(c.category_pk), c]));
  const objectives = new Map((src.objectives ?? []).map((o) => [str(o.objective_pk), str(o.name)]));

  const accountHints = new Map<string, AccountHint>();
  for (const [pk, w] of wallets) {
    const name = cleanText(w.name) || `Billetera ${pk}`;
    accountHints.set(normKey(name), {
      name,
      id: `cashew-w-${pk}`.slice(0, 128),
      currency: str(w.currency).trim().toUpperCase(),
      archived: num(w.archived) === 1,
      type: "wallet",
    });
  }
  const categoryColors = new Map<string, string>();
  for (const c of categories.values()) {
    const color = parseColor(c.colour);
    if (color) categoryColors.set(normKey(c.name), color);
  }

  // Orden cronológico estable: el número de fila es la posición en esa lista.
  const txs = [...src.transactions].sort((a, b) => num(a.date_created) - num(b.date_created));
  const rowOf = new Map(txs.map((t, i) => [str(t.transaction_pk), i + 1]));
  const byPk = new Map(txs.map((t) => [str(t.transaction_pk), t]));

  // Parejas de transferencia (el enlace puede estar en una sola de las dos patas).
  const partner = new Map<string, string>();
  for (const t of txs) {
    const pk = str(t.transaction_pk);
    const fk = str(t.paired_transaction_fk);
    if (fk && byPk.has(fk) && fk !== pk && !partner.has(pk) && !partner.has(fk)) {
      partner.set(pk, fk);
      partner.set(fk, pk);
    }
  }

  const walletName = (fk: Cell | undefined) => {
    const w = wallets.get(str(fk));
    return w ? cleanText(w.name) || `Billetera ${str(fk)}` : str(fk);
  };
  const categoryName = (fk: Cell | undefined) => cleanText(categories.get(str(fk))?.name);

  const records: RawRecord[] = txs.map((t, i): RawRecord => {
    const row = i + 1;
    const pk = str(t.transaction_pk);
    const amount = num(t.amount);
    const note = cleanText(t.note);
    const objective = objectives.get(str(t.objective_fk));
    const description = [note, objective ? `Objetivo en Cashew: ${objective}` : ""].filter(Boolean).join("\n") || null;
    // Fecha ausente o a cero: se deja vacía (nunca se inventa); la de
    // modificación solo se ofrece como pista en la sugerencia.
    const created = typeof t.date_created === "number" && t.date_created > 0 ? t.date_created : null;
    const modified = typeof t.date_time_modified === "number" && t.date_time_modified > 0 ? new Date(t.date_time_modified * 1000).toISOString().slice(0, 10) : undefined;
    const base: RawRecord = {
      row,
      values: { id: `cashew-${pk}`, date: created, concept: cleanText(t.name), description, account: walletName(t.wallet_fk) },
      kindLocked: true,
      issues: [],
      original: {
        transaction_pk: pk,
        name: str(t.name),
        amount: str(t.amount),
        date_created: str(t.date_created),
        wallet: walletName(t.wallet_fk),
        category: categoryName(t.category_fk),
        subcategory: categoryName(t.sub_category_fk),
        note: str(t.note),
      },
      dateSuggestion: created ? undefined : modified && `Cashew registra una modificación el ${modified}; si es la fecha del movimiento, escríbela`,
    };
    if (num(t.paid) === 0) base.defaultExcluded = "Pendiente de pago en Cashew";

    const mate = partner.get(pk);
    if (mate) {
      const other = byPk.get(mate)!;
      const otherAmount = num(other.amount);
      if (Math.sign(amount) !== Math.sign(otherAmount)) {
        if (amount > 0) {
          // Pata de entrada: la transferencia la representa la pata de salida.
          return { ...base, mergedInto: rowOf.get(mate), values: { ...base.values, kind: "transfer", amount: Math.abs(amount) } };
        }
        return {
          ...base,
          values: {
            ...base.values,
            kind: "transfer",
            amount: Math.abs(amount),
            toAccount: walletName(other.wallet_fk),
            toAmount: Math.abs(otherAmount),
            concept: cleanText(t.name) || cleanText(other.name) || "Transferencia",
          },
        };
      }
    }

    const correction = str(t.category_fk) === "0" || isBalanceCorrection(categoryName(t.category_fk));
    if (correction || str(t.paired_transaction_fk)) {
      if (str(t.paired_transaction_fk) && !mate) {
        base.issues.push({
          row,
          field: "kind",
          severity: "warning",
          original: "transferencia",
          message: "Transferencia de Cashew sin su contrapartida (se borró allí): se importa como corrección de saldo",
          suggestion: "Revisa el saldo de la cuenta tras importar o excluye la fila",
        });
      }
      return {
        ...base,
        values: {
          ...base.values,
          kind: "adjustment",
          amount,
          reason: cleanText(t.name) || note.split("\n")[0] || "Corrección de balance importada de Cashew",
          category: categoryName(t.category_fk),
        },
      };
    }

    const income = num(t.income) === 1;
    if ((income && amount < 0) || (!income && amount > 0)) {
      base.issues.push({
        row,
        field: "amount",
        severity: "warning",
        original: String(amount),
        message: `Cashew marca la fila como ${income ? "ingreso" : "gasto"} pero el importe es ${amount < 0 ? "negativo" : "positivo"}`,
        suggestion: "Se respeta la marca de Cashew; corrige el tipo si no es correcto",
      });
    }
    return {
      ...base,
      values: {
        ...base.values,
        kind: income ? "income" : "expense",
        amount: Math.abs(amount),
        category: categoryName(t.sub_category_fk) || categoryName(t.category_fk),
      },
    };
  });

  return {
    records,
    accountHints,
    categoryColors,
    fileIssues: (src.notes ?? []).map((n) => ({ row: 0, field: "file", severity: "fixed", original: "", message: n, suggestion: "" })),
    headers: [],
    mapping: [],
    mappingSource: [],
    preset: "Cashew (copia de seguridad SQLite)",
  };
}
