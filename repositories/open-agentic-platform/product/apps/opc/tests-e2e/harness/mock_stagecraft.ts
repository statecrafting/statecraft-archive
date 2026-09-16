// Spec 187 FR-T2 — configurable mock-statecraft duplex server.
//
// A duplex WebSocket double that speaks the spec 087 envelope grammar. It
// mirrors the LOCKED server-side types in
//   platform/services/statecraft/api/sync/types.ts   (ServerHello / ServerMeta)
// and the Rust desktop mirror in
//   product/apps/opc/src-tauri/src/commands/sync_client.rs
// rather than inventing a speculative shape. The handshake is the Encore
// `streamInOut` convention: the SyncHandshake fields ride as query params on
// the upgrade URL (?clientId=...&clientKind=desktop-opc), not as a first frame.

import { createServer, type Server as HttpServer } from "node:http";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket as WsSocket, type RawData } from "ws";

// MUST equal api/sync/types.ts::ENVELOPE_SCHEMA_VERSION and
// sync_client.rs::ENVELOPE_SCHEMA_VERSION (spec 189 version parity). The
// desktop client silently drops any frame whose meta.v differs, so a hello
// pinned to the wrong version would never flip the boot gate.
export const ENVELOPE_SCHEMA_VERSION = 2 as const;

const SERVER_STARTED_AT = new Date().toISOString();

/** Mirror of api/sync/types.ts::ServerMeta (the server-side envelope meta). */
export interface ServerMeta {
  v: typeof ENVELOPE_SCHEMA_VERSION;
  eventId: string;
  sentAt: string;
  correlationId?: string;
  causationId?: string;
  orgCursor: string;
  orgId: string;
}

/** Mirror of api/sync/types.ts::ServerHello (the first server frame). */
export interface ServerHello {
  kind: "sync.hello";
  meta: ServerMeta;
  sessionId: string;
  serverStartedAt: string;
  cursorGap?: boolean;
}

export type MockMode =
  | "healthy"
  | "network-unreachable"
  | "handshake-rejects"
  | "mid-session-drop";

export interface MockStatecraftOptions {
  mode: MockMode;
  /** org id stamped onto sync.hello (default "org_mock"). */
  orgId?: string;
  host?: string;
  /** 0 (default) binds an ephemeral port. */
  port?: number;
  /** Duplex path (default the canonical "/api/sync/duplex"). */
  path?: string;
}

