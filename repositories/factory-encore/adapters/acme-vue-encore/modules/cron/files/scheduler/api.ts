import { api } from "encore.dev/api";
import { upsertSchedule, listAll } from "./store";

export interface RegisterCronParams {
  id: string;
  title: string;
  endpoint: string;
  schedule: string;
}

// Internal (expose: false): reachable via ~encore/clients from the app's own
// registration bootstrap (FR-007). No unauthenticated public surface, and no
// dependency on the auth module.
export const registerCron = api(
  { expose: false, method: "POST", path: "/scheduler/register" },
  async (params: RegisterCronParams): Promise<void> => {
    await upsertSchedule(params);
  }
);

export interface ScheduleInfo {
  id: string;
  title: string;
  endpoint: string;
  schedule: string;
  next_run_at: string;
  last_run_at: string | null;
}

export interface ListSchedulesResponse {
  schedules: ScheduleInfo[];
}

export const listSchedules = api(
  { expose: false, method: "GET", path: "/scheduler/list" },
  async (): Promise<ListSchedulesResponse> => {
    const rows = await listAll();
    return {
      schedules: rows.map((r) => ({
        id: r.id,
        title: r.title,
        endpoint: r.endpoint,
        schedule: r.schedule,
        next_run_at: r.next_run_at.toISOString(),
        last_run_at: r.last_run_at ? r.last_run_at.toISOString() : null,
      })),
    };
  }
);
