-- Rate-limit counters (spec 002 INV-6): Postgres-backed fixed-window limiter.
--
-- UNLOGGED on purpose: rate-limit state is ephemeral and loss-tolerant (the
-- limiter fails open on any backend error), so skipping the write-ahead log
-- trades durability we do not need for write speed. One row per bucket
-- (tier plus client key); the row's count resets when its window expires, so
-- the table size is bounded by the number of distinct active clients rather
-- than growing per request.
CREATE UNLOGGED TABLE rate_limit_counter (
  bucket       TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);

-- Supports the optional periodic prune of silent buckets:
--   DELETE FROM rate_limit_counter WHERE expires_at < now();
CREATE INDEX rate_limit_counter_expires_at_idx ON rate_limit_counter (expires_at);
