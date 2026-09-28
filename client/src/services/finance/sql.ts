/**
 * Representación SQL (SQLite) del módulo de finanzas.
 *
 * - `FINANCE_MIGRATIONS` son las migraciones de ESTRUCTURA, versionadas. El
 *   fichero `server/prisma/migrations/finance/V1__finance.sql` es exactamente
 *   `FINANCE_MIGRATIONS[0].sql` (un test lo comprueba), así que la base del
 *   servidor y la exportación de la app no pueden divergir en silencio.
 * - `financeSqlDump` genera un fichero de DATOS (INSERTs) separado del
 *   esquema, dentro de una transacción: o entra todo o no entra nada.
 *
 * Diseño relacional: los importes son INTEGER en céntimos con CHECK de signo;
 * las listas (etiquetas, cuentas de un presupuesto…) van en tablas puente con
 * claves foráneas, no en columnas de texto.
 */

import type { Db } from "@/services/localDb";
import { allocationsOf } from "./calc";

export interface SqlMigration {
  version: number;
  name: string;
  sql: string;
}

const V1 = `-- V1__finance: módulo de finanzas (estructura). Importes en céntimos (INTEGER).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS fin_schema_version (
  version    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  applied_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS fin_accounts (
  id               TEXT    PRIMARY KEY,
  name             TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  type             TEXT    NOT NULL CHECK (type IN ('cash','bank','savings','credit_card','wallet','investment','other')),
  currency         TEXT    NOT NULL CHECK (length(currency) = 3),
  initial_balance  INTEGER NOT NULL DEFAULT 0,
  description      TEXT,
  color            TEXT    NOT NULL,
  icon             TEXT    NOT NULL,
  archived         INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  include_in_total INTEGER NOT NULL DEFAULT 1 CHECK (include_in_total IN (0,1)),
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS fin_categories (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  kind       TEXT    NOT NULL CHECK (kind IN ('income','expense','both')),
  color      TEXT    NOT NULL,
  icon       TEXT    NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS fin_goals (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  description   TEXT,
  target_amount INTEGER NOT NULL CHECK (target_amount > 0),
  currency      TEXT    NOT NULL CHECK (length(currency) = 3),
  start_date    TEXT    NOT NULL,
  deadline      TEXT,
  icon          TEXT    NOT NULL,
  color         TEXT    NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN ('active','paused','completed','archived')),
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  CHECK (deadline IS NULL OR deadline >= start_date)
);

CREATE TABLE IF NOT EXISTS fin_goal_accounts (
  goal_id    TEXT NOT NULL REFERENCES fin_goals(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES fin_accounts(id) ON DELETE RESTRICT,
  PRIMARY KEY (goal_id, account_id)
);

CREATE TABLE IF NOT EXISTS fin_recurring (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind          TEXT    NOT NULL CHECK (kind IN ('income','expense','transfer')),
  amount        INTEGER NOT NULL CHECK (amount > 0),
  account_id    TEXT    NOT NULL REFERENCES fin_accounts(id) ON DELETE RESTRICT,
  to_account_id TEXT    REFERENCES fin_accounts(id) ON DELETE RESTRICT,
  category_id   TEXT    REFERENCES fin_categories(id) ON DELETE RESTRICT,
  goal_id       TEXT    REFERENCES fin_goals(id) ON DELETE SET NULL,
  frequency     TEXT    NOT NULL CHECK (frequency IN ('daily','weekly','biweekly','monthly','quarterly','yearly')),
  start_date    TEXT    NOT NULL,
  end_date      TEXT,
  status        TEXT    NOT NULL CHECK (status IN ('active','paused','ended')),
  note          TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (kind <> 'transfer' OR (to_account_id IS NOT NULL AND to_account_id <> account_id))
);

CREATE TABLE IF NOT EXISTS fin_recurring_skips (
  recurring_id TEXT NOT NULL REFERENCES fin_recurring(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  PRIMARY KEY (recurring_id, date)
);

CREATE TABLE IF NOT EXISTS fin_transactions (
  id            TEXT    PRIMARY KEY,
  kind          TEXT    NOT NULL CHECK (kind IN ('income','expense','transfer','adjustment')),
  amount        INTEGER NOT NULL,
  account_id    TEXT    NOT NULL REFERENCES fin_accounts(id) ON DELETE RESTRICT,
  to_account_id TEXT    REFERENCES fin_accounts(id) ON DELETE RESTRICT,
  to_amount     INTEGER CHECK (to_amount IS NULL OR to_amount > 0),
  category_id   TEXT    REFERENCES fin_categories(id) ON DELETE RESTRICT,
  date          TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  concept       TEXT    NOT NULL CHECK (length(concept) BETWEEN 1 AND 120),
  description   TEXT,
  goal_id       TEXT    REFERENCES fin_goals(id) ON DELETE RESTRICT,
  recurring_id  TEXT    REFERENCES fin_recurring(id) ON DELETE SET NULL,
  reason        TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  -- Ingresos, gastos y transferencias son positivos; una corrección lleva signo y motivo.
  CHECK ((kind = 'adjustment' AND amount <> 0 AND reason IS NOT NULL) OR (kind <> 'adjustment' AND amount > 0)),
  CHECK (kind <> 'transfer' OR (to_account_id IS NOT NULL AND to_account_id <> account_id))
);

CREATE TABLE IF NOT EXISTS fin_transaction_tags (
  transaction_id TEXT NOT NULL REFERENCES fin_transactions(id) ON DELETE CASCADE,
  tag_id         TEXT NOT NULL,
  tag_name       TEXT NOT NULL,
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE TABLE IF NOT EXISTS fin_budgets (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  description   TEXT,
  kind          TEXT    NOT NULL CHECK (kind IN ('spending','saving')),
  amount        INTEGER NOT NULL CHECK (amount > 0),
  currency      TEXT    NOT NULL CHECK (length(currency) = 3),
  period        TEXT    NOT NULL CHECK (period IN ('weekly','monthly','quarterly','yearly','custom')),
  start_date    TEXT    NOT NULL,
  end_date      TEXT,
  status        TEXT    NOT NULL CHECK (status IN ('active','paused','archived')),
  alert_percent INTEGER NOT NULL DEFAULT 80 CHECK (alert_percent BETWEEN 1 AND 100),
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (period <> 'custom' OR end_date IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS fin_budget_categories (
  budget_id   TEXT NOT NULL REFERENCES fin_budgets(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES fin_categories(id) ON DELETE RESTRICT,
  PRIMARY KEY (budget_id, category_id)
);

CREATE TABLE IF NOT EXISTS fin_budget_accounts (
  budget_id  TEXT NOT NULL REFERENCES fin_budgets(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES fin_accounts(id) ON DELETE RESTRICT,
  PRIMARY KEY (budget_id, account_id)
);

-- Consultas calientes: movimientos por cuenta y fecha, por categoría y por meta.
CREATE INDEX IF NOT EXISTS fin_tx_account_date   ON fin_transactions (account_id, date);
CREATE INDEX IF NOT EXISTS fin_tx_to_account     ON fin_transactions (to_account_id) WHERE to_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fin_tx_date_kind      ON fin_transactions (date, kind);
CREATE INDEX IF NOT EXISTS fin_tx_category_date  ON fin_transactions (category_id, date);
CREATE INDEX IF NOT EXISTS fin_tx_goal           ON fin_transactions (goal_id) WHERE goal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fin_tx_recurring      ON fin_transactions (recurring_id) WHERE recurring_id IS NOT NULL;

INSERT OR IGNORE INTO fin_schema_version (version, name) VALUES (1, 'finance');
`;

