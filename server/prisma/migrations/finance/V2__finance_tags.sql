-- V2__finance_tags: etiquetas financieras (finalidades) y asignaciones por movimiento.
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
