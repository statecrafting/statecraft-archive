---
id: "060-panel-event-bus"
title: "Typed Inter-Panel Event Bus"
feature_branch: "060-panel-event-bus"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Typed inter-panel event bus enabling loose coupling between UI panels.
  Each panel type declares the events it can emit and the events it subscribes to.
  The bus maintains an event history, enforces type safety via declared capability
  contracts, and automatically excludes the source panel from receiving its own
  events. Typed event namespaces (terminal:command_executed, files:changed,
  git:operation_*) replace ad-hoc cross-panel communication.
code_aliases:
  - PANEL_EVENT_BUS
sources:
  - crystal
establishes:
  - unit: { kind: directory, path: product/packages/panel-event-bus }
references:
  - role: historical
    unit: { kind: file, path: product/apps/opc/src/lib/panelEventBus.ts }
---

# Feature Specification: Typed Inter-Panel Event Bus

## Purpose

Panels in the desktop application currently communicate through ad-hoc mechanisms — direct function calls, shared state, or parent-mediated prop drilling. This tight coupling makes it difficult to add new panel types, causes unintended re-renders, and makes event flow hard to trace. There is no formal contract for what events a panel can emit or consume, and no history of past events for panels that mount after an event has fired.

This feature introduces a typed event bus that sits between all panels. Each panel type declares its event capabilities (emit and subscribe), the bus enforces those contracts at runtime, maintains a bounded event history for late subscribers, and automatically prevents a panel from receiving events it emitted itself.

## Scope

### In scope

- **Event type registry**: A central registry of all typed event namespaces (e.g., `terminal:command_executed`, `files:changed`, `git:operation_commit`, `git:operation_push`) with payload schemas.
- **Panel capability declarations**: Each panel type declares which event types it emits and which it subscribes to. The bus rejects undeclared emit or subscribe attempts.
- **Source auto-exclusion**: When a panel emits an event, the bus does not deliver that event back to the emitting panel instance, even if it subscribes to that event type.
- **Event history**: A bounded ring buffer of recent events per type, so panels that mount after an event can replay missed events on subscription.
- **Wildcard subscriptions**: Support glob-style patterns (e.g., `git:operation_*`) to subscribe to a family of events.
- **Lifecycle integration**: Automatic unsubscription when a panel unmounts; no dangling listeners.

### Out of scope

- **Cross-window or cross-process events**: The bus operates within a single renderer process.
- **Persistent event storage**: Event history is in-memory only; it does not survive application restart.
- **Event transformation or middleware pipelines**: The bus is a delivery mechanism, not a processing pipeline.
- **Panel layout or rendering**: This feature does not change how panels are arranged or displayed.

## Requirements

### Functional

- **FR-001**: An `EventBus` singleton manages typed event registration, emission, and subscription across all panels.
- **FR-002**: Each event type is defined with a namespace string and a TypeScript payload type. The bus rejects emissions that do not match a registered event type.
- **FR-003**: Each panel type declares a `PanelEventContract` specifying `emits: EventType[]` and `subscribes: EventType[]`. The bus enforces these declarations at runtime.
- **FR-004**: When panel instance A emits event E, the bus delivers E to all other subscribed panel instances but never to instance A itself.
- **FR-005**: The bus maintains a configurable-size ring buffer (default 50 events per type) of recent events. When a panel subscribes, it can optionally replay the last N events of that type.
- **FR-006**: Wildcard subscriptions using glob patterns (e.g., `git:operation_*`) match all event types fitting the pattern.
- **FR-007**: When a panel unmounts, all its subscriptions are automatically removed.
- **FR-008**: The bus exposes a `history(eventType, count)` method to query past events without subscribing.

### Non-functional

- **NF-001**: Event delivery adds < 1ms overhead per event in the common case (fewer than 20 subscribers).
- **NF-002**: The ring buffer memory footprint stays under 2 MB for the default configuration.
- **NF-003**: The bus is safe for concurrent emissions from async panel code (serialized delivery order within each event type).

## Architecture

### Event type definitions

