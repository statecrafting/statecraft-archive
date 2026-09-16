import { SQLDatabase } from "encore.dev/storage/sqldb";
import { CronExpressionParser } from "cron-parser";

// The scheduler extends the base app's single database (INV-11): no per-service
// SQLDatabase. task_schedules is added via this module's db/ migration and read
// here through SQLDatabase.named("app").
export const db = SQLDatabase.named("app");

export interface TaskSchedule {
  id: string;
  title: string;
  endpoint: string;
  schedule: string;
  next_run_at: Date;
  last_run_at: Date | null;
}

// The next fire time for a cron expression, computed from now.
export function nextRun(schedule: string): Date {
  return CronExpressionParser.parse(schedule).next().toDate();
}

export interface RegisterInput {
  id: string;
  title: string;
  endpoint: string;
  schedule: string;
}

export async function upsertSchedule(input: RegisterInput): Promise<void> {
  const next = nextRun(input.schedule);
  await db.exec`
    INSERT INTO task_schedules (id, title, endpoint, schedule, next_run_at)
    VALUES (${input.id}, ${input.title}, ${input.endpoint}, ${input.schedule}, ${next})
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      endpoint = EXCLUDED.endpoint,
      schedule = EXCLUDED.schedule,
      next_run_at = EXCLUDED.next_run_at,
      updated_at = now()
  `;
}

// Rows whose next fire time has arrived. The daemon iterates these each tick.
export async function* dueSchedules(): AsyncGenerator<{
  id: string;
  endpoint: string;
  schedule: string;
}> {
  const rows = db.query<{ id: string; endpoint: string; schedule: string }>`
    SELECT id, endpoint, schedule FROM task_schedules WHERE next_run_at <= now()
  `;
  for await (const row of rows) yield row;
}

// The Postgres atomic claim (small-scale lock): exactly one replica wins the row
// for this fire window and stamps last_run_at. Returns true if this caller
// acquired the job.
export async function claimByPostgres(id: string): Promise<boolean> {
  const row = await db.queryRow<{ acquired: boolean }>`
    UPDATE task_schedules SET last_run_at = now()
    WHERE id = ${id} AND next_run_at <= now()
    RETURNING true AS acquired
  `;
  return row?.acquired === true;
}

// Advance the row to its next fire time after firing.
export async function advance(id: string, schedule: string): Promise<void> {
  const next = nextRun(schedule);
  await db.exec`
    UPDATE task_schedules SET next_run_at = ${next}, updated_at = now() WHERE id = ${id}
  `;
}

export async function listAll(): Promise<TaskSchedule[]> {
  const out: TaskSchedule[] = [];
  const rows = db.query<TaskSchedule>`
    SELECT id, title, endpoint, schedule, next_run_at, last_run_at
    FROM task_schedules ORDER BY id
  `;
  for await (const row of rows) out.push(row);
  return out;
}
