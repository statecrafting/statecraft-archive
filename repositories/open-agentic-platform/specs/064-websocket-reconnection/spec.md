---
id: "064-websocket-reconnection"
title: "WebSocket Session Reconnection"
feature_branch: "064-websocket-reconnection"
status: approved
implementation: complete
kind: desktop
domain: opc
created: "2026-03-31"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Hot-swap WebSocket reconnection for in-flight SDK streams. When a WebSocket
  connection drops during a long-running agent session, the client transparently
  reconnects and the server swaps the new connection into the existing session's
  writer, preserving session state and replaying missed events. No user
  intervention required.
code_aliases:
  - WS_RECONNECT
sources:
  - claudecodeui
references:
  - role: historical
    unit: { kind: file, path: product/apps/opc/src/lib/wsReconnection.ts }
extends:
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: crate, id: "@opc/desktop" }
---

# Feature Specification: WebSocket Session Reconnection

## Purpose

Long-running agent sessions communicate over WebSocket connections that can drop due to network interruptions, laptop sleep/wake cycles, or proxy timeouts. Currently, a dropped connection terminates the session — the user loses all in-flight work and must restart. This is the single largest source of user frustration for sessions that run longer than a few minutes.

This feature makes WebSocket connections resilient by separating the logical session from the physical connection. When a connection drops, the client reconnects automatically and the server hot-swaps the new connection into the existing session, replaying any events the client missed during the disconnect window.

## Scope

### In scope

- **Connection health monitoring**: Client-side heartbeat with configurable interval and timeout detection.
- **Automatic reconnection**: Exponential backoff reconnection with jitter, configurable max retries.
- **Session-connection decoupling**: Server maintains session state independently of the WebSocket connection lifecycle.
- **Connection hot-swap**: Server replaces the session's writer with the new WebSocket connection on reconnect.
- **Event buffering and replay**: Server buffers events during disconnect and replays missed events on reconnect.
- **Client-side message deduplication**: Client tracks last-received sequence number to skip already-processed events during replay.
- **Connection state UI**: Visual indicator showing connection status (connected, reconnecting, disconnected).

### Out of scope

- **Session migration across devices**: Reconnection is same-client only.
- **Offline queue for client-to-server messages**: Client messages sent during disconnect are dropped; the user re-submits after reconnection.
- **WebSocket compression (permessage-deflate)**: Optimization deferred.
- **Load balancer session affinity**: Assumes sticky sessions or single-server deployment for now.

## Requirements

### Functional

- **FR-001**: Every WebSocket message from server to client carries a monotonically increasing `seq` (sequence number) scoped to the session.
- **FR-002**: The client sends a `heartbeat` ping every N seconds (configurable, default 15s). If no `pong` is received within M seconds (configurable, default 5s), the connection is considered dead.
- **FR-003**: On connection loss, the client enters a reconnection loop with exponential backoff: initial delay 500ms, multiplier 2x, max delay 30s, jitter +/- 25%. Maximum retry count configurable (default 10).
- **FR-004**: On reconnect, the client sends a `resume` message containing `sessionId` and `lastSeq` (the last sequence number it successfully processed).
- **FR-005**: The server validates `sessionId`, retrieves the session, and hot-swaps the session's `WebSocketWriter` to the new connection.
- **FR-006**: The server replays all buffered events with `seq > lastSeq` in order, then resumes live streaming.
- **FR-007**: The server buffers up to B events (configurable, default 500) per session during disconnect. If the buffer overflows, the oldest events are dropped and a `gap` marker is inserted so the client knows it missed events.
- **FR-008**: The client deduplicates replayed events by comparing `seq` against its local watermark.
- **FR-009**: If reconnection fails after max retries, the client emits a `session:disconnected` event and shows a manual reconnect UI.
- **FR-010**: Session state on the server has a TTL (configurable, default 5 minutes) after the last connection closes. After TTL expiry, the session is cleaned up.

### Non-functional

- **NF-001**: Reconnection completes in < 2 seconds on a healthy network (excluding backoff wait time).
- **NF-002**: Event replay of 500 buffered messages completes in < 500ms.
- **NF-003**: Memory overhead per session for event buffering does not exceed 2MB (assuming average event size of 4KB).
- **NF-004**: Heartbeat overhead is < 100 bytes per ping/pong cycle.

## Architecture

### Protocol messages

```typescript
// Client -> Server
interface ResumeMessage {
  type: "resume";
  sessionId: string;
  lastSeq: number;
}

interface HeartbeatPing {
  type: "ping";
  timestamp: number;
}

// Server -> Client
interface SessionEvent {
  seq: number;
  type: string;
  payload: unknown;
  timestamp: string; // ISO 8601
}

interface ResumeAck {
  type: "resume_ack";
  sessionId: string;
  replayFrom: number; // first seq being replayed
  replayTo: number;   // last seq being replayed
  gapDetected: boolean;
}

interface HeartbeatPong {
  type: "pong";
  timestamp: number;
}
```

