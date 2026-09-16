/**
 * Factory project SSE stream (spec 110 §2.5 / §3 / §8 Rollout Phase 5).
 *
 * A project-scoped, text/event-stream endpoint the `oap-ctl run factory
 * --watch` CLI subscribes to in order to print stage transitions until the
 * pipeline reaches a terminal state. The web UI continues to use the
 * workspace-level WebSocket stream in `api/sync/sync.ts`; this endpoint is
 * narrower on purpose — pure HTTP for a minimal Node CLI, and filtered on
 * the server side so callers do not have to implement the project match.
 *
 * Authority (spec 087 §5.3):
 *   - Auth flows through the Encore gateway (`auth: true`). The handler
 *     resolves the authenticated workspace and rejects the request if the
 *     requested project does not belong to it.
 *   - Events are observations: lifecycle transitions from
 *     `FactoryEventTopic`, filtered to this project. No directives are
 *     carried on this channel.
 */

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { Subscription } from "encore.dev/pubsub";
import log from "encore.dev/log";
import type { ServerResponse } from "http";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  projects,
  factoryPipelines,
  factoryStages,
} from "../db/schema";
import { FactoryEventTopic, type FactoryPipelineEvent } from "./events";

// ---------------------------------------------------------------------------
// SSE framing
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 30_000;

export interface SseEventFrame {
  event: string;
  data: unknown;
  id?: string;
}

/**
 * Format a single server-sent event frame. Exported for unit tests; the
 * canonical grammar is `event:`, `data:`, optional `id:`, terminated with
 * a blank line per WHATWG SSE (§9.2).
 */
export function formatSseFrame(frame: SseEventFrame): string {
  const lines: string[] = [];
  lines.push(`event: ${frame.event}`);
  if (frame.id !== undefined) {
    lines.push(`id: ${frame.id}`);
  }
  const payload = typeof frame.data === "string"
    ? frame.data
    : JSON.stringify(frame.data);
  // Each `\n` in the payload must be split across multiple `data:` lines
  // so a JSON string that happens to contain a newline does not truncate
  // the event. JSON.stringify avoids this, but we keep the loop for the
  // string-payload case (heartbeats, error messages).
  for (const chunk of String(payload).split("\n")) {
    lines.push(`data: ${chunk}`);
  }
  lines.push("", "");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Project → subscriber registry
// ---------------------------------------------------------------------------

interface ProjectSubscriber {
  write(frame: SseEventFrame): boolean;
}

const projectSubscribers = new Map<string, Set<ProjectSubscriber>>();

function registerSubscriber(projectId: string, sub: ProjectSubscriber): void {
  if (!projectSubscribers.has(projectId)) {
    projectSubscribers.set(projectId, new Set());
  }
  projectSubscribers.get(projectId)!.add(sub);
}

function unregisterSubscriber(projectId: string, sub: ProjectSubscriber): void {
  const set = projectSubscribers.get(projectId);
  if (!set) return;
  set.delete(sub);
  if (set.size === 0) projectSubscribers.delete(projectId);
}

/**
 * Count of live subscribers for a project — exported for tests so they
 * can assert registration/unregistration symmetry without reaching into
 * module-private state.
 */
export function subscriberCountForProject(projectId: string): number {
  return projectSubscribers.get(projectId)?.size ?? 0;
}

function broadcastToProject(
  projectId: string,
  frame: SseEventFrame,
): void {
  const set = projectSubscribers.get(projectId);
  if (!set || set.size === 0) return;
  for (const sub of set) {
    if (!sub.write(frame)) {
      set.delete(sub);
    }
  }
}

// Exported for tests — lets an integration test inject a fake subscriber
// and assert the PubSub handler fans events out correctly.
export const __testing = {
  registerSubscriber,
  unregisterSubscriber,
  broadcastToProject,
  subscribers: projectSubscribers,
};

// ---------------------------------------------------------------------------
// Project org gate (spec 119)
// ---------------------------------------------------------------------------

async function assertProjectInOrg(
  projectId: string,
  orgId: string,
): Promise<void> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .limit(1);
  if (rows.length === 0) {
    throw APIError.notFound("project not found");
  }
}

// ---------------------------------------------------------------------------
// Initial snapshot
// ---------------------------------------------------------------------------

interface PipelineSnapshot {
  project_id: string;
  pipeline_id: string | null;
  status: string | null;
  adapter: string | null;
  current_stage: string | null;
  stages: Array<{ stage_id: string; status: string }>;
  started_at: string | null;
  completed_at: string | null;
}

