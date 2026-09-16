-- User-management: app-managed role catalog + per-user assignments (spec 003).
--
-- Distinct from the IdP-sourced user_account.user_roles[] (owned by the auth
-- service, read into the JWT). app_role is the application's OWN role registry
-- that an admin can CRUD and assign; user_role joins it to the existing
-- user_account identity (apps/api/db/migrations/2_user_account.up.sql).
--
-- This migration is renumbered onto the next free prefix when the module is
-- composed, so it lands after the four base migrations and the user_account
-- foreign-key target already exists.

CREATE TABLE IF NOT EXISTS app_role (
  pk_app_role  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  role_name    TEXT NOT NULL,
  description  TEXT,
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Role names are unique, case-insensitively (admin == Admin).
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_role_name ON app_role (lower(role_name));

CREATE TABLE IF NOT EXISTS user_role (
  fk_user_account UUID NOT NULL REFERENCES user_account (id) ON DELETE CASCADE,
  fk_app_role     TEXT NOT NULL REFERENCES app_role (pk_app_role) ON DELETE CASCADE,
  assigned_by     TEXT,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (fk_user_account, fk_app_role)
);

CREATE INDEX IF NOT EXISTS idx_user_role_user ON user_role (fk_user_account);

-- Seed the template default roles (idempotent — safe to re-run).
INSERT INTO app_role (role_name, description, is_system)
VALUES
  ('user',         'Baseline authenticated access',          TRUE),
  ('admin',        'Administrative functions',               TRUE),
  ('user-manager', 'Manage users and role assignments',      TRUE)
ON CONFLICT DO NOTHING;
