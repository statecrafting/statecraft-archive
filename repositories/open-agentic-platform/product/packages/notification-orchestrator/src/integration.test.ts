import { describe, it, expect, vi } from "vitest";
import { NotificationOrchestrator } from "./orchestrator.js";
import type { ChannelAdapter, NotificationEvent } from "./types.js";
import {
  createNotifyOptions,
  connectLifecycleBus,
  DEFAULT_LIFECYCLE_MAPPINGS,
  type AgentLifecycleEvent,
  type ConnectOptions,
  type LifecycleEventSource,
  type LifecycleMapping,
} from "./integration.js";

function makeAdapter(
  channelId: string,
): ChannelAdapter & { deliveredEvents: NotificationEvent[] } {
  const deliveredEvents: NotificationEvent[] = [];
  return {
    channelId,
    deliveredEvents,
    isAvailable: () => true,
    deliver: async (event) => {
      deliveredEvents.push(event);
    },
  };
}

function makeEventSource(): LifecycleEventSource & {
  fire: (event: AgentLifecycleEvent) => void;
} {
  const listeners: Array<(event: AgentLifecycleEvent) => void> = [];
  return {
    onAny(listener) {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    fire(event) {
      for (const listener of listeners) listener(event);
    },
  };
}

const BASE_OPTS: ConnectOptions = {
  provider: "test-provider",
  sessionId: "sess-1",
};

// ─── createNotifyOptions ────────────────────────────────────────────

describe("createNotifyOptions", () => {
  it("maps completed event to task_complete / info", () => {
    const event: AgentLifecycleEvent = {
      agentId: "agent-1",
      status: "completed",
      timestamp: 1000,
      exitCode: 0,
      signal: null,
    };
    const opts = createNotifyOptions(event, BASE_OPTS);
    expect(opts).not.toBeNull();
    expect(opts!.kind).toBe("task_complete");
    expect(opts!.severity).toBe("info");
    expect(opts!.provider).toBe("test-provider");
    expect(opts!.sessionId).toBe("sess-1");
    expect(opts!.title).toContain("agent-1");
    expect(opts!.body).toContain("successfully");
    expect(opts!.dedupeKey).toBe("lifecycle:agent-1:completed");
  });

  it("maps completed with non-zero exit code", () => {
    const event: AgentLifecycleEvent = {
      agentId: "a1",
      status: "completed",
      timestamp: 1000,
      exitCode: 1,
      signal: null,
    };
    const opts = createNotifyOptions(event, BASE_OPTS)!;
    expect(opts.body).toContain("code 1");
  });

  it("maps failed event to task_error / error", () => {
    const event: AgentLifecycleEvent = {
      agentId: "a1",
      status: "failed",
      timestamp: 1000,
      exitCode: 137,
      signal: "SIGKILL",
      detail: "OOM killed",
    };
    const opts = createNotifyOptions(event, BASE_OPTS)!;
    expect(opts.kind).toBe("task_error");
    expect(opts.severity).toBe("error");
    expect(opts.body).toContain("137");
    expect(opts.body).toContain("SIGKILL");
    expect(opts.body).toContain("OOM killed");
    expect(opts.metadata).toEqual(
      expect.objectContaining({
        agentId: "a1",
        exitCode: 137,
        signal: "SIGKILL",
        detail: "OOM killed",
      }),
    );
  });

  it("maps failed event with no detail fields", () => {
    const event: AgentLifecycleEvent = {
      agentId: "a1",
      status: "failed",
      timestamp: 1000,
    };
    const opts = createNotifyOptions(event, BASE_OPTS)!;
    expect(opts.body).toBe("Agent failed unexpectedly.");
  });

  it("maps timed_out event to task_error / warning", () => {
    const event: AgentLifecycleEvent = {
      agentId: "a1",
      status: "timed_out",
      timestamp: 1000,
      timeoutMs: 60_000,
    };
    const opts = createNotifyOptions(event, BASE_OPTS)!;
    expect(opts.kind).toBe("task_error");
    expect(opts.severity).toBe("warning");
    expect(opts.body).toContain("60000ms");
    expect(opts.metadata).toEqual(
      expect.objectContaining({ timeoutMs: 60_000 }),
    );
  });

  it("maps timed_out event without timeoutMs", () => {
    const event: AgentLifecycleEvent = {
      agentId: "a1",
      status: "timed_out",
      timestamp: 1000,
    };
    const opts = createNotifyOptions(event, BASE_OPTS)!;
    expect(opts.body).toBe("Agent exceeded timeout.");
  });

  it("maps spawned event to system_alert / info", () => {
    const event: AgentLifecycleEvent = {
      agentId: "a1",
      status: "spawned",
      timestamp: 1000,
      branchName: "feat/new",
    };
    const opts = createNotifyOptions(event, BASE_OPTS)!;
    expect(opts.kind).toBe("system_alert");
    expect(opts.severity).toBe("info");
    expect(opts.body).toContain("feat/new");
    expect(opts.metadata).toEqual(
      expect.objectContaining({ branchName: "feat/new" }),
    );
  });

  it("maps spawned event without branchName", () => {
    const event: AgentLifecycleEvent = {
      agentId: "a1",
      status: "spawned",
      timestamp: 1000,
    };
    const opts = createNotifyOptions(event, BASE_OPTS)!;
    expect(opts.body).toBe("Agent started.");
  });

  it("returns null for running status (no default mapping)", () => {
    const event: AgentLifecycleEvent = {
      agentId: "a1",
      status: "running",
      timestamp: 1000,
    };
    expect(createNotifyOptions(event, BASE_OPTS)).toBeNull();
  });

  it("returns null for tool_use status (no default mapping)", () => {
    const event: AgentLifecycleEvent = {
      agentId: "a1",
      status: "tool_use",
      timestamp: 1000,
    };
    expect(createNotifyOptions(event, BASE_OPTS)).toBeNull();
  });

  it("allows custom mapping override for tool_use", () => {
    const event: AgentLifecycleEvent = {
      agentId: "a1",
      status: "tool_use",
      timestamp: 1000,
      detail: "Read file.ts",
    };
    const customMapping: LifecycleMapping = {
      kind: "progress_update",
      severity: "info",
      title: (e) => `Tool use: ${e.detail}`,
      body: () => "Tool invocation in progress.",
    };
    const opts = createNotifyOptions(event, {
      ...BASE_OPTS,
      mappings: { tool_use: customMapping },
    })!;
    expect(opts.kind).toBe("progress_update");
    expect(opts.title).toBe("Tool use: Read file.ts");
  });

  it("allows explicit null mapping to suppress a default-mapped status", () => {
    const event: AgentLifecycleEvent = {
      agentId: "a1",
      status: "completed",
      timestamp: 1000,
    };
    const opts = createNotifyOptions(event, {
      ...BASE_OPTS,
      mappings: { completed: null },
    });
    expect(opts).toBeNull();
  });

  it("custom mapping overrides default for same status", () => {
    const event: AgentLifecycleEvent = {
      agentId: "a1",
      status: "failed",
      timestamp: 1000,
      exitCode: 1,
    };
    const custom: LifecycleMapping = {
      kind: "system_alert",
      severity: "critical",
      title: () => "CRITICAL FAILURE",
      body: () => "Escalated.",
    };
    const opts = createNotifyOptions(event, {
      ...BASE_OPTS,
      mappings: { failed: custom },
    })!;
    expect(opts.kind).toBe("system_alert");
    expect(opts.severity).toBe("critical");
    expect(opts.title).toBe("CRITICAL FAILURE");
  });

  it("includes only relevant metadata fields", () => {
    const event: AgentLifecycleEvent = {
      agentId: "a1",
      status: "completed",
      timestamp: 1000,
      exitCode: 0,
    };
    const opts = createNotifyOptions(event, BASE_OPTS)!;
    expect(opts.metadata).toEqual({
      agentId: "a1",
      lifecycleStatus: "completed",
      exitCode: 0,
    });
    // signal, timeoutMs, branchName, detail should be absent
    expect(opts.metadata).not.toHaveProperty("signal");
    expect(opts.metadata).not.toHaveProperty("timeoutMs");
  });
});

// ─── DEFAULT_LIFECYCLE_MAPPINGS ─────────────────────────────────────

describe("DEFAULT_LIFECYCLE_MAPPINGS", () => {
  it("includes mappings for completed, failed, timed_out, spawned", () => {
    expect(DEFAULT_LIFECYCLE_MAPPINGS.completed).toBeDefined();
    expect(DEFAULT_LIFECYCLE_MAPPINGS.failed).toBeDefined();
    expect(DEFAULT_LIFECYCLE_MAPPINGS.timed_out).toBeDefined();
    expect(DEFAULT_LIFECYCLE_MAPPINGS.spawned).toBeDefined();
  });

  it("does not include running or tool_use", () => {
    expect(DEFAULT_LIFECYCLE_MAPPINGS.running).toBeUndefined();
    expect(DEFAULT_LIFECYCLE_MAPPINGS.tool_use).toBeUndefined();
  });
});

// ─── connectLifecycleBus ────────────────────────────────────────────

describe("connectLifecycleBus", () => {
  it("dispatches notification on completed lifecycle event", async () => {
    const orchestrator = new NotificationOrchestrator();
    const adapter = makeAdapter("toast");
    orchestrator.registerAdapter(adapter);
    const source = makeEventSource();

    connectLifecycleBus(orchestrator, source, BASE_OPTS);

    source.fire({
      agentId: "a1",
      status: "completed",
      timestamp: Date.now(),
      exitCode: 0,
      signal: null,
    });

    // Allow the fire-and-forget promise to resolve
    await vi.waitFor(() => expect(adapter.deliveredEvents).toHaveLength(1));

    expect(adapter.deliveredEvents[0].kind).toBe("task_complete");
    expect(adapter.deliveredEvents[0].severity).toBe("info");
  });

  it("dispatches notification on failed lifecycle event", async () => {
    const orchestrator = new NotificationOrchestrator();
    const adapter = makeAdapter("native");
    orchestrator.registerAdapter(adapter);
    const source = makeEventSource();

    connectLifecycleBus(orchestrator, source, BASE_OPTS);

    source.fire({
      agentId: "a1",
      status: "failed",
      timestamp: Date.now(),
      exitCode: 1,
    });

    await vi.waitFor(() => expect(adapter.deliveredEvents).toHaveLength(1));
    expect(adapter.deliveredEvents[0].kind).toBe("task_error");
  });

  it("does not dispatch for unmapped statuses (running, tool_use)", async () => {
    const orchestrator = new NotificationOrchestrator();
    const adapter = makeAdapter("toast");
    orchestrator.registerAdapter(adapter);
    const source = makeEventSource();

    connectLifecycleBus(orchestrator, source, BASE_OPTS);

    source.fire({ agentId: "a1", status: "running", timestamp: Date.now() });
    source.fire({ agentId: "a1", status: "tool_use", timestamp: Date.now() });

    // Give any promises a tick to resolve
    await new Promise((r) => setTimeout(r, 10));
    expect(adapter.deliveredEvents).toHaveLength(0);
  });

  it("disconnect stops further dispatching", async () => {
    const orchestrator = new NotificationOrchestrator();
    const adapter = makeAdapter("toast");
    orchestrator.registerAdapter(adapter);
    const source = makeEventSource();

    const handle = connectLifecycleBus(orchestrator, source, BASE_OPTS);

    source.fire({
      agentId: "a1",
      status: "completed",
      timestamp: Date.now(),
      exitCode: 0,
    });
    await vi.waitFor(() => expect(adapter.deliveredEvents).toHaveLength(1));

    handle.disconnect();

    source.fire({
      agentId: "a2",
      status: "completed",
      timestamp: Date.now(),
      exitCode: 0,
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(adapter.deliveredEvents).toHaveLength(1);
  });

  it("logs events to event log via orchestrator", async () => {
    const orchestrator = new NotificationOrchestrator();
    const adapter = makeAdapter("toast");
    orchestrator.registerAdapter(adapter);
    const source = makeEventSource();

    connectLifecycleBus(orchestrator, source, BASE_OPTS);

    source.fire({
      agentId: "a1",
      status: "spawned",
      timestamp: Date.now(),
      branchName: "feat/test",
    });

    await vi.waitFor(() => expect(orchestrator.logSize).toBe(1));

    const logs = orchestrator.queryLog();
    expect(logs[0].event.kind).toBe("system_alert");
    expect(logs[0].status).toBe("delivered");
  });

  it("respects deduplication for rapid identical lifecycle events", async () => {
    const orchestrator = new NotificationOrchestrator();
    const adapter = makeAdapter("toast");
    orchestrator.registerAdapter(adapter);
    const source = makeEventSource();

    connectLifecycleBus(orchestrator, source, BASE_OPTS);

    const now = Date.now();
    // Same agentId + status produces same dedupeKey
    source.fire({ agentId: "a1", status: "completed", timestamp: now, exitCode: 0 });
    source.fire({ agentId: "a1", status: "completed", timestamp: now + 100, exitCode: 0 });

    await vi.waitFor(() => expect(orchestrator.logSize).toBe(2));

    // First delivered, second suppressed by dedup
    const logs = orchestrator.queryLog();
    const statuses = logs.map((l) => l.status);
    expect(statuses).toContain("delivered");
    expect(statuses).toContain("suppressed");
    expect(adapter.deliveredEvents).toHaveLength(1);
  });

  it("respects user preferences for channel filtering", async () => {
    const orchestrator = new NotificationOrchestrator({
      preferences: {
        rules: [{ kind: "system_alert", severity: "info", channels: [] }],
        defaultChannels: ["toast"],
      },
    });
    const adapter = makeAdapter("toast");
    orchestrator.registerAdapter(adapter);
    const source = makeEventSource();

    connectLifecycleBus(orchestrator, source, BASE_OPTS);

    source.fire({
      agentId: "a1",
      status: "spawned",
      timestamp: Date.now(),
      branchName: "feat/x",
    });

    await vi.waitFor(() => expect(orchestrator.logSize).toBe(1));

    // Suppressed by preference rule (info system_alert → empty channels)
    const logs = orchestrator.queryLog();
    expect(logs[0].status).toBe("suppressed");
    expect(adapter.deliveredEvents).toHaveLength(0);
  });

  it("dispatches multiple event types in sequence", async () => {
    const orchestrator = new NotificationOrchestrator();
    const adapter = makeAdapter("toast");
    orchestrator.registerAdapter(adapter);
    const source = makeEventSource();

    connectLifecycleBus(orchestrator, source, BASE_OPTS);

    const now = Date.now();
    source.fire({ agentId: "a1", status: "spawned", timestamp: now, branchName: "b" });
    source.fire({ agentId: "a1", status: "completed", timestamp: now + 1, exitCode: 0 });
    source.fire({ agentId: "a2", status: "failed", timestamp: now + 2, exitCode: 1 });

    await vi.waitFor(() => expect(adapter.deliveredEvents).toHaveLength(3));

    const kinds = adapter.deliveredEvents.map((e) => e.kind);
    expect(kinds).toEqual(["system_alert", "task_complete", "task_error"]);
  });
});
