-- Hash-only refresh-token store with rotation and server-side revocation (INV-7).
-- The raw refresh token is never persisted: only its SHA-256 hash is stored.
CREATE TABLE refresh_token (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  replaced_by UUID REFERENCES refresh_token(id) ON DELETE SET NULL,
  user_agent  TEXT,
  ip_address  TEXT
);

CREATE INDEX idx_refresh_token_user ON refresh_token (user_id);
CREATE INDEX idx_refresh_token_active ON refresh_token (user_id) WHERE revoked_at IS NULL;
