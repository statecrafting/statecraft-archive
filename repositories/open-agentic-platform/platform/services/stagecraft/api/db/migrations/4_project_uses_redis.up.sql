-- Spec 227 Stage 4 (FR-004/FR-005): record whether a project opted into the
-- Redis infrastructure resource at scaffold (the factory data-redis module was
-- in the composed set). Fixed at create time; read by the deploy trigger to
-- auto-provision a dev preview Redis (previewRedis), mirroring previewDatabase.
ALTER TABLE projects
  ADD COLUMN uses_redis boolean NOT NULL DEFAULT false;
