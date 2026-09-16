/**
 * Sync service (spec 087 Phase 3, amended by spec 119).
 *
 * Provides:
 *  1. WebSocket relay (streamOut) — pushes org-scoped events to connected
 *     web and OPC clients.
 *  2. OPC event ingestion (HTTP POST) — receives desktop→web events.
 *  3. PubSub subscriber on FactoryEventTopic — fans out pipeline events to
 *     connected org streams.
 *
 * All streams are keyed by orgId. A connecting client must be authenticated
 * and carry an org context in their auth token.
 */

import { api, APIError, type StreamOut } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { Subscription } from "encore.dev/pubsub";
import log from "encore.dev/log";
import { FactoryEventTopic } from "../factory/events";
import { db } from "../db/drizzle";
import { auditLog } from "../db/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Events pushed from Statecraft to connected clients (web UI, OPC). */
interface SyncEvent {
  type: string;
  orgId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

/** Events pushed from OPC to Statecraft. */
interface OpcInboundEvent {
  type: string;
  orgId: string;
  projectId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// In-memory stream registry (org → connected clients)
// ---------------------------------------------------------------------------

// TODO: Process-local — for horizontal scale-out, replace with Redis pub/sub
// or Encore's built-in pub/sub fan-out to relay across instances.
const orgStreams = new Map<string, Set<StreamOut<SyncEvent>>>();

function registerStream(orgId: string, stream: StreamOut<SyncEvent>) {
  if (!orgStreams.has(orgId)) {
    orgStreams.set(orgId, new Set());
  }
  orgStreams.get(orgId)!.add(stream);
  log.info("stream registered", {
    orgId,
    activeStreams: orgStreams.get(orgId)!.size,
  });
}

function unregisterStream(orgId: string, stream: StreamOut<SyncEvent>) {
  const set = orgStreams.get(orgId);
  if (set) {
    set.delete(stream);
    if (set.size === 0) orgStreams.delete(orgId);
  }
  log.info("stream unregistered", {
    orgId,
    activeStreams: set?.size ?? 0,
  });
}

/** Broadcast an event to all streams connected to an org. */
export function broadcastToOrg(
  orgId: string,
  event: SyncEvent
): void {
  const streams = orgStreams.get(orgId);
  if (!streams || streams.size === 0) return;

  for (const stream of streams) {
    stream.send(event).catch(() => {
      // Dead stream — remove it; heartbeat loop will also clean up
      streams.delete(stream);
    });
  }
}

// ---------------------------------------------------------------------------
// WebSocket relay — org-scoped event stream (NF-005)
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const orgEventStream = api.streamOut<SyncEvent>(
  { path: "/api/sync/events", expose: true, auth: true },
  async (stream) => {
    const auth = getAuthData()!;
    const orgId = auth.orgId;

    if (!orgId) {
      await stream.send({
        type: "error",
        orgId: "",
        timestamp: new Date().toISOString(),
        payload: { message: "org context required" },
      });
      return;
    }

    registerStream(orgId, stream);

    try {
      // Keep the handler alive with a heartbeat loop.
      // When the client disconnects, stream.send() will throw,
      // breaking the loop and triggering cleanup.
      while (true) {
        await sleep(30_000);
        await stream.send({
          type: "heartbeat",
          orgId,
          timestamp: new Date().toISOString(),
          payload: {},
        });
      }
    } catch {
      // Client disconnected — expected
    } finally {
      unregisterStream(orgId, stream);
    }
  }
);

// ---------------------------------------------------------------------------
// OPC event ingestion — desktop → web (HTTP POST, fire-and-forget)
// ---------------------------------------------------------------------------

export const ingestOpcEvent = api(
  { expose: true, auth: true, method: "POST", path: "/api/sync/opc-events" },
  async (req: OpcInboundEvent): Promise<{ accepted: boolean }> => {
    const auth = getAuthData()!;

    if (!auth.orgId) {
      throw APIError.invalidArgument("org context required");
    }

    // Verify the event targets the authenticated org
    if (req.orgId !== auth.orgId) {
      throw APIError.permissionDenied("org mismatch");
    }

    // Record audit events to the audit log
    if (req.type === "audit_event") {
      await db.insert(auditLog).values({
        actorUserId: auth.userID,
        action: `opc.${req.payload.action ?? "event"}`,
        targetType: String(req.payload.targetType ?? "unknown"),
        targetId: String(req.payload.targetId ?? ""),
        metadata: req.payload,
      });
    }

    // Broadcast to any connected web UI clients watching this org
    broadcastToOrg(req.orgId, {
      type: req.type,
      orgId: req.orgId,
      timestamp: req.timestamp || new Date().toISOString(),
      payload: {
        ...req.payload,
        projectId: req.projectId,
        source: "opc",
      },
    });

    log.info("opc event ingested", {
      type: req.type,
      orgId: req.orgId,
      projectId: req.projectId,
    });

    return { accepted: true };
  }
);

// ---------------------------------------------------------------------------
// PubSub subscriber — fan out factory pipeline events to WebSocket clients
// ---------------------------------------------------------------------------

const _ = new Subscription(FactoryEventTopic, "sync-relay", {
  handler: async (event) => {
    // Resolve org ID from the project — factory events carry project_id
    // but not org_id. For efficiency, we broadcast to all orgs that have
    // active streams and let the client filter. In practice, a project
    // belongs to exactly one org.
    const syncEvent: SyncEvent = {
      type: "pipeline_event",
      orgId: "", // filled per-stream below
      timestamp: new Date().toISOString(),
      payload: {
        pipelineId: event.pipeline_id,
        projectId: event.project_id,
        eventType: event.event_type,
        stageId: event.stage_id,
        actor: event.actor,
        details: event.details,
      },
    };

    // Fan out to all connected orgs — each stream is scoped and the
    // client can filter by projectId. In a scaled deployment this would
    // use a project→org lookup cache.
    for (const [orgId, streams] of orgStreams) {
      const orgEvent = { ...syncEvent, orgId };
      for (const stream of streams) {
        stream.send(orgEvent).catch(() => {
          streams.delete(stream);
        });
      }
    }

    log.info("factory event relayed", {
      pipelineId: event.pipeline_id,
      eventType: event.event_type,
      streamCount: orgStreams.size,
    });
  },
});