/** A pending waitForFrame() subscription (spec 208 FR-005 drill). */
interface InboundWaiter {
  match: (frame: unknown) => boolean;
  resolve: (frame: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class MockStatecraft {
  private mode: MockMode;
  private readonly orgId: string;
  private readonly host: string;
  private readonly desiredPort: number;
  private readonly path: string;

  private http?: HttpServer;
  private wss?: WebSocketServer;
  private refuser?: NetServer;
  private boundPort = 0;

  // Spec 208 FR-005 (the kill-switch drill). The base mock speaks only the
  // handshake: one scripted sync.hello, then silence. The drill needs the
  // duplex to stay bidirectional after the hello so it can push an
  // org.halt.* frame server->client and observe the client's org.halt.ack
  // client->server. These three fields add exactly that, without touching
  // the spec 187 handshake modes above.
  private readonly sockets = new Set<WsSocket>();
  private readonly inbound: unknown[] = [];
  private inboundWaiters: InboundWaiter[] = [];

  constructor(opts: MockStatecraftOptions) {
    this.mode = opts.mode;
    this.orgId = opts.orgId ?? "org_mock";
    this.host = opts.host ?? "127.0.0.1";
    this.desiredPort = opts.port ?? 0;
    this.path = opts.path ?? "/api/sync/duplex";
  }

  get url(): string {
    return `ws://${this.host}:${this.boundPort}${this.path}`;
  }

  /** Switch modes at runtime (test fixture sets the mode, server reconfigures). */
  setMode(mode: MockMode): void {
    this.mode = mode;
  }

  async start(): Promise<{ url: string; port: number }> {
    if (this.mode === "network-unreachable") {
      // Bind a real port (so the URL is stable) but destroy every incoming
      // socket — a transport-layer RST. The desktop reconnect loop fails
      // before any WebSocket upgrade completes (FR-T2b).
      this.refuser = createNetServer((socket) => socket.destroy());
      await listen(this.refuser, this.desiredPort, this.host);
      this.boundPort = portOf(this.refuser);
      return { url: this.url, port: this.boundPort };
    }

    this.http = createServer();
    this.wss = new WebSocketServer({ server: this.http, path: this.path });
    this.wss.on("connection", (socket) => this.onConnection(socket));
    await listen(this.http, this.desiredPort, this.host);
    this.boundPort = portOf(this.http);
    return { url: this.url, port: this.boundPort };
  }

  private onConnection(socket: WsSocket): void {
    if (this.mode === "handshake-rejects") {
      // Accept the upgrade, then close before any sync.hello. Sidecar liveness
      // (the local TCP probe) passes, but org-session-ready never flips — the
      // AC-7 "boot stays sticky" branch (FR-T2c).
      socket.close(1000, "handshake-rejects");
      return;
    }

    socket.send(JSON.stringify(this.buildHello()));

    if (this.mode === "mid-session-drop") {
      // Emit sync.hello, then drop without server-side reconnect (FR-T2d) —
      // the duplex-side analog of AC-8's mid-session restore.
      socket.close(1001, "mid-session-drop");
      return;
    }

    // "healthy": leave the socket open, as a real statecraft would. Spec 208
    // FR-005: retain the socket so the drill can push an org.halt.* frame
    // after the hello (push()) and record the client's org.halt.ack
    // (recordInbound / waitForFrame).
    this.sockets.add(socket);
    socket.on("message", (data) => this.recordInbound(data));
    socket.on("close", () => this.sockets.delete(socket));
  }

  /**
   * Push a server->client frame to every retained duplex socket. Spec 208
   * FR-005: the drill injects org.halt.activated / org.halt.lifted this way,
   * after the initial sync.hello. Serialises with the same JSON convention as
   * buildHello(). No-op when no client is connected (e.g. the disconnected
   * engine leg), which is the intended shape for a fail-closed reconnect.
   */
  push(frame: unknown): void {
    const payload = JSON.stringify(frame);
    for (const socket of this.sockets) {
      socket.send(payload);
    }
  }

  /** Frames the client has sent since connect (parsed best-effort). */
  inboundFrames(): readonly unknown[] {
    return this.inbound;
  }

  /**
   * Resolve with the first inbound frame (already-seen or future) matching
   * `match`, or reject after `timeoutMs`. Lets the drill await the client's
   * org.halt.ack without polling.
   */
  waitForFrame(match: (frame: unknown) => boolean, timeoutMs = 5000): Promise<unknown> {
    const seen = this.inbound.findIndex(match);
    if (seen >= 0) return Promise.resolve(this.inbound[seen]);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.inboundWaiters = this.inboundWaiters.filter((w) => w !== waiter);
        reject(new Error("mock-statecraft: timed out waiting for inbound frame"));
      }, timeoutMs);
      const waiter: InboundWaiter = { match, resolve, reject, timer };
      this.inboundWaiters.push(waiter);
    });
  }

  private recordInbound(data: RawData): void {
    const frame = parseFrame(data);
    this.inbound.push(frame);
    this.inboundWaiters = this.inboundWaiters.filter((waiter) => {
      if (!waiter.match(frame)) return true;
      clearTimeout(waiter.timer);
      waiter.resolve(frame);
      return false;
    });
  }

  private buildHello(): ServerHello {
    return {
      kind: "sync.hello",
      meta: {
        v: ENVELOPE_SCHEMA_VERSION,
        eventId: randomUUID(),
        sentAt: new Date().toISOString(),
        orgCursor: "mock-cursor-0",
        orgId: this.orgId,
      },
      sessionId: `${this.orgId}:mock`,
      serverStartedAt: SERVER_STARTED_AT,
      cursorGap: false,
    };
  }

  async stop(): Promise<void> {
    // Settle any drill still awaiting a frame so teardown never leaks a timer
    // or an unhandled rejection past the fixture (FR-T3 / FR-T6 no-flake).
    for (const waiter of this.inboundWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("mock-statecraft: stopped while waiting for inbound frame"));
    }
    // Force-terminate any retained duplex socket. A real drill tears the OPC
    // binary down separately, so the client socket is still open here, and
    // http.Server.close() only fires its callback once every connection is
    // gone. terminate() destroys the TCP socket so teardown never wedges.
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear();
    this.inbound.length = 0;
    await new Promise<void>((resolve) => {
      if (this.wss) this.wss.close(() => resolve());
      else resolve();
    });
    await closeServer(this.http);
    await closeServer(this.refuser);
    this.http = undefined;
    this.wss = undefined;
    this.refuser = undefined;
  }
}

function listen(server: HttpServer | NetServer, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

function portOf(server: HttpServer | NetServer): number {
  const addr = server.address() as AddressInfo | null;
  if (!addr || typeof addr === "string") {
    throw new Error("mock-statecraft: server is not listening on a TCP port");
  }
  return addr.port;
}

function closeServer(server?: HttpServer | NetServer): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}

/** Parse an inbound duplex frame; fall back to the raw string on non-JSON. */
function parseFrame(data: RawData): unknown {
  const text = typeof data === "string" ? data : data.toString();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
