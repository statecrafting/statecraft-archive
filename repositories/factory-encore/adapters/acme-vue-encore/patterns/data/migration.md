# Pattern: migration

One Build Spec entity becomes one Encore migration. Migrations are plain SQL at
`apps/api/db/migrations/{n}_{name}.up.sql`, applied in numeric order.

## Conventions

- snake_case table and column names; table name is the singular entity
  (`registration`), columns are the entity fields in snake_case.
- Primary key `id uuid primary key default gen_random_uuid()`.
- Reference fields become foreign keys with the declared on-delete behavior.
- Enum fields become a `text` column with a `CHECK` constraint. Do not use native
  Postgres `ENUM` types.
- `created_at timestamptz not null default now()`.
- Index every foreign key.

## Example

`apps/api/db/migrations/4_registration.up.sql`:

```sql
CREATE TABLE registration (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES event(id) ON DELETE RESTRICT,
  attendee_id  uuid NOT NULL REFERENCES attendee(id) ON DELETE RESTRICT,
  status       text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','submitted','confirmed','waitlisted','cancelled')),
  submitted_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, attendee_id)
);

CREATE INDEX idx_registration_event_id ON registration (event_id);
CREATE INDEX idx_registration_attendee_id ON registration (attendee_id);
```
