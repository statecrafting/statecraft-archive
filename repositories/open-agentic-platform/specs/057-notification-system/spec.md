---
id: "057-notification-system"
title: "Notification Orchestrator"
feature_branch: "057-notification-system"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Server-side event and notification system with event creation,
  preference-gated delivery, a 20-second deduplication window, and
  multi-channel delivery (native OS notifications, web push). Events carry
  provider, session, kind, severity, and deduplication key.
code_aliases:
  - NOTIFICATION_SYSTEM
establishes:
  - unit: { kind: directory, path: product/packages/notification-orchestrator }
references:
  - role: historical
    unit: { kind: file, path: product/apps/opc/src/lib/notificationOrchestrator.ts }
  - role: historical
    unit: { kind: file, path: product/apps/opc/src/lib/notificationChannels.ts }
---

# Feature Specification: Notification Orchestrator

## Purpose

Agent sessions produce events that users need to know about — task completion, errors, permission requests, long-running operation status. The claudecodeui consolidation source implements ad-hoc notification logic scattered across components with no central event schema, no deduplication, and no user preference controls. Users receive either too many notifications (repeated status updates) or too few (missed errors).

This feature introduces a centralized notification orchestrator that accepts typed events, deduplicates them within a configurable window, checks user delivery preferences, and routes to the appropriate channel (native OS notification, web push, in-app toast).

## Scope

### In scope

- **Event schema**: A structured `NotificationEvent` with provider, session, kind, severity, deduplication key, title, body, and metadata.
- **Event creation API**: A `notify()` function that any subsystem can call to emit a notification event.
- **Deduplication**: Events with the same `dedupeKey` within a 20-second sliding window are collapsed into a single delivery.
- **User preferences**: Per-kind and per-severity preference gates controlling which channels receive which events (e.g., suppress info-level task updates from native notifications but show them in-app).
- **Delivery channels**: Native OS notifications (Electron/Tauri), web push (service worker), and in-app toast.
- **Channel adapters**: Pluggable delivery backends so new channels can be added without modifying the orchestrator core.
- **Event log**: All events (delivered or suppressed) are logged for in-app history review.

### Out of scope

- **Email or SMS delivery**: Only local and web push channels are supported initially.
- **Notification UI components**: The toast and notification center UI widgets are separate front-end concerns; this feature defines the data flow and delivery logic.
- **Rich notification actions**: Interactive buttons within notifications (e.g., "Approve", "Retry") are deferred.
- **Cross-device sync**: Notification state is local to the running application instance.

## Requirements

### Functional

- **FR-001**: The `notify()` function accepts a `NotificationEvent` and returns a promise that resolves when delivery is complete or the event is suppressed.
- **FR-002**: Each `NotificationEvent` contains: `id` (UUID), `provider` (string), `sessionId` (string), `kind` (enum), `severity` (info | warning | error | critical), `dedupeKey` (string), `title` (string), `body` (string), `timestamp` (number), `metadata` (Record<string, unknown>).
- **FR-003**: Events with identical `dedupeKey` values arriving within 20 seconds of the first event in the window are suppressed; the window resets on each new duplicate.
- **FR-004**: The deduplication window duration is configurable (default 20 seconds).
- **FR-005**: User preferences are stored as a map of `{ kind, severity } -> channel[]` and are checked before delivery. A missing preference entry defaults to delivering on all channels.
- **FR-006**: Each delivery channel is implemented as a `ChannelAdapter` with a `deliver(event)` method, enabling new channels to be added without core changes.
- **FR-007**: All events (including suppressed duplicates) are persisted to an event log queryable by session, kind, severity, and time range.
- **FR-008**: The notification kind enum includes at least: `task_complete`, `task_error`, `permission_request`, `progress_update`, `system_alert`.

### Non-functional

- **NF-001**: End-to-end delivery latency (from `notify()` call to channel adapter invocation) is < 50ms p95 for non-suppressed events.
- **NF-002**: The deduplication index is memory-resident and handles up to 10,000 active deduplication keys without measurable overhead.
- **NF-003**: The event log supports retention of at least 30 days of events before automatic pruning.

## Architecture

### Event schema

