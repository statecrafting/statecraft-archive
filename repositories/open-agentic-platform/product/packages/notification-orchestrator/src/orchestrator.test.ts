import { describe, it, expect, vi, afterEach } from "vitest";
import { NotificationOrchestrator } from "./orchestrator.js";
import type { ChannelAdapter, NotificationEvent } from "./types.js";

function makeAdapter(
  channelId: string,
  opts?: { available?: boolean; fail?: string }
): ChannelAdapter & { deliveredEvents: NotificationEvent[] } {
  const deliveredEvents: NotificationEvent[] = [];
  return {
    channelId,
    deliveredEvents,
    isAvailable: () => opts?.available ?? true,
    deliver: async (event) => {
      if (opts?.fail) throw new Error(opts.fail);
      deliveredEvents.push(event);
    },
  };
}

describe("NotificationOrchestrator", () => {
  it("dispatches to a single registered adapter", async () => {
    const orch = new NotificationOrchestrator();
    const adapter = makeAdapter("toast");
    orch.registerAdapter(adapter);

    const result = await orch.notify({
      provider: "test-provider",
      sessionId: "sess-1",
      kind: "task_complete",
      severity: "info",
      dedupeKey: "key-1",
      title: "Done",
      body: "Task completed",
    });

    expect(result.status).toBe("delivered");
    expect(result.deliveredTo).toEqual(["toast"]);
    expect(result.failures).toHaveLength(0);
    expect(adapter.deliveredEvents).toHaveLength(1);
    expect(adapter.deliveredEvents[0].title).toBe("Done");
  });

  it("dispatches to multiple adapters in parallel", async () => {
    const orch = new NotificationOrchestrator();
    const a1 = makeAdapter("native");
    const a2 = makeAdapter("toast");
    const a3 = makeAdapter("web-push");
    orch.registerAdapter(a1);
    orch.registerAdapter(a2);
    orch.registerAdapter(a3);

    const result = await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "task_error",
      severity: "error",
      dedupeKey: "k",
      title: "Error",
      body: "Something broke",
    });

    expect(result.status).toBe("delivered");
    expect(result.deliveredTo).toHaveLength(3);
    expect(a1.deliveredEvents).toHaveLength(1);
    expect(a2.deliveredEvents).toHaveLength(1);
    expect(a3.deliveredEvents).toHaveLength(1);
  });

  it("skips unavailable adapters", async () => {
    const orch = new NotificationOrchestrator();
    const available = makeAdapter("toast");
    const unavailable = makeAdapter("native", { available: false });
    orch.registerAdapter(available);
    orch.registerAdapter(unavailable);

    const result = await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "system_alert",
      severity: "warning",
      dedupeKey: "k",
      title: "Alert",
      body: "System alert",
    });

    expect(result.status).toBe("delivered");
    expect(result.deliveredTo).toEqual(["toast"]);
    expect(unavailable.deliveredEvents).toHaveLength(0);
  });

  it("returns suppressed when no adapters are registered", async () => {
    const orch = new NotificationOrchestrator();

    const result = await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "progress_update",
      severity: "info",
      dedupeKey: "k",
      title: "Update",
      body: "Progress",
    });

    expect(result.status).toBe("suppressed");
    expect(result.deliveredTo).toHaveLength(0);
    expect(result.failures).toHaveLength(0);
  });

  it("returns suppressed when all adapters are unavailable", async () => {
    const orch = new NotificationOrchestrator();
    orch.registerAdapter(makeAdapter("native", { available: false }));
    orch.registerAdapter(makeAdapter("web-push", { available: false }));

    const result = await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "task_complete",
      severity: "info",
      dedupeKey: "k",
      title: "Done",
      body: "Done",
    });

    expect(result.status).toBe("suppressed");
  });

  it("captures adapter failures and reports partial status", async () => {
    const orch = new NotificationOrchestrator();
    const good = makeAdapter("toast");
    const bad = makeAdapter("native", { fail: "Permission denied" });
    orch.registerAdapter(good);
    orch.registerAdapter(bad);

    const result = await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "task_error",
      severity: "critical",
      dedupeKey: "k",
      title: "Error",
      body: "Crash",
    });

    expect(result.status).toBe("partial");
    expect(result.deliveredTo).toEqual(["toast"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].channelId).toBe("native");
    expect(result.failures[0].error).toBe("Permission denied");
  });

  it("reports suppressed when all adapters fail", async () => {
    const orch = new NotificationOrchestrator();
    orch.registerAdapter(makeAdapter("native", { fail: "err1" }));
    orch.registerAdapter(makeAdapter("toast", { fail: "err2" }));

    const result = await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "task_error",
      severity: "error",
      dedupeKey: "k",
      title: "Fail",
      body: "All fail",
    });

    expect(result.status).toBe("suppressed");
    expect(result.deliveredTo).toHaveLength(0);
    expect(result.failures).toHaveLength(2);
  });

  it("generates unique event id and timestamp", async () => {
    const orch = new NotificationOrchestrator();
    const adapter = makeAdapter("toast");
    orch.registerAdapter(adapter);

    const before = Date.now();
    await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "task_complete",
      severity: "info",
      dedupeKey: "k",
      title: "T",
      body: "B",
    });
    const after = Date.now();

    const event = adapter.deliveredEvents[0];
    expect(event.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.timestamp).toBeLessThanOrEqual(after);
  });

  it("defaults metadata to empty object when omitted", async () => {
    const orch = new NotificationOrchestrator();
    const adapter = makeAdapter("toast");
    orch.registerAdapter(adapter);

    await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "task_complete",
      severity: "info",
      dedupeKey: "k",
      title: "T",
      body: "B",
    });

    expect(adapter.deliveredEvents[0].metadata).toEqual({});
  });

  it("passes metadata through when provided", async () => {
    const orch = new NotificationOrchestrator();
    const adapter = makeAdapter("toast");
    orch.registerAdapter(adapter);

    await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "task_complete",
      severity: "info",
      dedupeKey: "k",
      title: "T",
      body: "B",
      metadata: { taskId: "t-42", extra: true },
    });

    expect(adapter.deliveredEvents[0].metadata).toEqual({
      taskId: "t-42",
      extra: true,
    });
  });

  it("replaces adapter with same channelId on re-register", async () => {
    const orch = new NotificationOrchestrator();
    const first = makeAdapter("toast");
    const second = makeAdapter("toast");
    orch.registerAdapter(first);
    orch.registerAdapter(second);

    await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "task_complete",
      severity: "info",
      dedupeKey: "k",
      title: "T",
      body: "B",
    });

    expect(first.deliveredEvents).toHaveLength(0);
    expect(second.deliveredEvents).toHaveLength(1);
  });

  it("unregisterAdapter removes adapter and returns true", async () => {
    const orch = new NotificationOrchestrator();
    orch.registerAdapter(makeAdapter("toast"));

    expect(orch.unregisterAdapter("toast")).toBe(true);
    expect(orch.getAdapterIds()).toEqual([]);
  });

  it("unregisterAdapter returns false for unknown channelId", () => {
    const orch = new NotificationOrchestrator();
    expect(orch.unregisterAdapter("nope")).toBe(false);
  });

  it("getAdapterIds returns all registered channel ids", () => {
    const orch = new NotificationOrchestrator();
    orch.registerAdapter(makeAdapter("native"));
    orch.registerAdapter(makeAdapter("toast"));
    orch.registerAdapter(makeAdapter("web-push"));

    expect(orch.getAdapterIds().sort()).toEqual([
      "native",
      "toast",
      "web-push",
    ]);
  });

  it("delivers the same event object to all adapters", async () => {
    const orch = new NotificationOrchestrator();
    const a1 = makeAdapter("native");
    const a2 = makeAdapter("toast");
    orch.registerAdapter(a1);
    orch.registerAdapter(a2);

    await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "permission_request",
      severity: "warning",
      dedupeKey: "perm-1",
      title: "Permission needed",
      body: "Approve file access",
    });

    expect(a1.deliveredEvents[0].id).toBe(a2.deliveredEvents[0].id);
    expect(a1.deliveredEvents[0].timestamp).toBe(
      a2.deliveredEvents[0].timestamp
    );
  });

  it("handles non-Error throw from adapter", async () => {
    const orch = new NotificationOrchestrator();
    const adapter: ChannelAdapter = {
      channelId: "bad",
      isAvailable: () => true,
      deliver: async () => {
        throw "string error";
      },
    };
    orch.registerAdapter(adapter);

    const result = await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "task_error",
      severity: "error",
      dedupeKey: "k",
      title: "T",
      body: "B",
    });

    expect(result.failures[0].error).toBe("string error");
  });

  // --------------- Phase 2: deduplication integration ---------------

  it("suppresses duplicate events with the same dedupeKey (FR-003)", async () => {
    vi.useFakeTimers({ now: 0 });
    const orch = new NotificationOrchestrator({
      dedup: { cleanupIntervalMs: 0 },
    });
    const adapter = makeAdapter("toast");
    orch.registerAdapter(adapter);

    const opts = {
      provider: "p",
      sessionId: "s",
      kind: "task_complete" as const,
      severity: "info" as const,
      dedupeKey: "same-key",
      title: "T",
      body: "B",
    };

    const r1 = await orch.notify(opts);
    expect(r1.status).toBe("delivered");

    vi.setSystemTime(5_000);
    const r2 = await orch.notify(opts);
    expect(r2.status).toBe("suppressed");
    expect(r2.deliveredTo).toHaveLength(0);

    // Only one delivery
    expect(adapter.deliveredEvents).toHaveLength(1);

    orch.dispose();
    vi.useRealTimers();
  });

  it("allows event after dedup window expires (SC-002)", async () => {
    vi.useFakeTimers({ now: 0 });
    const orch = new NotificationOrchestrator({
      dedup: { windowMs: 10_000, cleanupIntervalMs: 0 },
    });
    const adapter = makeAdapter("toast");
    orch.registerAdapter(adapter);

    const opts = {
      provider: "p",
      sessionId: "s",
      kind: "task_error" as const,
      severity: "error" as const,
      dedupeKey: "err-key",
      title: "Err",
      body: "Error",
    };

    await orch.notify(opts);
    vi.setSystemTime(10_000); // window expired
    const r2 = await orch.notify(opts);
    expect(r2.status).toBe("delivered");
    expect(adapter.deliveredEvents).toHaveLength(2);

    orch.dispose();
    vi.useRealTimers();
  });

  it("deduplicates per key — different keys are independent", async () => {
    const orch = new NotificationOrchestrator({
      dedup: { cleanupIntervalMs: 0 },
    });
    const adapter = makeAdapter("toast");
    orch.registerAdapter(adapter);

    const base = {
      provider: "p",
      sessionId: "s",
      kind: "progress_update" as const,
      severity: "info" as const,
      title: "T",
      body: "B",
    };

    const r1 = await orch.notify({ ...base, dedupeKey: "key-a" });
    const r2 = await orch.notify({ ...base, dedupeKey: "key-b" });
    const r3 = await orch.notify({ ...base, dedupeKey: "key-a" }); // dup

    expect(r1.status).toBe("delivered");
    expect(r2.status).toBe("delivered");
    expect(r3.status).toBe("suppressed");
    expect(adapter.deliveredEvents).toHaveLength(2);

    orch.dispose();
  });

  it("respects configurable window via OrchestratorOptions (FR-004)", async () => {
    vi.useFakeTimers({ now: 0 });
    const orch = new NotificationOrchestrator({
      dedup: { windowMs: 2_000, cleanupIntervalMs: 0 },
    });
    const adapter = makeAdapter("toast");
    orch.registerAdapter(adapter);

    const opts = {
      provider: "p",
      sessionId: "s",
      kind: "system_alert" as const,
      severity: "critical" as const,
      dedupeKey: "alert",
      title: "Alert",
      body: "A",
    };

    await orch.notify(opts);
    vi.setSystemTime(1_999);
    expect((await orch.notify(opts)).status).toBe("suppressed");
    vi.setSystemTime(4_000); // 2001ms after last seen (1999) — expired
    expect((await orch.notify(opts)).status).toBe("delivered");

    orch.dispose();
    vi.useRealTimers();
  });

  // --------------- Phase 3: preference-gated delivery (FR-005) ---------------

  it("delivers to all adapters when no preferences are set", async () => {
    const orch = new NotificationOrchestrator({
      dedup: { cleanupIntervalMs: 0 },
    });
    const native = makeAdapter("native");
    const toast = makeAdapter("toast");
    orch.registerAdapter(native);
    orch.registerAdapter(toast);

    const result = await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "task_complete",
      severity: "info",
      dedupeKey: "pref-1",
      title: "T",
      body: "B",
    });

    expect(result.status).toBe("delivered");
    expect(result.deliveredTo.sort()).toEqual(["native", "toast"]);
    orch.dispose();
  });

  it("restricts delivery to preference-allowed channels (FR-005)", async () => {
    const orch = new NotificationOrchestrator({
      dedup: { cleanupIntervalMs: 0 },
      preferences: {
        rules: [{ kind: "task_complete", channels: ["toast"] }],
        defaultChannels: ["native", "toast"],
      },
    });
    const native = makeAdapter("native");
    const toast = makeAdapter("toast");
    orch.registerAdapter(native);
    orch.registerAdapter(toast);

    const result = await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "task_complete",
      severity: "info",
      dedupeKey: "pref-2",
      title: "T",
      body: "B",
    });

    expect(result.status).toBe("delivered");
    expect(result.deliveredTo).toEqual(["toast"]);
    expect(native.deliveredEvents).toHaveLength(0);
    expect(toast.deliveredEvents).toHaveLength(1);
    orch.dispose();
  });

  it("suppresses delivery when preference rule has empty channels (SC-003)", async () => {
    const orch = new NotificationOrchestrator({
      dedup: { cleanupIntervalMs: 0 },
      preferences: {
        rules: [
          { kind: "progress_update", severity: "info", channels: [] },
        ],
        defaultChannels: ["native", "toast"],
      },
    });
    orch.registerAdapter(makeAdapter("native"));
    orch.registerAdapter(makeAdapter("toast"));

    const result = await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "progress_update",
      severity: "info",
      dedupeKey: "pref-3",
      title: "T",
      body: "B",
    });

    expect(result.status).toBe("suppressed");
    expect(result.deliveredTo).toHaveLength(0);
    orch.dispose();
  });

  it("falls back to defaultChannels when no rule matches", async () => {
    const orch = new NotificationOrchestrator({
      dedup: { cleanupIntervalMs: 0 },
      preferences: {
        rules: [{ kind: "task_error", channels: ["native"] }],
        defaultChannels: ["toast"],
      },
    });
    const native = makeAdapter("native");
    const toast = makeAdapter("toast");
    orch.registerAdapter(native);
    orch.registerAdapter(toast);

    // task_complete doesn't match the task_error rule → defaultChannels
    const result = await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "task_complete",
      severity: "info",
      dedupeKey: "pref-4",
      title: "T",
      body: "B",
    });

    expect(result.status).toBe("delivered");
    expect(result.deliveredTo).toEqual(["toast"]);
    expect(native.deliveredEvents).toHaveLength(0);
    orch.dispose();
  });

  it("setPreferences updates routing at runtime", async () => {
    const orch = new NotificationOrchestrator({
      dedup: { cleanupIntervalMs: 0 },
    });
    const native = makeAdapter("native");
    const toast = makeAdapter("toast");
    orch.registerAdapter(native);
    orch.registerAdapter(toast);

    // Initially no preferences → both get delivery
    const r1 = await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "task_complete",
      severity: "info",
      dedupeKey: "pref-5a",
      title: "T",
      body: "B",
    });
    expect(r1.deliveredTo.sort()).toEqual(["native", "toast"]);

    // Set preferences to only allow toast
    orch.setPreferences({
      rules: [{ channels: ["toast"] }],
      defaultChannels: [],
    });

    const r2 = await orch.notify({
      provider: "p",
      sessionId: "s",
      kind: "task_complete",
      severity: "info",
      dedupeKey: "pref-5b",
      title: "T",
      body: "B",
    });
    expect(r2.deliveredTo).toEqual(["toast"]);
    expect(native.deliveredEvents).toHaveLength(1); // only from r1
    orch.dispose();
  });

  it("getPreferences returns null initially, then set value", () => {
    const orch = new NotificationOrchestrator();
    expect(orch.getPreferences()).toBeNull();

    const prefs = {
      rules: [{ kind: "task_error" as const, channels: ["native"] }],
      defaultChannels: ["toast"],
    };
    orch.setPreferences(prefs);
    expect(orch.getPreferences()).toEqual(prefs);
    orch.dispose();
  });

  it("preference check runs after dedup check", async () => {
    vi.useFakeTimers({ now: 0 });
    const orch = new NotificationOrchestrator({
      dedup: { cleanupIntervalMs: 0 },
      preferences: {
        rules: [{ channels: ["toast"] }],
        defaultChannels: [],
      },
    });
    const toast = makeAdapter("toast");
    orch.registerAdapter(toast);

    const opts = {
      provider: "p",
      sessionId: "s",
      kind: "task_complete" as const,
      severity: "info" as const,
      dedupeKey: "dedup-then-pref",
      title: "T",
      body: "B",
    };

    const r1 = await orch.notify(opts);
    expect(r1.status).toBe("delivered");

    // Second call is deduplicated BEFORE preferences are checked
    vi.setSystemTime(1_000);
    const r2 = await orch.notify(opts);
    expect(r2.status).toBe("suppressed");

    orch.dispose();
    vi.useRealTimers();
  });
});
