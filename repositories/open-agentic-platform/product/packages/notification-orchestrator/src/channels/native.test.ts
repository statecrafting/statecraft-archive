import { describe, it, expect, vi } from "vitest";
import { NativeNotificationAdapter } from "./native.js";
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

/**
 * Minimal stub that satisfies the shape the adapter uses from the
 * Notification constructor. Captures construction arguments for assertions.
 */
function makeFakeNotificationCtor(permission: NotificationPermission) {
  const instances: Array<{ title: string; options: NotificationOptions }> = [];

  const Ctor = function (
    this: unknown,
    title: string,
    options?: NotificationOptions,
  ) {
    instances.push({ title, options: options ?? {} });
  } as unknown as typeof Notification;

  Object.defineProperty(Ctor, "permission", { get: () => permission });

  return { Ctor, instances };
}

describe("NativeNotificationAdapter", () => {
  it("has channelId 'native'", () => {
    const adapter = new NativeNotificationAdapter();
    expect(adapter.channelId).toBe("native");
  });

  it("isAvailable returns false when no Notification API exists", () => {
    const adapter = new NativeNotificationAdapter({
      NotificationCtor: undefined,
    });
    expect(adapter.isAvailable()).toBe(false);
  });

  it("isAvailable returns false when permission is 'denied'", () => {
    const { Ctor } = makeFakeNotificationCtor("denied");
    const adapter = new NativeNotificationAdapter({ NotificationCtor: Ctor });
    expect(adapter.isAvailable()).toBe(false);
  });

  it("isAvailable returns false when permission is 'default'", () => {
    const { Ctor } = makeFakeNotificationCtor("default");
    const adapter = new NativeNotificationAdapter({ NotificationCtor: Ctor });
    expect(adapter.isAvailable()).toBe(false);
  });

  it("isAvailable returns true when permission is 'granted'", () => {
    const { Ctor } = makeFakeNotificationCtor("granted");
    const adapter = new NativeNotificationAdapter({ NotificationCtor: Ctor });
    expect(adapter.isAvailable()).toBe(true);
  });

  it("deliver creates a Notification with correct title and body", async () => {
    const { Ctor, instances } = makeFakeNotificationCtor("granted");
    const adapter = new NativeNotificationAdapter({ NotificationCtor: Ctor });
    const event = makeEvent();

    await adapter.deliver(event);

    expect(instances).toHaveLength(1);
    expect(instances[0].title).toBe("Task Done");
    expect(instances[0].options.body).toBe("Your task completed successfully");
  });

  it("deliver sets tag to dedupeKey", async () => {
    const { Ctor, instances } = makeFakeNotificationCtor("granted");
    const adapter = new NativeNotificationAdapter({ NotificationCtor: Ctor });

    await adapter.deliver(makeEvent({ dedupeKey: "custom-key" }));

    expect(instances[0].options.tag).toBe("custom-key");
  });

  it("deliver passes event metadata in data field", async () => {
    const { Ctor, instances } = makeFakeNotificationCtor("granted");
    const adapter = new NativeNotificationAdapter({ NotificationCtor: Ctor });

    await adapter.deliver(
      makeEvent({
        id: "evt-99",
        kind: "task_error",
        severity: "error",
        sessionId: "sess-5",
        provider: "p1",
      }),
    );

    const data = instances[0].options.data as Record<string, unknown>;
    expect(data.eventId).toBe("evt-99");
    expect(data.kind).toBe("task_error");
    expect(data.severity).toBe("error");
    expect(data.sessionId).toBe("sess-5");
    expect(data.provider).toBe("p1");
  });

  it("deliver throws when Notification API is unavailable", async () => {
    const adapter = new NativeNotificationAdapter({
      NotificationCtor: undefined,
    });

    await expect(adapter.deliver(makeEvent())).rejects.toThrow(
      "Notification API is not available",
    );
  });
});