```typescript
type NotificationKind =
  | "task_complete"
  | "task_error"
  | "permission_request"
  | "progress_update"
  | "system_alert";

type Severity = "info" | "warning" | "error" | "critical";

interface NotificationEvent {
  id: string;                         // UUID
  provider: string;                   // Provider that originated the event
  sessionId: string;                  // Owning agent session
  kind: NotificationKind;
  severity: Severity;
  dedupeKey: string;                  // Key for deduplication window
  title: string;                      // Short display title
  body: string;                       // Longer description
  timestamp: number;                  // Unix timestamp ms
  metadata: Record<string, unknown>;  // Arbitrary extra data
}
```

### Channel adapter interface

```typescript
interface ChannelAdapter {
  readonly channelId: string;         // e.g., "native", "web-push", "toast"
  deliver(event: NotificationEvent): Promise<void>;
  isAvailable(): boolean;             // Runtime check (e.g., Notification API permission)
}
```

### User preferences

```typescript
interface NotificationPreferences {
  rules: PreferenceRule[];
  defaultChannels: string[];          // Fallback if no rule matches
}

interface PreferenceRule {
  kind?: NotificationKind;            // Match specific kind, or all if omitted
  severity?: Severity;                // Match specific severity, or all if omitted
  channels: string[];                 // Channels to deliver to (empty = suppress)
}
```

### Package structure

```
packages/notification-orchestrator/
  src/
    index.ts                          -- Public API: notify(), configure()
    types.ts                          -- NotificationEvent, Severity, Kind, etc.
    orchestrator.ts                   -- Core dispatch logic
    deduplication/
      dedup-index.ts                  -- Sliding-window deduplication
    preferences/
      preference-engine.ts            -- Evaluate user preference rules
      store.ts                        -- Persist/load preferences
    channels/
      adapter.ts                      -- ChannelAdapter interface
      native.ts                       -- Electron/Tauri native notification adapter
      web-push.ts                     -- Service worker push adapter
      toast.ts                        -- In-app toast adapter
    log/
      event-log.ts                    -- Persistent event history
      pruner.ts                       -- Retention-based log pruning
```

### Event flow

```
Subsystem calls notify(event)
  |
  v
Deduplication check (dedupeKey + 20s window)
  |
  +-- duplicate --> log as suppressed, return
  |
  +-- new/unique --> continue
       |
       v
     Preference engine (kind + severity -> channels)
       |
       v
     For each enabled channel:
       |
       v
     ChannelAdapter.deliver(event)
       |
       v
     Event log (persist regardless of delivery outcome)
```

## Implementation approach

1. **Phase 1 -- types and orchestrator core**: Define `NotificationEvent`, `ChannelAdapter`, and the orchestrator dispatch loop with deduplication.
2. **Phase 2 -- deduplication**: Implement the sliding-window deduplication index with configurable window duration.
3. **Phase 3 -- preference engine**: Build the preference rule evaluator and persistence layer.
4. **Phase 4 -- channel adapters**: Implement native (Electron/Tauri), web push, and in-app toast adapters.
5. **Phase 5 -- event log**: Add persistent event logging with time-range queries and retention pruning.
6. **Phase 6 -- integration**: Wire `notify()` into agent session lifecycle events (task complete, error, permission request).

## Success criteria

- **SC-001**: Calling `notify()` with a `task_complete` event delivers a native OS notification when the app is in background.
- **SC-002**: Two events with the same `dedupeKey` sent 5 seconds apart result in exactly one delivery; a third event sent 25 seconds after the first results in a second delivery.
- **SC-003**: A user preference rule suppressing `info`-severity `progress_update` events from native notifications prevents delivery on that channel while still logging the event.
- **SC-004**: The event log retains all events (delivered and suppressed) and supports query by session and time range.
- **SC-005**: Adding a new channel adapter requires implementing a single interface with no changes to the orchestrator core.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 042-multi-provider-agent-registry | Provider id is included in events to identify which backend originated the notification |
| 035-agent-governed-execution | Governed execution lifecycle emits events that feed into the notification system |

## Risk

- **R-001**: Native notification permissions vary across operating systems and may be denied by the user. Mitigation: `isAvailable()` check on each adapter; graceful fallback to in-app toast when native is unavailable.
- **R-002**: Aggressive deduplication may suppress important repeated events (e.g., multiple distinct errors with similar keys). Mitigation: deduplication operates on exact `dedupeKey` match, not fuzzy similarity; callers choose keys carefully.
- **R-003**: High event volume from multiple concurrent sessions may overwhelm the notification channels. Mitigation: preference-based suppression reduces noise; rate limiting can be added per channel as a follow-on.