```typescript
/** Namespace-qualified event type identifier. */
type EventTypeName = string; // e.g., "terminal:command_executed"

/** Schema entry for a registered event type. */
interface EventTypeSchema<T = unknown> {
  name: EventTypeName;
  payloadSchema: T; // TypeScript type or runtime validator
}

/** An emitted event instance. */
interface BusEvent<T = unknown> {
  id: string;
  type: EventTypeName;
  payload: T;
  sourcePanel: PanelInstanceId;
  timestamp: number;
}

/** What a panel declares about its event interactions. */
interface PanelEventContract {
  panelType: string;
  emits: EventTypeName[];
  subscribes: EventTypeName[];
}

type PanelInstanceId = string;
type EventHandler<T = unknown> = (event: BusEvent<T>) => void;
```

### Core event types

```
terminal:command_executed    — A command finished in a terminal panel
terminal:output_received     — New output appeared in a terminal panel
files:changed               — File(s) created, modified, or deleted
files:opened                — A file was opened in the editor panel
files:saved                 — A file was saved
git:operation_commit        — A git commit was made
git:operation_push          — A git push completed
git:operation_pull          — A git pull completed
git:operation_branch        — A branch was created or switched
agent:message_received      — An agent produced a response
agent:tool_invoked          — An agent invoked a tool
```

### Event bus interface

```typescript
interface EventBus {
  registerEventType(schema: EventTypeSchema): void;
  registerPanel(instanceId: PanelInstanceId, contract: PanelEventContract): void;
  unregisterPanel(instanceId: PanelInstanceId): void;

  emit<T>(sourcePanel: PanelInstanceId, type: EventTypeName, payload: T): void;
  subscribe<T>(
    subscriberPanel: PanelInstanceId,
    pattern: EventTypeName, // supports globs
    handler: EventHandler<T>,
    options?: { replay?: number }
  ): () => void; // returns unsubscribe function

  history(type: EventTypeName, count?: number): BusEvent[];
}
```

### Delivery flow

```
Panel A emits "files:changed"
  |
  v
EventBus.emit(panelA_id, "files:changed", payload)
  |
  +---> Validate: panelA contract declares "files:changed" in emits
  +---> Store in ring buffer for "files:changed"
  +---> For each subscriber of "files:changed" (or matching glob):
          |
          +---> Skip if subscriber === panelA_id  (auto-exclusion)
          +---> Deliver BusEvent to handler
```

## Implementation approach

1. **Phase 1 — event type registry and bus core**: Define `EventTypeSchema`, `BusEvent`, implement the `EventBus` class with register, emit, subscribe, and ring buffer.
2. **Phase 2 — panel contract enforcement**: Add `PanelEventContract` validation so undeclared emits or subscribes throw at registration time.
3. **Phase 3 — source auto-exclusion and wildcards**: Implement the source-panel filter and glob-pattern matching for subscriptions.
4. **Phase 4 — lifecycle integration**: Wire panel mount/unmount hooks to automatically register and unregister panels with the bus.
5. **Phase 5 — core event types**: Define and register the initial set of event types (terminal, files, git, agent) and update existing panels to emit through the bus.

## Success criteria

- **SC-001**: A terminal panel emitting `terminal:command_executed` causes subscribed file and git panels to receive the event, but the terminal panel itself does not.
- **SC-002**: A panel that mounts after three `files:changed` events can replay all three via the `replay` option.
- **SC-003**: A panel subscribing to `git:operation_*` receives `git:operation_commit`, `git:operation_push`, and `git:operation_pull` events.
- **SC-004**: Attempting to emit an event not declared in the panel's contract throws a descriptive error.
- **SC-005**: Unmounting a panel removes all its subscriptions; no handlers fire for that panel afterward.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 042-multi-provider-agent-registry | Agent events emitted on the bus originate from providers managed by the registry |

## Risk

- **R-001**: High-frequency events (e.g., `terminal:output_received`) could cause performance degradation with many subscribers. Mitigation: debounce or throttle options per subscription; ring buffer caps memory usage.
- **R-002**: Wildcard patterns could match unintended event types as new types are added. Mitigation: contract declarations limit which events a panel can subscribe to, even with wildcards.
- **R-003**: Event payload schemas may diverge across panels if not centrally maintained. Mitigation: all event types are registered centrally with typed schemas; runtime validation catches mismatches.
