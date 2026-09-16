-- Encore's tagged-template binding (spec 002 INV-2) cannot serialize a JS string
-- to, nor parse a row value from, the citext extension type. The original
-- user_account.email CITEXT column therefore broke every user_account read and
-- write (the login upsert and getUserById). Move email to plain text and keep
-- case-insensitive uniqueness with a unique index on lower(email). The
-- integration tests in auth/refresh.itest.ts (and the login flow) guard this.
ALTER TABLE user_account DROP CONSTRAINT IF EXISTS user_account_email_key;
ALTER TABLE user_account ALTER COLUMN email TYPE text USING email::text;
CREATE UNIQUE INDEX IF NOT EXISTS user_account_email_lower_key ON user_account (lower(email));