async function buildSnapshot(projectId: string): Promise<PipelineSnapshot> {
  const pipelineRows = await db
    .select()
    .from(factoryPipelines)
    .where(eq(factoryPipelines.projectId, projectId))
    .orderBy(desc(factoryPipelines.createdAt))
    .limit(1);

  if (pipelineRows.length === 0) {
    return {
      project_id: projectId,
      pipeline_id: null,
      status: null,
      adapter: null,
      current_stage: null,
      stages: [],
      started_at: null,
      completed_at: null,
    };
  }

  const pipeline = pipelineRows[0];
  const stageRows = await db
    .select()
    .from(factoryStages)
    .where(eq(factoryStages.pipelineId, pipeline.id))
    .orderBy(asc(factoryStages.stageId));

  let currentStage: string | null = null;
  for (const s of stageRows) {
    if (s.status === "in_progress") {
      currentStage = s.stageId;
      break;
    }
  }

  return {
    project_id: projectId,
    pipeline_id: pipeline.id,
    status: pipeline.status,
    adapter: pipeline.adapterName,
    current_stage: currentStage,
    stages: stageRows.map((s) => ({ stage_id: s.stageId, status: s.status })),
    started_at: pipeline.startedAt?.toISOString() ?? null,
    completed_at: pipeline.completedAt?.toISOString() ?? null,
  };
}

function isTerminalStatus(status: string | null | undefined): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

// ---------------------------------------------------------------------------
// SSE endpoint
// ---------------------------------------------------------------------------

export const factoryProjectStream = api.raw(
  {
    expose: true,
    method: "GET",
    path: "/api/projects/:id/factory/stream",
    auth: true,
  },
  async (req, res) => {
    const auth = getAuthData()!;
    if (!auth.orgId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "org context required" }));
      return;
    }

    // Extract :id from the URL path. Encore leaves the matched path on
    // `req.url` — the leading segment after `/api/projects/` is the id we
    // registered on the route.
    const url = new URL(req.url ?? "", `http://${req.headers.host ?? "local"}`);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    // Expected: ["api", "projects", "<id>", "factory", "stream"]
    const projectId = pathSegments[2];

    if (!projectId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "missing project id in path" }));
      return;
    }

    try {
      await assertProjectInOrg(projectId, auth.orgId);
    } catch (err) {
      const code = err instanceof APIError && err.code === "not_found" ? 404 : 500;
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: err instanceof Error ? err.message : "project lookup failed",
      }));
      return;
    }

    // Open the SSE response.
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const rawRes = res as ServerResponse;
    const writeFrame = (frame: SseEventFrame): boolean => {
      if (rawRes.writableEnded || rawRes.destroyed) return false;
      try {
        return rawRes.write(formatSseFrame(frame));
      } catch {
        return false;
      }
    };

    // Prelude — hints to proxies that this is a live stream.
    rawRes.write(": stream opened\n\n");

    // Initial snapshot.
    try {
      const snapshot = await buildSnapshot(projectId);
      writeFrame({ event: "snapshot", data: snapshot });

      if (isTerminalStatus(snapshot.status)) {
        writeFrame({ event: "closed", data: { reason: "already_terminal" } });
        rawRes.end();
        return;
      }
    } catch (err) {
      log.warn("factory stream: snapshot failed", {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      });
      writeFrame({
        event: "error",
        data: { message: "snapshot failed" },
      });
      rawRes.end();
      return;
    }

    // Register as a subscriber so the PubSub handler can fan events out.
    const subscriber: ProjectSubscriber = {
      write: writeFrame,
    };
    registerSubscriber(projectId, subscriber);
    log.info("factory stream: subscriber registered", {
      projectId,
      orgId: auth.orgId,
      total: subscriberCountForProject(projectId),
    });

    // Heartbeats keep proxies (and the CLI's stream iterator) from timing
    // the connection out during quiet periods between stage transitions.
    const heartbeat = setInterval(() => {
      if (!rawRes.writableEnded) {
        rawRes.write(`: heartbeat ${Date.now()}\n\n`);
      }
    }, HEARTBEAT_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(heartbeat);
      unregisterSubscriber(projectId, subscriber);
      log.info("factory stream: subscriber released", {
        projectId,
        remaining: subscriberCountForProject(projectId),
      });
    };

    req.on("close", cleanup);
    rawRes.on("close", cleanup);
  },
);

// ---------------------------------------------------------------------------
// PubSub fan-out
// ---------------------------------------------------------------------------

/**
 * Exported for tests — exercises the same branching the `Subscription`
 * handler does, without requiring the test harness to push events through
 * the real PubSub broker.
 */
export function relayFactoryEventToSubscribers(
  event: FactoryPipelineEvent,
): void {
  broadcastToProject(event.project_id, {
    event: "pipeline_event",
    data: {
      pipeline_id: event.pipeline_id,
      project_id: event.project_id,
      event_type: event.event_type,
      stage_id: event.stage_id,
      actor: event.actor,
      details: event.details ?? {},
    },
  });

  if (
    event.event_type === "pipeline_completed" ||
    event.event_type === "pipeline_failed"
  ) {
    broadcastToProject(event.project_id, {
      event: "closed",
      data: { reason: event.event_type },
    });
  }
}

// Single process-local subscriber that fans FactoryEventTopic messages out
// to every connected SSE client. Naming it `factory-stream-relay` keeps it
// independent of the `sync-outbox-relay` subscription in api/sync/relay.ts
// — Encore delivers the event to both handlers.
const _streamRelay = new Subscription(FactoryEventTopic, "factory-stream-relay", {
  handler: async (event) => {
    relayFactoryEventToSubscribers(event);
  },
});
void _streamRelay;
