import { Topic } from "encore.dev/pubsub";

// ---------------------------------------------------------------------------
// Factory Pipeline Event Topic
// ---------------------------------------------------------------------------

export interface FactoryPipelineEvent {
  project_id: string;
  pipeline_id: string;
  event_type:
    | "pipeline_initialized"
    | "stage_confirmed"
    | "stage_rejected"
    | "pipeline_completed"
    | "pipeline_failed"
    | "deployment_triggered";
  stage_id?: string;
  actor?: string;
  details?: Record<string, unknown>;
}

export const FactoryEventTopic = new Topic<FactoryPipelineEvent>(
  "factory-event",
  {
    deliveryGuarantee: "at-least-once",
  }
);

// ---------------------------------------------------------------------------
// Factory Upstream Sync Request Topic (spec 109 §5)
//
// Published by POST /api/factory/upstreams/sync, consumed by the sync
// worker subscription. Carries only the run identifier — the worker loads
// the upstream config and token from Postgres, so the message payload
// stays immutable even if the org rotates its PAT mid-flight.
// ---------------------------------------------------------------------------

export interface FactorySyncRequest {
  syncRunId: string;
  orgId: string;
  triggeredBy: string;
}

export const FactorySyncRequestTopic = new Topic<FactorySyncRequest>(
  "factory-sync-request",
  {
    deliveryGuarantee: "at-least-once",
  }
);
