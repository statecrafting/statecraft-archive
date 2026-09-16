import { describe, it, expect } from "vitest";
import type {
  NotificationKind,
  Severity,
  NotificationEvent,
  ChannelAdapter,
  PreferenceRule,
  NotificationPreferences,
  NotifyResult,
} from "./types.js";

describe("types", () => {
  it("NotificationEvent satisfies FR-002 required fields", () => {
    const event: NotificationEvent = {
      id: "00000000-0000-0000-0000-000000000001",
      provider: "openai",
      sessionId: "sess-1",
      kind: "task_complete",
      severity: "info",
      dedupeKey: "task-1-complete",
      title: "Task finished",
      body: "The code review task has completed.",
      timestamp: Date.now(),
      metadata: { taskId: "t-1" },
    };

    expect(event.id).toBeDefined();
    expect(event.provider).toBe("openai");
    expect(event.sessionId).toBe("sess-1");
    expect(event.kind).toBe("task_complete");
    expect(event.severity).toBe("info");
    expect(event.dedupeKey).toBe("task-1-complete");
    expect(event.title).toBe("Task finished");
    expect(event.body).toContain("completed");
    expect(event.timestamp).toBeGreaterThan(0);
    expect(event.metadata).toEqual({ taskId: "t-1" });
  });

  it("NotificationKind covers FR-008 required kinds", () => {
    const kinds: NotificationKind[] = [
      "task_complete",
      "task_error",
      "permission_request",
      "progress_update",
      "system_alert",
    ];
    expect(kinds).toHaveLength(5);
  });

  it("Severity has four levels", () => {
    const levels: Severity[] = ["info", "warning", "error", "critical"];
    expect(levels).toHaveLength(4);
  });

  it("ChannelAdapter interface is implementable", () => {
    const adapter: ChannelAdapter = {
      channelId: "test",
      deliver: async () => {},
      isAvailable: () => true,
    };
    expect(adapter.channelId).toBe("test");
    expect(adapter.isAvailable()).toBe(true);
  });

  it("PreferenceRule allows omitting kind and severity for wildcard match", () => {
    const rule: PreferenceRule = {
      channels: ["toast"],
    };
    expect(rule.kind).toBeUndefined();
    expect(rule.severity).toBeUndefined();
    expect(rule.channels).toEqual(["toast"]);
  });

  it("PreferenceRule supports specific kind+severity targeting", () => {
    const rule: PreferenceRule = {
      kind: "task_error",
      severity: "critical",
      channels: ["native", "toast"],
    };
    expect(rule.kind).toBe("task_error");
    expect(rule.severity).toBe("critical");
    expect(rule.channels).toHaveLength(2);
  });

  it("PreferenceRule with empty channels suppresses delivery", () => {
    const rule: PreferenceRule = {
      kind: "progress_update",
      severity: "info",
      channels: [],
    };
    expect(rule.channels).toHaveLength(0);
  });

  it("NotificationPreferences has rules and defaultChannels", () => {
    const prefs: NotificationPreferences = {
      rules: [
        { kind: "task_error", channels: ["native", "toast"] },
        { severity: "info", channels: ["toast"] },
      ],
      defaultChannels: ["toast"],
    };
    expect(prefs.rules).toHaveLength(2);
    expect(prefs.defaultChannels).toEqual(["toast"]);
  });

  it("NotifyResult captures delivered status", () => {
    const result: NotifyResult = {
      eventId: "evt-1",
      status: "delivered",
      deliveredTo: ["native", "toast"],
      failures: [],
    };
    expect(result.status).toBe("delivered");
    expect(result.deliveredTo).toHaveLength(2);
    expect(result.failures).toHaveLength(0);
  });

  it("NotifyResult captures partial delivery with failures", () => {
    const result: NotifyResult = {
      eventId: "evt-2",
      status: "partial",
      deliveredTo: ["toast"],
      failures: [{ channelId: "native", error: "Permission denied" }],
    };
    expect(result.status).toBe("partial");
    expect(result.deliveredTo).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].error).toBe("Permission denied");
  });
});
