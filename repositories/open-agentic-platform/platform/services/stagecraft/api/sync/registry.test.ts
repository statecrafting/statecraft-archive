import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ServerEnvelope, SyncStream } from "./types";
import { ENVELOPE_SCHEMA_VERSION } from "./types";
import * as registry from "./registry";
import type { Session } from "./registry";

function makeStream(opts: { failSend?: boolean } = {}): {
  stream: SyncStream;
  sent: ServerEnvelope[];
  closed: boolean;
} {
  const sent: ServerEnvelope[] = [];
  let closed = false;
  const stream = {
    send: vi.fn(async (msg: ServerEnvelope) => {
      if (opts.failSend) throw new Error("boom");
      sent.push(msg);
    }),
    close: vi.fn(async () => {
      closed = true;
    }),
    recv: vi.fn(async () => {
      throw new Error("not used in registry tests");
    }),
    [Symbol.asyncIterator]: async function* () {
      // no messages
    },
  } as unknown as SyncStream;
  return {
    stream,
    sent,
    get closed() {
      return closed;
    },
  };
}

function makeSession(orgId: string, clientId: string, stream: SyncStream): Session {
  return {
    meta: {
      orgId,
      clientId,
      clientKind: "desktop-opc",
      userId: "u1",
      connectedAt: new Date(),
      lastHeartbeatAt: new Date(),
    },
    stream,
  };
}

function sampleEvent(
  orgId: string,
  cursor = "0000000000000000001",
): ServerEnvelope {
  return {
    kind: "sync.heartbeat",
    meta: {
      v: ENVELOPE_SCHEMA_VERSION,
      eventId: "evt-1",
      sentAt: "2026-04-20T00:00:00Z",
      orgId,
      orgCursor: cursor,
    },
  };
}

describe("sync registry", () => {
  beforeEach(() => registry.__resetForTests());

  test("registers and counts sessions scoped by org", () => {
    const a = makeStream();
    const b = makeStream();
    registry.register(makeSession("org1", "c1", a.stream));
    registry.register(makeSession("org1", "c2", b.stream));
    registry.register(makeSession("org2", "c3", makeStream().stream));

    expect(registry.sessionCount("org1")).toBe(2);
    expect(registry.sessionCount("org2")).toBe(1);
    expect(registry.sessionCount()).toBe(3);
    expect(registry.orgCount()).toBe(2);
  });

  test("replacing a session closes the prior stream", () => {
    const first = makeStream();
    const second = makeStream();
    registry.register(makeSession("org1", "c1", first.stream));
    registry.register(makeSession("org1", "c1", second.stream));
    expect(first.stream.close).toHaveBeenCalled();
    expect(registry.sessionCount("org1")).toBe(1);
  });

  test("reconnect race: a stale connection's unregister does not evict the live replacement", () => {
    const first = makeStream();
    const second = makeStream();
    // Conn A registers; Conn B reconnects under the SAME clientId (register
    // closes A's stream and installs B as the live session).
    registry.register(makeSession("org1", "c1", first.stream));
    registry.register(makeSession("org1", "c1", second.stream));
    expect(first.stream.close).toHaveBeenCalled();

    // Conn A's `finally` now runs, unregistering with ITS OWN (now-stale)
    // stream. The stream-identity guard must keep B registered — without it,
    // B is orphaned and its next heartbeat tears the live stream down (the
    // spec-183 duplex reconnect wedge: every reconnect dies before sync.hello).
    registry.unregister("org1", "c1", first.stream);

    expect(registry.sessionCount("org1")).toBe(1);
    expect(registry.get("org1", "c1")?.stream).toBe(second.stream);
  });

  test("unregister with the matching stream removes the session", () => {
    const a = makeStream();
    registry.register(makeSession("org1", "c1", a.stream));
    registry.unregister("org1", "c1", a.stream);
    expect(registry.sessionCount("org1")).toBe(0);
  });

  test("unregister removes the session and cleans the org", () => {
    const a = makeStream();
    registry.register(makeSession("org1", "c1", a.stream));
    registry.unregister("org1", "c1");
    expect(registry.sessionCount("org1")).toBe(0);
    expect(registry.orgCount()).toBe(0);
  });

  test("sendTo delivers to the target and updates lastSentCursor", async () => {
    const a = makeStream();
    const session = makeSession("org1", "c1", a.stream);
    registry.register(session);

    const evt = sampleEvent("org1", "0000000000000000007");
    const ok = await registry.sendTo("org1", "c1", evt);

    expect(ok).toBe(true);
    expect(a.sent).toEqual([evt]);
    expect(session.meta.lastSentCursor).toBe("0000000000000000007");
  });

  test("sendTo prunes the session on send failure", async () => {
    const a = makeStream({ failSend: true });
    registry.register(makeSession("org1", "c1", a.stream));

    const ok = await registry.sendTo("org1", "c1", sampleEvent("org1"));
    expect(ok).toBe(false);
    expect(registry.sessionCount("org1")).toBe(0);
  });

  test("broadcastOrg does not leak across orgs", async () => {
    const a = makeStream();
    const b = makeStream();
    const other = makeStream();
    registry.register(makeSession("org1", "c1", a.stream));
    registry.register(makeSession("org1", "c2", b.stream));
    registry.register(makeSession("org2", "x1", other.stream));

    const evt = sampleEvent("org1");
    const result = await registry.broadcastOrg("org1", evt);

    expect(result.sent).toBe(2);
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    expect(other.sent).toHaveLength(0);
  });

  test("broadcastOrg honours excludeClientId", async () => {
    const a = makeStream();
    const b = makeStream();
    registry.register(makeSession("org1", "c1", a.stream));
    registry.register(makeSession("org1", "c2", b.stream));

    const result = await registry.broadcastOrg("org1", sampleEvent("org1"), {
      excludeClientId: "c1",
    });
    expect(result.sent).toBe(1);
    expect(a.sent).toHaveLength(0);
    expect(b.sent).toHaveLength(1);
  });

  test("broadcastOrg prunes dead streams", async () => {
    const dead = makeStream({ failSend: true });
    const alive = makeStream();
    registry.register(makeSession("org1", "c-dead", dead.stream));
    registry.register(makeSession("org1", "c-alive", alive.stream));

    const result = await registry.broadcastOrg("org1", sampleEvent("org1"));
    expect(result.sent).toBe(1);
    expect(result.pruned).toBe(1);
    expect(registry.sessionCount("org1")).toBe(1);
    expect(registry.get("org1", "c-dead")).toBeUndefined();
  });
});
