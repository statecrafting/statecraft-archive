import { describe, it, expect, vi } from "vitest";
import { ToastAdapter } from "./toast.js";
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
    metadata: {},
    ...overrides,
  };
}

describe("ToastAdapter", () => {
  it("has channelId 'toast'", () => {
    const adapter = new ToastAdapter();
    expect(adapter.channelId).toBe("toast");
  });

  it("isAvailable returns true by default", () => {
    const adapter = new ToastAdapter();
    expect(adapter.isAvailable()).toBe(true);
  });

  it("isAvailable returns false when disabled", () => {
    const adapter = new ToastAdapter({ disabled: true });
    expect(adapter.isAvailable()).toBe(false);
  });

  it("deliver invokes registered handler with the event", async () => {
    const adapter = new ToastAdapter();
    const received: NotificationEvent[] = [];
    adapter.onToast((e) => received.push(e));

    const event = makeEvent();
    await adapter.deliver(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(event);
  });

  it("deliver invokes multiple handlers", async () => {
    const adapter = new ToastAdapter();
    const a: NotificationEvent[] = [];
    const b: NotificationEvent[] = [];
    adapter.onToast((e) => a.push(e));
    adapter.onToast((e) => b.push(e));

    await adapter.deliver(makeEvent());

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("onToast returns an unsubscribe function", async () => {
    const adapter = new ToastAdapter();
    const received: NotificationEvent[] = [];
    const unsub = adapter.onToast((e) => received.push(e));

    await adapter.deliver(makeEvent());
    expect(received).toHaveLength(1);

    unsub();
    await adapter.deliver(makeEvent());
    expect(received).toHaveLength(1); // no new event
  });

  it("deliver works with no handlers (noop)", async () => {
    const adapter = new ToastAdapter();
    // Should not throw
    await adapter.deliver(makeEvent());
  });

  it("deliver passes complete event data to handlers", async () => {
    const adapter = new ToastAdapter();
    const received: NotificationEvent[] = [];
    adapter.onToast((e) => received.push(e));

    const event = makeEvent({
      id: "evt-42",
      kind: "permission_request",
      severity: "warning",
      metadata: { action: "approve" },
    });
    await adapter.deliver(event);

    expect(received[0].id).toBe("evt-42");
    expect(received[0].kind).toBe("permission_request");
    expect(received[0].severity).toBe("warning");
    expect(received[0].metadata).toEqual({ action: "approve" });
  });

  it("multiple unsubscribes are safe", async () => {
    const adapter = new ToastAdapter();
    const unsub = adapter.onToast(() => {});
    unsub();
    unsub(); // second call is harmless
  });
});