const V2 = `-- V2__finance_tags: etiquetas financieras (finalidades) y asignaciones por movimiento.
PRAGMA foreign_keys = ON;

-- Una etiqueta por presupuesto o meta (1:1). El dueño es polimórfico
-- (owner_type), por eso la integridad con fin_budgets/fin_goals se garantiza
-- en la aplicación; UNIQUE(owner_id) impide dos etiquetas para el mismo dueño.
CREATE TABLE IF NOT EXISTS fin_tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('budget','goal')),
  owner_id   TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Reparto de un movimiento entre finalidades. No altera saldos; la suma por
-- movimiento nunca supera su importe (lo valida la aplicación y el trigger).
CREATE TABLE IF NOT EXISTS fin_allocations (
  id             TEXT    PRIMARY KEY,
  transaction_id TEXT    NOT NULL REFERENCES fin_transactions(id) ON DELETE CASCADE,
  tag_id         TEXT    NOT NULL REFERENCES fin_tags(id) ON DELETE RESTRICT,
  amount         INTEGER NOT NULL CHECK (amount > 0),
  flow           TEXT    NOT NULL CHECK (flow IN ('assign','use')),
  UNIQUE (transaction_id, tag_id, flow)
);

CREATE INDEX IF NOT EXISTS fin_alloc_tag ON fin_allocations (tag_id);

CREATE TRIGGER IF NOT EXISTS fin_alloc_cap
BEFORE INSERT ON fin_allocations
BEGIN
  SELECT RAISE(ABORT, 'Las asignaciones superan el importe del movimiento')
  WHERE (
    SELECT COALESCE(SUM(amount), 0) FROM fin_allocations WHERE transaction_id = NEW.transaction_id
  ) + NEW.amount > (
    SELECT CASE WHEN kind = 'transfer' THEN COALESCE(to_amount, amount) ELSE abs(amount) END
    FROM fin_transactions WHERE id = NEW.transaction_id
  );
END;

INSERT OR IGNORE INTO fin_schema_version (version, name) VALUES (2, 'finance_tags');
`;

export const FINANCE_MIGRATIONS: SqlMigration[] = [
  { version: 1, name: "V1__finance", sql: V1 },
  { version: 2, name: "V2__finance_tags", sql: V2 },
];

/** Literal SQL seguro: comillas simples duplicadas; NULL; enteros tal cual. */
export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("Número no finito en exportación SQL");
    return String(v);
  }
  // Se eliminan NUL: SQLite corta la cadena ahí.
  return `'${String(v).replace(/\u0000/g, "").replace(/'/g, "''")}'`;
}

