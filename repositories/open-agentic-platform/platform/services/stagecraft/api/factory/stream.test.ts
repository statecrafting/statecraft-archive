import { beforeEach, describe, expect, test, vi } from "vitest";

// The vite alias in vite.config.ts replaces `encore.dev/api`,
// `encore.dev/log`, and `encore.dev/pubsub` with in-repo mocks so importing
// `stream.ts` does not load the Encore native runtime. The db driver is
// not needed for these unit tests — they touch only the formatting helper
// and the project subscriber registry.
vi.mock("../db/drizzle", () => ({ db: {} }));
vi.mock("../db/schema", () => ({
  projects: {},
  factoryPipelines: {},
  factoryStages: {},
}));

import {
  __testing,
  formatSseFrame,
  relayFactoryEventToSubscribers,
  subscriberCountForProject,
} from "./stream";

describe("formatSseFrame", () => {
  test("serializes JSON payloads on a single data line", () => {
    const out = formatSseFrame({ event: "snapshot", data: { foo: 1 } });
    expect(out).toBe("event: snapshot\ndata: {\"foo\":1}\n\n");
  });

  test("splits multi-line string payloads across data lines", () => {
    const out = formatSseFrame({ event: "log", data: "a\nb" });
    expect(out).toBe("event: log\ndata: a\ndata: b\n\n");
  });

  test("includes the id line when provided", () => {
    const out = formatSseFrame({ event: "x", data: {}, id: "42" });
    expect(out).toContain("id: 42");
  });
});

describe("project subscriber registry", () => {
  beforeEach(() => {
    __testing.subscribers.clear();
  });

  test("register / unregister is symmetric and idempotent", () => {
    const sub = { write: () => true };

    __testing.registerSubscriber("p-1", sub);
    expect(subscriberCountForProject("p-1")).toBe(1);

    __testing.unregisterSubscriber("p-1", sub);
    expect(subscriberCountForProject("p-1")).toBe(0);

    // Unregistering twice is a no-op.
    __testing.unregisterSubscriber("p-1", sub);
    expect(subscriberCountForProject("p-1")).toBe(0);
  });

  test("broadcast hits only subscribers of the target project", () => {
    const p1Frames: unknown[] = [];
    const p2Frames: unknown[] = [];

    __testing.registerSubscriber("p-1", {
      write: (f) => { p1Frames.push(f); return true; },
    });
    __testing.registerSubscriber("p-2", {
      write: (f) => { p2Frames.push(f); return true; },
    });

    __testing.broadcastToProject("p-1", { event: "x", data: { ok: true } });

    expect(p1Frames).toHaveLength(1);
    expect(p2Frames).toHaveLength(0);
  });

  test("a write returning false evicts the subscriber", () => {
    const sub = { write: () => false };
    __testing.registerSubscriber("p-9", sub);
    __testing.broadcastToProject("p-9", { event: "x", data: {} });
    expect(subscriberCountForProject("p-9")).toBe(0);
  });
});

describe("relayFactoryEventToSubscribers", () => {
  beforeEach(() => {
    __testing.subscribers.clear();
  });

  test("forwards a pipeline_event frame to the matching project subscriber", () => {
    const frames: Array<{ event: string; data: unknown }> = [];
    __testing.registerSubscriber("p-1", {
      write: (f) => { frames.push(f); return true; },
    });

    relayFactoryEventToSubscribers({
      project_id: "p-1",
      pipeline_id: "pl-1",
      event_type: "stage_confirmed",
      stage_id: "s0-preflight",
      actor: "u-1",
      details: { notes: "ok" },
    });

    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("pipeline_event");
    const data = frames[0].data as Record<string, unknown>;
    expect(data.pipeline_id).toBe("pl-1");
    expect(data.event_type).toBe("stage_confirmed");
    expect(data.stage_id).toBe("s0-preflight");
  });

  test("emits a closed frame after a terminal event", () => {
    const frames: Array<{ event: string; data: unknown }> = [];
    __testing.registerSubscriber("p-1", {
      write: (f) => { frames.push(f); return true; },
    });

    relayFactoryEventToSubscribers({
      project_id: "p-1",
      pipeline_id: "pl-1",
      event_type: "pipeline_completed",
      actor: "u-1",
    });

    expect(frames.map((f) => f.event)).toEqual([
      "pipeline_event",
      "closed",
    ]);
    expect((frames[1].data as Record<string, unknown>).reason)
      .toBe("pipeline_completed");
  });

  test("ignores events for projects with no subscribers", () => {
    // Just ensures no throw on empty registry.
    relayFactoryEventToSubscribers({
      project_id: "p-none",
      pipeline_id: "pl-x",
      event_type: "pipeline_initialized",
    });
    expect(subscriberCountForProject("p-none")).toBe(0);
  });
});
