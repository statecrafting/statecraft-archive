// Spec 124 §7 / T074 — exercises the live-update merge helper used by the
// run-detail route. Simulates a mocked duplex stream by feeding ordered
// `factory.run.*` envelopes into `applyStageEvent` and asserting the
// reducer's per-stage progression matches what the on-screen UI consumes
// from `useLoaderData`. Mirrors the platform-side handler so the optimistic
// path and the persisted path stay in lock-step.

import { describe, expect, test } from "vitest";
import type {
  FactoryRunDetail,
  FactoryAgentRef,
} from "./factory-api.server";
import {
  applyStageEvent,
  formatDuration,
  shortContentHash,
  shouldPollRun,
  type FactoryRunStageEvent,
} from "./factory-run-helpers";

const AGENT_REF: FactoryAgentRef = {
  orgAgentId: "00000000-0000-0000-0000-000000000001",
  version: 7,
  contentHash: "deadbeef0123456789abcdef0123456789abcdef0123456789abcdef01234567",
};

function baseRun(overrides: Partial<FactoryRunDetail> = {}): FactoryRunDetail {
  return {
    id: "run-1",
    orgId: "org-1",
    projectId: null,
    triggeredBy: "user-1",
    adapterId: "adapter-1",
    processId: "process-1",
    clientRunId: "client-1",
    status: "queued",
    startedAt: "2026-05-01T10:00:00.000Z",
    completedAt: null,
    lastEventAt: "2026-05-01T10:00:00.000Z",
    error: null,
    stageProgress: [],
    sourceShas: {
      adapter: "a".repeat(64),
      process: "b".repeat(64),
      contracts: {},
      agents: [AGENT_REF],
    },
    tokenSpend: null,
    ...overrides,
  };
}

describe("shouldPollRun", () => {
  test("polls while queued or running", () => {
    expect(shouldPollRun("queued")).toBe(true);
    expect(shouldPollRun("running")).toBe(true);
  });
  test("stops polling at terminal states", () => {
    expect(shouldPollRun("ok")).toBe(false);
    expect(shouldPollRun("failed")).toBe(false);
    expect(shouldPollRun("cancelled")).toBe(false);
  });
});

describe("shortContentHash", () => {
  test("takes the first 8 chars of a hex hash", () => {
    expect(shortContentHash("deadbeef0123456789")).toBe("deadbeef");
  });
  test("strips the optional sha256 prefix", () => {
    expect(shortContentHash("sha256-cafebabecafebabe")).toBe("cafebabe");
    expect(shortContentHash("sha256:cafebabecafebabe")).toBe("cafebabe");
  });
  test("returns empty string for empty input", () => {
    expect(shortContentHash("")).toBe("");
  });
});

describe("formatDuration", () => {
  const now = new Date("2026-05-01T10:05:30.000Z");
  test("seconds for sub-minute durations", () => {
    expect(
      formatDuration("2026-05-01T10:00:00.000Z", "2026-05-01T10:00:42.000Z", now)
    ).toBe("42s");
  });
  test("minutes + seconds for sub-hour durations", () => {
    expect(
      formatDuration("2026-05-01T10:00:00.000Z", "2026-05-01T10:05:30.000Z", now)
    ).toBe("5m 30s");
  });
  test("trims trailing 0s on whole minutes", () => {
    expect(
      formatDuration("2026-05-01T10:00:00.000Z", "2026-05-01T10:05:00.000Z", now)
    ).toBe("5m");
  });
  test("hours + minutes for multi-hour durations", () => {
    expect(
      formatDuration("2026-05-01T08:00:00.000Z", "2026-05-01T10:30:00.000Z", now)
    ).toBe("2h 30m");
  });
  test("uses `now` when end is null (in-flight)", () => {
    expect(formatDuration("2026-05-01T10:05:00.000Z", null, now)).toBe("30s");
  });
  test("clamps negative durations at 0", () => {
    expect(
      formatDuration("2026-05-01T10:01:00.000Z", "2026-05-01T10:00:00.000Z", now)
    ).toBe("0s");
  });
  test("returns dash when start is unparseable", () => {
    expect(formatDuration("not-a-date", null, now)).toBe("—");
  });
});