function insert(table: string, row: Record<string, unknown>): string {
  const cols = Object.keys(row);
  return `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => sqlLiteral(row[c])).join(", ")});`;
}

/**
 * Volcado de DATOS financieros. Separado del esquema a propósito: aplicar el
 * volcado exige que la migración de estructura ya exista (`includeSchema`
 * permite generar un fichero autocontenido para una base vacía).
 */
export function financeSqlDump(db: Db, opts: { includeSchema?: boolean } = {}): string {
  const out: string[] = [
    `-- Datos financieros exportados el ${new Date().toISOString()}`,
    "-- Importes en céntimos. Requiere los esquemas V1__finance y V2__finance_tags.",
  ];
  if (opts.includeSchema) out.push(V1, V2);
  out.push("PRAGMA foreign_keys = ON;", "BEGIN TRANSACTION;");

  const tagName = new Map(db.tags.map((t) => [t.id, t.name]));

  for (const a of db.finAccounts) {
    out.push(
      insert("fin_accounts", {
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        initial_balance: a.initialBalance,
        description: a.description,
        color: a.color,
        icon: a.icon,
        archived: a.archived,
        include_in_total: a.includeInTotal,
        created_at: a.createdAt,
        updated_at: a.updatedAt,
      })
    );
  }
  for (const c of db.finCategories) {
    out.push(
      insert("fin_categories", {
        id: c.id,
        name: c.name,
        kind: c.kind,
        color: c.color,
        icon: c.icon,
        archived: c.archived,
        created_at: c.createdAt,
        updated_at: c.updatedAt,
      })
    );
  }
  for (const g of db.finGoals) {
    out.push(
      insert("fin_goals", {
        id: g.id,
        name: g.name,
        description: g.description,
        target_amount: g.targetAmount,
        currency: g.currency,
        start_date: g.startDate,
        deadline: g.deadline,
        icon: g.icon,
        color: g.color,
        status: g.status,
        created_at: g.createdAt,
        updated_at: g.updatedAt,
      })
    );
    for (const accountId of g.accountIds) out.push(insert("fin_goal_accounts", { goal_id: g.id, account_id: accountId }));
  }
  for (const r of db.finRecurring) {
    out.push(
      insert("fin_recurring", {
        id: r.id,
        name: r.name,
        kind: r.kind,
        amount: r.amount,
        account_id: r.accountId,
        to_account_id: r.toAccountId,
        category_id: r.categoryId,
        goal_id: r.goalId,
        frequency: r.frequency,
        start_date: r.startDate,
        end_date: r.endDate,
        status: r.status,
        note: r.note,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      })
    );
    for (const d of r.skipped) out.push(insert("fin_recurring_skips", { recurring_id: r.id, date: d }));
  }
  // Un movimiento puede referenciar una serie ya borrada: esa referencia se
  // exporta como NULL para respetar la clave foránea.
  const recurringIds = new Set(db.finRecurring.map((r) => r.id));
  for (const t of db.finTransactions) {
    out.push(
      insert("fin_transactions", {
        id: t.id,
        kind: t.kind,
        amount: t.amount,
        account_id: t.accountId,
        to_account_id: t.toAccountId,
        to_amount: t.toAmount,
        category_id: t.categoryId,
        date: t.date,
        concept: t.concept,
        description: t.description,
        goal_id: t.goalId,
        recurring_id: t.recurringId && recurringIds.has(t.recurringId) ? t.recurringId : null,
        reason: t.reason,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
      })
    );
    for (const tagId of t.tagIds) {
      const name = tagName.get(tagId);
      if (name) out.push(insert("fin_transaction_tags", { transaction_id: t.id, tag_id: tagId, tag_name: name }));
    }
  }
  const liveTags = new Set<string>();
  for (const t of db.finTags ?? []) {
    liveTags.add(t.id);
    out.push(
      insert("fin_tags", {
        id: t.id,
        name: t.name,
        owner_type: t.ownerType,
        owner_id: t.ownerId,
        color: t.color,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
      })
    );
  }
  for (const t of db.finTransactions) {
    for (const a of allocationsOf(db, t)) {
      if (!liveTags.has(a.tagId)) continue;
      out.push(insert("fin_allocations", { id: a.id, transaction_id: t.id, tag_id: a.tagId, amount: a.amount, flow: a.flow }));
    }
  }
  for (const b of db.finBudgets) {
    out.push(
      insert("fin_budgets", {
        id: b.id,
        name: b.name,
        description: b.description,
        kind: b.kind,
        amount: b.amount,
        currency: b.currency,
        period: b.period,
        start_date: b.startDate,
        end_date: b.endDate,
        status: b.status,
        alert_percent: b.alertPercent,
        created_at: b.createdAt,
        updated_at: b.updatedAt,
      })
    );
    for (const id of b.categoryIds) out.push(insert("fin_budget_categories", { budget_id: b.id, category_id: id }));
    for (const id of b.accountIds) out.push(insert("fin_budget_accounts", { budget_id: b.id, account_id: id }));
  }

  out.push("COMMIT;", "");
  return out.join("\n");
}
