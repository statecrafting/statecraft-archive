import { beforeEach, describe, expect, test } from "vitest";
import type { ServerEnvelope } from "./types";
import { ENVELOPE_SCHEMA_VERSION } from "./types";
import { __resetStoresForTests, cursors, inbox, outbox } from "./store";

function serverEvent(orgId: string, eventId: string, cursor: string): ServerEnvelope {
  return {
    kind: "factory.event",
    meta: {
      v: ENVELOPE_SCHEMA_VERSION,
      eventId,
      sentAt: "2026-04-20T00:00:00Z",
      orgId,
      orgCursor: cursor,
    },
    pipelineId: "pl1",
    projectId: "pr1",
    eventType: "stage_confirmed",
  };
}

describe("cursors", () => {
  beforeEach(() => __resetStoresForTests());

  test("mints monotonically increasing lexicographically-orderable cursors per org", () => {
    const a = cursors.next("org1");
    const b = cursors.next("org1");
    const c = cursors.next("org1");
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });

  test("cursors are independent per org", () => {
    cursors.next("org1");
    cursors.next("org1");
    const o1 = cursors.peek("org1");
    const o2 = cursors.peek("org2");
    expect(o1).toBeDefined();
    expect(o2).toBeUndefined();
  });
});

describe("inbox", () => {
  beforeEach(() => __resetStoresForTests());

  test("records recent inbound events in order", async () => {
    await inbox.recordInbound({
      orgId: "org1",
      clientId: "c1",
      event: {
        kind: "sync.heartbeat",
        meta: { v: ENVELOPE_SCHEMA_VERSION, eventId: "e1", sentAt: "t" },
      },
      status: "accepted",
      receivedAt: new Date(),
    });
    await inbox.recordInbound({
      orgId: "org1",
      clientId: "c1",
      event: {
        kind: "sync.heartbeat",
        meta: { v: ENVELOPE_SCHEMA_VERSION, eventId: "e2", sentAt: "t" },
      },
      status: "accepted",
      receivedAt: new Date(),
    });
    const recent = await inbox.listRecent(10);
    expect(recent.map((r) => r.event.meta.eventId)).toEqual(["e1", "e2"]);
  });
});

describe("outbox", () => {
  beforeEach(() => __resetStoresForTests());

  test("loads pending events for a client that has not ACKed anything", async () => {
    await outbox.recordOutbound({
      orgId: "org1",
      event: serverEvent("org1", "s1", "0000000000000000001"),
      createdAt: new Date(),
      ackedBy: new Set(),
    });
    await outbox.recordOutbound({
      orgId: "org1",
      event: serverEvent("org1", "s2", "0000000000000000002"),
      createdAt: new Date(),
      ackedBy: new Set(),
    });
    const pending = await outbox.loadPendingForClient("org1", "c1");
    expect(pending.map((e) => e.meta.eventId)).toEqual(["s1", "s2"]);
  });

  test("loads only events after the given cursor", async () => {
    await outbox.recordOutbound({
      orgId: "org1",
      event: serverEvent("org1", "s1", "0000000000000000001"),
      createdAt: new Date(),
      ackedBy: new Set(),
    });
    await outbox.recordOutbound({
      orgId: "org1",
      event: serverEvent("org1", "s2", "0000000000000000002"),
      createdAt: new Date(),
      ackedBy: new Set(),
    });
    const pending = await outbox.loadPendingForClient(
      "org1",
      "c1",
      "0000000000000000001",
    );
    expect(pending.map((e) => e.meta.eventId)).toEqual(["s2"]);
  });

  test("markAcked excludes the event from pending for that client", async () => {
    await outbox.recordOutbound({
      orgId: "org1",
      event: serverEvent("org1", "s1", "0000000000000000001"),
      createdAt: new Date(),
      ackedBy: new Set(),
    });
    await outbox.markAcked("org1", "s1", "c1");
    expect(await outbox.loadPendingForClient("org1", "c1")).toEqual([]);
    // Other clients still see it as pending.
    expect(
      (await outbox.loadPendingForClient("org1", "c2")).map((e) => e.meta.eventId),
    ).toEqual(["s1"]);
  });

  test("pending events do not cross orgs", async () => {
    await outbox.recordOutbound({
      orgId: "org1",
      event: serverEvent("org1", "s1", "0000000000000000001"),
      createdAt: new Date(),
      ackedBy: new Set(),
    });
    expect(await outbox.loadPendingForClient("org2", "c1")).toEqual([]);
  });
});