### Client reconnection state machine

```
CONNECTED
  |
  +--(connection lost)--> RECONNECTING
  |                         |
  |                         +--(attempt success)--> RESUMING
  |                         |                         |
  |                         |                         +--(replay complete)--> CONNECTED
  |                         |                         |
  |                         |                         +--(resume rejected)--> DISCONNECTED
  |                         |
  |                         +--(max retries)--> DISCONNECTED
  |
  +--(clean close)--> DISCONNECTED
```

### Server session lifecycle

```
Session created (first WS connect)
  |
  v
ACTIVE (WS connected, streaming events)
  |
  +--(WS dropped)--> DETACHED (buffering events, TTL timer starts)
  |                    |
  |                    +--(new WS + resume)--> ACTIVE (hot-swap writer, replay buffer)
  |                    |
  |                    +--(TTL expires)--> EXPIRED (cleanup session state)
  |
  +--(session complete)--> CLOSED
```

### WebSocketWriter hot-swap

```typescript
interface WebSocketWriter {
  send(event: SessionEvent): void;
  close(): void;
}

interface ReconnectableSession {
  sessionId: string;
  writer: WebSocketWriter;
  eventBuffer: RingBuffer<SessionEvent>;
  currentSeq: number;
  detachedAt: number | null;

  /** Replace the active writer with a new connection */
  hotSwap(newWriter: WebSocketWriter, lastClientSeq: number): void;
}
```

The `hotSwap` method: (1) sets the new writer, (2) replays buffered events with `seq > lastClientSeq`, (3) clears `detachedAt`, (4) cancels the TTL timer.

### Integration with existing apiAdapter

The existing `apiAdapter.ts` WebSocket logic will be wrapped in a `ReconnectableWebSocket` class that manages heartbeat, reconnection backoff, and resume handshake. The adapter's consumer code sees the same message stream interface — reconnection is transparent.

## Implementation approach

1. **Phase 1 — protocol types**: Define all message types (`ResumeMessage`, `SessionEvent`, `ResumeAck`, heartbeat) and the `RingBuffer` for event buffering. Unit tests for ring buffer overflow and sequence tracking.
2. **Phase 2 — client reconnection**: Implement `ReconnectableWebSocket` with heartbeat monitoring, exponential backoff, and the reconnection state machine. Unit tests for state transitions and backoff timing.
3. **Phase 3 — server session management**: Implement `ReconnectableSession` with event buffering, TTL expiry, and the `hotSwap` method. Unit tests for buffer replay and gap detection.
4. **Phase 4 — resume handshake**: Wire client reconnect to server resume — client sends `resume` with `lastSeq`, server validates and replays. Integration test with simulated disconnect/reconnect.
5. **Phase 5 — UI indicators**: Add connection status component showing connected/reconnecting/disconnected states with retry count.
6. **Phase 6 — apiAdapter integration**: Wrap existing WebSocket usage in `apiAdapter.ts` with `ReconnectableWebSocket`, ensuring zero breaking changes to consumers.

## Success criteria

- **SC-001**: A simulated network drop during an active streaming session reconnects within the backoff window and the client receives all buffered events without gaps.
- **SC-002**: A client that reconnects after 100 events were buffered receives exactly those 100 events in order, with no duplicates.
- **SC-003**: A client that fails to reconnect within max retries shows the disconnected UI and emits `session:disconnected`.
- **SC-004**: A session whose client disconnects for longer than the TTL is cleaned up and a subsequent resume attempt is rejected with a clear error.
- **SC-005**: The heartbeat detects a dead connection within (interval + timeout) seconds — default 20 seconds.
- **SC-006**: Event buffer overflow inserts a gap marker and the client is informed of the missing sequence range.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 045-claude-code-sdk-bridge | The SDK bridge produces the streaming events that flow over the WebSocket |
| 060-panel-event-bus | Connection state changes emit events on the panel event bus |

## Risk

- **R-001**: Proxy or CDN WebSocket timeout may be shorter than heartbeat interval, causing false disconnects. Mitigation: heartbeat interval is configurable and defaults to 15s, well within typical proxy timeouts (60s).
- **R-002**: Event buffer overflow during extended disconnects loses events. Mitigation: gap marker informs the client; the UI can offer a "refresh session state" action.
- **R-003**: Session TTL may be too short for laptop sleep scenarios. Mitigation: TTL is configurable; document recommended values for different deployment contexts.
- **R-004**: Race condition if two reconnect attempts arrive simultaneously. Mitigation: server locks the session during hot-swap; second attempt gets a retry-later response.
