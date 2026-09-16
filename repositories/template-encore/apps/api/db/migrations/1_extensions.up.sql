-- Persistence foundation: Postgres extensions used by the schema (spec 002).
-- pgcrypto provides gen_random_uuid(); citext gives case-insensitive email keys.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
