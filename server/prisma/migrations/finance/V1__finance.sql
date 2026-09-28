-- V1__finance: módulo de finanzas (estructura). Importes en céntimos (INTEGER).
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
