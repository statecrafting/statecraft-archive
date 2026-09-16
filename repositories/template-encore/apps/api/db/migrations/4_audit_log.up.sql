-- Durable, queryable audit trail (INV-8). Writes are best-effort and never block
-- the user flow. Captures table/record/action, old/new state, actor, and origin.
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  action      TEXT NOT NULL,
  table_name  TEXT,
  record_id   TEXT,
  old_data    JSONB,
  new_data    JSONB,
  actor_id    TEXT,
  actor_email TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_action ON audit_log (action, created_at DESC);
CREATE INDEX idx_audit_log_actor ON audit_log (actor_id, created_at DESC);
