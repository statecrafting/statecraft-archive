-- One row per authenticated principal across all SSO drivers (INV-1, INV-9).
-- user_roles is a multi-role set with any-of membership, never a hierarchy (INV-1).
CREATE TABLE user_account (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           CITEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL DEFAULT '',
  user_roles      TEXT[] NOT NULL DEFAULT ARRAY['user']::TEXT[],
  sso_provider    TEXT NOT NULL,
  sso_provider_id TEXT,
  attributes      JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_account_sso ON user_account (sso_provider, sso_provider_id);
