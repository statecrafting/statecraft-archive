# Pattern: query

Data access goes through a typed model module per entity. Use Encore
tagged-template queries only. Never use `db.rawQuery`/`db.rawExec`, and never
build SQL by string concatenation: tagged templates parameterize values safely.

## Conventions

- One `db` instance per backend: `const db = new SQLDatabase("app", { migrations: "./migrations" })`.
- `db.queryRow` for a single row, `db.query` for a stream/many, `db.exec` for
  writes. Each takes a tagged template; interpolated values become bind
  parameters.
- Model functions return the typed row interface from `types.ts`.

## Example

`apps/api/registration/model.ts`:

```ts
import { SQLDatabase } from "encore.dev/storage/sqldb";
import type { Registration } from "./types";

export const db = new SQLDatabase("app", { migrations: "./migrations" });

export async function findById(id: string): Promise<Registration | null> {
  return await db.queryRow<Registration>`
    SELECT * FROM registration WHERE id = ${id}
  `;
}

export async function listByAttendee(attendeeId: string): Promise<Registration[]> {
  const rows: Registration[] = [];
  for await (const r of db.query<Registration>`
    SELECT * FROM registration WHERE attendee_id = ${attendeeId} ORDER BY created_at DESC
  `) rows.push(r);
  return rows;
}

export async function setStatus(id: string, status: string): Promise<void> {
  await db.exec`UPDATE registration SET status = ${status} WHERE id = ${id}`;
}
```
