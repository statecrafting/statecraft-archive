/**
 * Sync protocol types (spec 087 section 5).
 *
 * WebSocket relay on Statecraft pushes events to connected OPC instances,
 * scoped by workspace. OPC pushes state updates via HTTP POST.
 */

// ---------------------------------------------------------------------------
// WebSocket events (Statecraft → OPC)
// ---------------------------------------------------------------------------

export type WorkspaceEventType =
  | "policy_changed"
  | "gate_approved"
  | "gate_rejected"
  | "deploy_status"
  | "knowledge_object_ready"
  | "connector_sync_complete"
  | "member_added"
  | "member_removed"
  | "project_updated";

export interface WorkspaceEvent {
  type: WorkspaceEventType;
  orgId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// HTTP POST events (OPC → Statecraft)
// ---------------------------------------------------------------------------

export type OpcEventType =
  | "stage_complete"
  | "token_spend"
  | "artifact_hash"
  | "audit_event"
  | "pipeline_status";

export interface OpcEvent {
  type: OpcEventType;
  orgId: string;
  projectId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Authoritative ownership (spec 087 section 5.1)
// ---------------------------------------------------------------------------

export type SyncDirection = "web_to_desktop" | "desktop_to_web" | "local_only";

export interface SyncDomain {
  domain: string;
  authoritative: "web" | "desktop";
  direction: SyncDirection;
}

export const SYNC_DOMAINS: SyncDomain[] = [
  { domain: "identity", authoritative: "web", direction: "web_to_desktop" },
  { domain: "policy", authoritative: "web", direction: "web_to_desktop" },
  { domain: "audit", authoritative: "web", direction: "desktop_to_web" },
  { domain: "knowledge_objects", authoritative: "web", direction: "web_to_desktop" },
  { domain: "pipeline_state", authoritative: "desktop", direction: "desktop_to_web" },
  { domain: "artifacts", authoritative: "desktop", direction: "desktop_to_web" },
  { domain: "checkpoints", authoritative: "desktop", direction: "local_only" },
  { domain: "git_state", authoritative: "desktop", direction: "local_only" },
];
