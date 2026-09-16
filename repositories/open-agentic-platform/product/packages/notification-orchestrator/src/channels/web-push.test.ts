import { describe, it, expect, vi } from "vitest";
import { WebPushAdapter } from "./web-push.js";
import type { PushRegistration } from "./web-push.js";
import type { NotificationEvent } from "../types.js";

function makeEvent(overrides?: Partial<NotificationEvent>): NotificationEvent {
  return {
    id: "evt-1",
    provider: "test-provider",
    sessionId: "sess-1",
    kind: "task_complete",
    severity: "info",
    dedupeKey: "key-1",
    title: "Task Done",
    body: "Your task completed successfully",
    timestamp: Date.now(),
    metadata: { extra: true },
    ...overrides,
  };
}

function makeFakeRegistration(): PushRegistration & {
  calls: Array<{ title: string; options?: NotificationOptions }>;
} {
  const calls: Array<{ title: string; options?: NotificationOptions }> = [];
  return {
    calls,
    showNotification: async (title, options) => {
      calls.push({ title, options });
    },
  };
}

describe("WebPushAdapter", () => {
  it("has channelId 'web-push'", () => {
    const adapter = new WebPushAdapter();
    expect(adapter.channelId).toBe("web-push");
  });

  it("isAvailable returns false when no registration is provided", () => {
    const adapter = new WebPushAdapter();
    expect(adapter.isAvailable()).toBe(false);
  });

  it("isAvailable returns false when registration is explicitly null", () => {
    const adapter = new WebPushAdapter({ registration: null });
    expect(adapter.isAvailable()).toBe(false);
  });

  it("isAvailable returns true when registration is provided", () => {
    const reg = makeFakeRegistration();
    const adapter = new WebPushAdapter({ registration: reg });
    expect(adapter.isAvailable()).toBe(true);
  });

  it("setRegistration toggles availability", () => {
    const adapter = new WebPushAdapter();
    expect(adapter.isAvailable()).toBe(false);

    adapter.setRegistration(makeFakeRegistration());
    expect(adapter.isAvailable()).toBe(true);

    adapter.setRegistration(null);
    expect(adapter.isAvailable()).toBe(false);
  });

  it("deliver calls showNotification with correct title and body", async () => {
    const reg = makeFakeRegistration();
    const adapter = new WebPushAdapter({ registration: reg });
    const event = makeEvent();

    await adapter.deliver(event);

    expect(reg.calls).toHaveLength(1);
    expect(reg.calls[0].title).toBe("Task Done");
    expect(reg.calls[0].options?.body).toBe(
      "Your task completed successfully",
    );
  });

  it("deliver sets tag to dedupeKey", async () => {
    const reg = makeFakeRegistration();
    const adapter = new WebPushAdapter({ registration: reg });

    await adapter.deliver(makeEvent({ dedupeKey: "dk-42" }));

    expect(reg.calls[0].options?.tag).toBe("dk-42");
  });

  it("deliver passes event metadata in data field", async () => {
    const reg = makeFakeRegistration();
    const adapter = new WebPushAdapter({ registration: reg });

    await adapter.deliver(
      makeEvent({
        id: "evt-7",
        kind: "system_alert",
        severity: "critical",
        sessionId: "sess-9",
        provider: "prov-x",
        metadata: { foo: "bar" },
      }),
    );

    const data = reg.calls[0].options?.data as Record<string, unknown>;
    expect(data.eventId).toBe("evt-7");
    expect(data.kind).toBe("system_alert");
    expect(data.severity).toBe("critical");
    expect(data.sessionId).toBe("sess-9");
    expect(data.provider).toBe("prov-x");
    expect(data.metadata).toEqual({ foo: "bar" });
  });

  it("deliver throws when no registration is set", async () => {
    const adapter = new WebPushAdapter();

    await expect(adapter.deliver(makeEvent())).rejects.toThrow(
      "No service worker registration available",
    );
  });

  it("deliver propagates registration errors", async () => {
    const reg: PushRegistration = {
      showNotification: async () => {
        throw new Error("push failed");
      },
    };
    const adapter = new WebPushAdapter({ registration: reg });

    await expect(adapter.deliver(makeEvent())).rejects.toThrow("push failed");
  });
});