describe("applyStageEvent — duplex stream simulation", () => {
  test("ignores events with a mismatching runId", () => {
    const run = baseRun();
    const ev: FactoryRunStageEvent = {
      kind: "stage_started",
      runId: "different-run",
      stageId: "s0",
      agentRef: AGENT_REF,
      startedAt: "2026-05-01T10:01:00.000Z",
    };
    expect(applyStageEvent(run, ev)).toBe(run);
  });

  test("stage_started flips queued → running and appends entry", () => {
    const run = baseRun();
    const next = applyStageEvent(run, {
      kind: "stage_started",
      runId: run.id,
      stageId: "s0",
      agentRef: AGENT_REF,
      startedAt: "2026-05-01T10:01:00.000Z",
    });
    expect(next.status).toBe("running");
    expect(next.stageProgress).toHaveLength(1);
    expect(next.stageProgress[0]).toMatchObject({
      stage_id: "s0",
      status: "running",
      started_at: "2026-05-01T10:01:00.000Z",
      agent_ref: AGENT_REF,
    });
    expect(next.lastEventAt).toBe("2026-05-01T10:01:00.000Z");
  });

  test("repeat stage_started for an already-running stage is a no-op", () => {
    const run = baseRun({
      status: "running",
      stageProgress: [
        {
          stage_id: "s0",
          status: "running",
          started_at: "2026-05-01T10:01:00.000Z",
          completed_at: null,
          agent_ref: AGENT_REF,
        },
      ],
    });
    const next = applyStageEvent(run, {
      kind: "stage_started",
      runId: run.id,
      stageId: "s0",
      agentRef: AGENT_REF,
      startedAt: "2026-05-01T10:01:00.000Z",
    });
    expect(next).toBe(run);
  });

  test("stage_completed updates the matching running entry", () => {
    const run = baseRun({
      status: "running",
      stageProgress: [
        {
          stage_id: "s0",
          status: "running",
          started_at: "2026-05-01T10:01:00.000Z",
          completed_at: null,
          agent_ref: AGENT_REF,
        },
      ],
    });
    const next = applyStageEvent(run, {
      kind: "stage_completed",
      runId: run.id,
      stageId: "s0",
      stageOutcome: "ok",
      completedAt: "2026-05-01T10:02:00.000Z",
    });
    expect(next.stageProgress).toHaveLength(1);
    expect(next.stageProgress[0]).toMatchObject({
      stage_id: "s0",
      status: "ok",
      completed_at: "2026-05-01T10:02:00.000Z",
    });
  });

  test("stage_completed without a prior stage_started synthesises an entry", () => {
    const run = baseRun({ status: "running" });
    const next = applyStageEvent(run, {
      kind: "stage_completed",
      runId: run.id,
      stageId: "s2",
      stageOutcome: "skipped",
      completedAt: "2026-05-01T10:03:00.000Z",
    });
    expect(next.stageProgress).toHaveLength(1);
    expect(next.stageProgress[0]).toMatchObject({
      stage_id: "s2",
      status: "skipped",
      started_at: "2026-05-01T10:03:00.000Z",
      completed_at: "2026-05-01T10:03:00.000Z",
    });
  });

  test("completed terminal sets status, completedAt, tokenSpend", () => {
    const run = baseRun({ status: "running" });
    const next = applyStageEvent(run, {
      kind: "completed",
      runId: run.id,
      tokenSpend: { input: 100, output: 200, total: 300 },
      completedAt: "2026-05-01T10:10:00.000Z",
    });
    expect(next.status).toBe("ok");
    expect(next.completedAt).toBe("2026-05-01T10:10:00.000Z");
    expect(next.tokenSpend).toEqual({ input: 100, output: 200, total: 300 });
  });

  test("failed terminal records the error verbatim", () => {
    const run = baseRun({ status: "running" });
    const next = applyStageEvent(run, {
      kind: "failed",
      runId: run.id,
      error: "stage s3 timed out after 600s",
      completedAt: "2026-05-01T10:15:00.000Z",
    });
    expect(next.status).toBe("failed");
    expect(next.error).toBe("stage s3 timed out after 600s");
  });

  test("cancelled terminal does not require an error", () => {
    const run = baseRun({ status: "running" });
    const next = applyStageEvent(run, {
      kind: "cancelled",
      runId: run.id,
      completedAt: "2026-05-01T10:08:00.000Z",
      reason: "user cancelled from desktop",
    });
    expect(next.status).toBe("cancelled");
    expect(next.completedAt).toBe("2026-05-01T10:08:00.000Z");
    expect(next.error).toBeNull();
  });

  test("end-to-end: queued → 3 stages → completed reproduces the live timeline", () => {
    let run = baseRun();

    const events: FactoryRunStageEvent[] = [
      {
        kind: "stage_started",
        runId: run.id,
        stageId: "s0",
        agentRef: AGENT_REF,
        startedAt: "2026-05-01T10:00:10.000Z",
      },
      {
        kind: "stage_completed",
        runId: run.id,
        stageId: "s0",
        stageOutcome: "ok",
        completedAt: "2026-05-01T10:01:00.000Z",
      },
      {
        kind: "stage_started",
        runId: run.id,
        stageId: "s1",
        agentRef: AGENT_REF,
        startedAt: "2026-05-01T10:01:05.000Z",
      },
      {
        kind: "stage_completed",
        runId: run.id,
        stageId: "s1",
        stageOutcome: "ok",
        completedAt: "2026-05-01T10:02:30.000Z",
      },
      {
        kind: "stage_started",
        runId: run.id,
        stageId: "s2",
        agentRef: AGENT_REF,
        startedAt: "2026-05-01T10:02:35.000Z",
      },
      {
        kind: "stage_completed",
        runId: run.id,
        stageId: "s2",
        stageOutcome: "ok",
        completedAt: "2026-05-01T10:03:50.000Z",
      },
      {
        kind: "completed",
        runId: run.id,
        tokenSpend: { input: 1500, output: 3200, total: 4700 },
        completedAt: "2026-05-01T10:03:50.000Z",
      },
    ];

    for (const ev of events) {
      run = applyStageEvent(run, ev);
    }

    expect(run.status).toBe("ok");
    expect(run.stageProgress).toHaveLength(3);
    expect(run.stageProgress.map((s) => [s.stage_id, s.status])).toEqual([
      ["s0", "ok"],
      ["s1", "ok"],
      ["s2", "ok"],
    ]);
    expect(run.tokenSpend?.total).toBe(4700);
  });
});
