-- In-app cron scheduler store (factory-encore module: cron, spec 009).
-- Added to the base app's single SQLDatabase("app") per INV-11; the file is
-- renumbered to the next free prefix when the module is composed, so it applies
-- after the base schema.
CREATE TABLE task_schedules (
    id           text PRIMARY KEY,
    title        text NOT NULL,
    endpoint     text NOT NULL,
    schedule     text NOT NULL,
    next_run_at  timestamptz NOT NULL,
    last_run_at  timestamptz,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The daemon selects due rows by next_run_at on every poll.
CREATE INDEX idx_task_schedules_next_run_at ON task_schedules (next_run_at);
