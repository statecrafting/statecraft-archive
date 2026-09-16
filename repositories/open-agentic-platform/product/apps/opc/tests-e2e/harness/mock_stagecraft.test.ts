import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { MockStatecraft, ENVELOPE_SCHEMA_VERSION } from "./mock_statecraft";

// Spec 187 FR-T2 + 187 AC-6. A real ws client connects to the mock and asserts
// the observable behaviour of each of the four modes. The handshake query
// string mirrors the Encore streamInOut convention the desktop client uses.

let server: MockStatecraft | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const HANDSHAKE = "?clientId=test-client&clientKind=desktop-opc";

function firstMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
    ws.once("error", reject);
    setTimeout(() => reject(new Error("no message within 3s")), 3000);
  });
}

function observeUntilClose(
  ws: WebSocket,
): Promise<{ opened: boolean; gotMessage: boolean }> {
  return new Promise((resolve, reject) => {
    let opened = false;
    let gotMessage = false;
    ws.on("open", () => (opened = true));
    ws.on("message", () => (gotMessage = true));
    ws.on("error", () => undefined); // a clean server close should not error
    ws.on("close", () => resolve({ opened, gotMessage }));
    setTimeout(() => reject(new Error("no close within 3s")), 3000);
  });
}

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("close", () => resolve());
    ws.on("error", () => undefined);
    setTimeout(() => reject(new Error("no close within 3s")), 3000);
  });
}

function waitForError(ws: WebSocket): Promise<Error> {
  return new Promise((resolve, reject) => {
    ws.once("error", (err) => resolve(err));
    setTimeout(() => reject(new Error("no transport error within 3s")), 3000);
  });
}

describe("FR-T2 mock-statecraft duplex server", () => {
  it("healthy: emits a v2 sync.hello after handshake and keeps the socket open", async () => {
    server = new MockStatecraft({ mode: "healthy", orgId: "org_test" });
    const { url } = await server.start();
    const ws = new WebSocket(`${url}${HANDSHAKE}`, {
      headers: { Authorization: "Bearer test" },
    });
    const hello = await firstMessage(ws);
    expect(hello.kind).toBe("sync.hello");
    expect((hello.meta as { v: number }).v).toBe(ENVELOPE_SCHEMA_VERSION);
    expect((hello.meta as { v: number }).v).toBe(2);
    expect((hello.meta as { orgId: string }).orgId).toBe("org_test");
    expect(typeof hello.sessionId).toBe("string");
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("handshake-rejects: accepts the connection then closes before any sync.hello", async () => {
    server = new MockStatecraft({ mode: "handshake-rejects" });
    const { url } = await server.start();
    const ws = new WebSocket(`${url}${HANDSHAKE}`);
    const outcome = await observeUntilClose(ws);
    expect(outcome.opened).toBe(true);
    expect(outcome.gotMessage).toBe(false);
  });

  it("mid-session-drop: emits sync.hello then drops the connection", async () => {
    server = new MockStatecraft({ mode: "mid-session-drop", orgId: "org_drop" });
    const { url } = await server.start();
    const ws = new WebSocket(`${url}${HANDSHAKE}`);
    const hello = await firstMessage(ws);
    expect(hello.kind).toBe("sync.hello");
    await waitForClose(ws);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("network-unreachable: refuses the connection at the transport layer", async () => {
    server = new MockStatecraft({ mode: "network-unreachable" });
    const { url } = await server.start();
    const ws = new WebSocket(`${url}${HANDSHAKE}`);
    await expect(waitForError(ws)).resolves.toBeInstanceOf(Error);
  });

  it("exposes a ws:// url on the canonical duplex path", async () => {
    server = new MockStatecraft({ mode: "healthy" });
    const { url, port } = await server.start();
    expect(url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/api\/sync\/duplex$/);
    expect(port).toBeGreaterThan(0);
  });
});

// Spec 208 FR-005 (kill-switch drill). The duplex must stay bidirectional
// after the hello: the drill pushes an org.halt.* frame server->client and
// awaits the client's org.halt.ack client->server.
describe("FR-005 drill duplex extensions", () => {
  async function connectHealthy(): Promise<WebSocket> {
    const s = new MockStatecraft({ mode: "healthy", orgId: "org_drill" });
    server = s;
    const { url } = await s.start();
    const ws = new WebSocket(`${url}${HANDSHAKE}`, {
      headers: { Authorization: "Bearer test" },
    });
    await firstMessage(ws); // consume sync.hello; socket is now retained
    return ws;
  }

  it("push(): delivers a server->client frame to the connected client after hello", async () => {
    const ws = await connectHealthy();
    const next = firstMessage(ws);
    server!.push({ kind: "org.halt.activated", haltId: "halt-1" });
    const frame = await next;
    expect(frame.kind).toBe("org.halt.activated");
    expect(frame.haltId).toBe("halt-1");
    ws.close();
  });

  it("waitForFrame(): resolves for a client->server frame that arrives later", async () => {
    const ws = await connectHealthy();
    const pending = server!.waitForFrame(
      (f) => (f as { kind?: string }).kind === "org.halt.ack",
    );
    ws.send(JSON.stringify({ kind: "org.halt.ack", haltId: "halt-1" }));
    const ack = (await pending) as { kind: string; haltId: string };
    expect(ack.kind).toBe("org.halt.ack");
    expect(ack.haltId).toBe("halt-1");
    ws.close();
  });

  it("waitForFrame(): resolves for a frame already recorded before the call", async () => {
    const ws = await connectHealthy();
    ws.send(JSON.stringify({ kind: "org.halt.ack", haltId: "seen" }));
    // Give the server a tick to record the inbound frame, then subscribe.
    await new Promise((r) => setTimeout(r, 50));
    const ack = (await server!.waitForFrame(
      (f) => (f as { kind?: string }).kind === "org.halt.ack",
    )) as { haltId: string };
    expect(ack.haltId).toBe("seen");
    expect(server!.inboundFrames().length).toBe(1);
    ws.close();
  });

  it("waitForFrame(): rejects after the timeout when no frame matches", async () => {
    await connectHealthy();
    await expect(server!.waitForFrame(() => false, 100)).rejects.toThrow(
      /timed out waiting for inbound frame/,
    );
  });

  it("push(): is a no-op when no client is connected (the disconnected leg)", async () => {
    const s = new MockStatecraft({ mode: "healthy" });
    server = s;
    await s.start();
    expect(() => s.push({ kind: "org.halt.activated" })).not.toThrow();
  });
});
