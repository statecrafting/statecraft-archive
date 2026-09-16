/**
 * Event relay — subscribes to internal PubSub topics and dispatches the
 * corresponding ServerEnvelope variants through the outbox path.
 *
 * Adding a new server-originated event type means:
 *   1. Define the envelope variant in `types.ts`.
 *   2. Subscribe to the producing topic here and call `dispatchServerEvent`.
 *
 * Spec 119: scope key is `orgId`; per-event projectId
 * carries on each variant for desktop-side filtering.
 */
import { Subscription } from "encore.dev/pubsub";
import log from "encore.dev/log";
import { eq } from "drizzle-orm";
import { FactoryEventTopic } from "../factory/events";
import { db } from "../db/drizzle";
import { projects } from "../db/schema";
import { dispatchServerEvent } from "./service";
import { resolveKnowledgeBundlesForFactory } from "../knowledge/knowledge";
import type { EnvelopeBusinessDoc } from "./types";

// ---------------------------------------------------------------------------
// project_id -> org_id cache (TTL 5 min)
// ---------------------------------------------------------------------------

const PROJECT_ORG_TTL_MS = 5 * 60_000;
const projectOrgCache = new Map<
  string,
  { orgId: string | null; fetchedAt: number }
>();

async function resolveOrgId(projectId: string): Promise<string | null> {
  const now = Date.now();
  const cached = projectOrgCache.get(projectId);
  if (cached && now - cached.fetchedAt < PROJECT_ORG_TTL_MS) {
    return cached.orgId;
  }

  const [row] = await db
    .select({ orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const orgId = row?.orgId ?? null;
  projectOrgCache.set(projectId, { orgId, fetchedAt: now });
  return orgId;
}

// ---------------------------------------------------------------------------
// Factory pipeline events
// ---------------------------------------------------------------------------

const _factorySub = new Subscription(FactoryEventTopic, "sync-outbox-relay", {
  handler: async (event) => {
    const orgId = await resolveOrgId(event.project_id);
    if (!orgId) {
      log.warn("sync.relay: factory event with unknown project — skipping", {
        projectId: event.project_id,
        pipelineId: event.pipeline_id,
      });
      return;
    }

    await dispatchServerEvent(orgId, {
      kind: "factory.event",
      pipelineId: event.pipeline_id,
      projectId: event.project_id,
      eventType: event.event_type,
      stageId: event.stage_id,
      actor: event.actor,
      details: event.details,
    });
  },
});

// ---------------------------------------------------------------------------
// Factory run dispatch (spec 110 §2.1 + §8 Rollout Phase 3)
// ---------------------------------------------------------------------------

/**
 * Window after `requestedAt` during which a dispatched factory run request is
 * still actionable. After this deadline statecraft considers the pipeline
 * `abandoned` if the desktop has not transitioned it (spec 110 §2.1, open
 * question 2). One hour is conservative: longer than the 30s ack SLA by
 * enough margin to cover a desktop coming back online after a brief outage.
 */
const FACTORY_RUN_DEADLINE_MS = 60 * 60 * 1000;

export interface PublishFactoryRunRequestInput {
  orgId: string;
  projectId: string;
  pipelineId: string;
  adapter: string;
  actorUserId: string;
  knowledgeObjectIds: string[];
  businessDocs: EnvelopeBusinessDoc[];
  policyBundleId: string;
}

export interface PublishFactoryRunRequestResult {
  eventId: string;
  cursor: string;
  delivered: number;
}

/**
 * Dispatch a `factory.run.request` to the org's connected OPCs (spec
 * 110 §2.1, amended by spec 119). Resolves attached knowledge object ids
 * into presigned-URL bundles before minting the envelope, so a desktop
 * consumer can materialise the blobs into its local cache without a second
 * round-trip.
 *
 * Callers (factory.initPipeline) MUST gate this on
 * `pipeline.source === "statecraft"` — OPC-direct runs do not use the
 * envelope path.
 */
export async function publishFactoryRunRequest(
  input: PublishFactoryRunRequestInput
): Promise<PublishFactoryRunRequestResult> {
  const knowledge = await resolveKnowledgeBundlesForFactory(
    input.projectId,
    input.knowledgeObjectIds
  );

  const now = new Date();
  const deadline = new Date(now.getTime() + FACTORY_RUN_DEADLINE_MS);

  const result = await dispatchServerEvent(input.orgId, {
    kind: "factory.run.request",
    projectId: input.projectId,
    pipelineId: input.pipelineId,
    adapter: input.adapter,
    actorUserId: input.actorUserId,
    knowledge,
    businessDocs: input.businessDocs,
    policyBundleId: input.policyBundleId,
    requestedAt: now.toISOString(),
    deadlineAt: deadline.toISOString(),
  });

  log.info("sync.relay: factory.run.request dispatched", {
    orgId: input.orgId,
    pipelineId: input.pipelineId,
    adapter: input.adapter,
    knowledgeCount: knowledge.length,
    businessDocCount: input.businessDocs.length,
    delivered: result.delivered,
  });

  return result;
}
