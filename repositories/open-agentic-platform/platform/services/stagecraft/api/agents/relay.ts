/**
 * Spec 123 — Agent catalog sync relay (outbound only, org-scoped).
 *
 * Two outbound paths:
 *
 *   publishAgent / retireAgent (catalog.ts)
 *     -> publishAgentCatalogUpdated(row)
 *        -> dispatchServerEvent(orgId, agent.catalog.updated)            // broadcast to org
 *
 *   handshake (duplex.ts)
 *     -> sendAgentCatalogSnapshot(orgId, clientId)                      // targeted
 *        -> sendTargetedServerEvent(orgId, clientId, agent.catalog.snapshot)
 *
 * The snapshot is a directory (hashes only, no bodies) of every published
 * agent in the org. Desktops pull full bodies for cache misses via
 * `agent.catalog.fetch_request` — served by `serveAgentCatalogFetch` in
 * sync/service.ts. This module deliberately owns outbound only.
 */
import log from "encore.dev/log";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  factoryArtifactSubstrate,
  factoryBindings,
  projects,
  type AgentCatalogStatus,
} from "../db/schema";
import {
  dispatchServerEvent,
  sendTargetedServerEvent,
} from "../sync/service";
import type {
  AgentCatalogSnapshotEntry,
  ProjectAgentBindingSnapshotEntry,
  ServerAgentCatalogUpdated,
  ServerAgentCatalogSnapshot,
  ServerProjectAgentBindingSnapshot,
  ServerProjectAgentBindingUpdated,
} from "../sync/types";
import type { CatalogFrontmatter } from "./frontmatter";

// Spec 139 Phase 4 (T091) — agent rows are projected from the substrate.
// `AgentRow` is the wire-side shape catalog.ts produces via
// `toWireForRelay`; defined structurally so the relay doesn't import the
// retired `agent_catalog` Drizzle export.
export type AgentRow = {
  id: string;
  orgId: string;
  name: string;
  version: number;
  status: AgentCatalogStatus;
  contentHash: string;
  frontmatter: Record<string, unknown>;
  bodyMarkdown: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type BindingRow = {
  id: string;
  projectId: string;
  orgAgentId: string;
  pinnedVersion: number;
  pinnedContentHash: string;
  boundBy: string;
  boundAt: Date;
};

// ---------------------------------------------------------------------------
// Envelope construction
// ---------------------------------------------------------------------------

function buildUpdatedEvent(
  row: AgentRow,
): Omit<ServerAgentCatalogUpdated, "meta"> {
  // Spec 111 §2.3: only published/retired rows travel the wire.
  if (row.status !== "published" && row.status !== "retired") {
    log.error("agent.catalog: refusing to relay non-terminal status", {
      agentId: row.id,
      status: row.status,
    });
    throw new Error(
      `cannot relay agent with status=${row.status}; only published|retired are valid`,
    );
  }
  return {
    kind: "agent.catalog.updated",
    agentId: row.id,
    orgId: row.orgId,
    name: row.name,
    version: row.version,
    status: row.status as "published" | "retired",
    contentHash: row.contentHash,
    frontmatter: row.frontmatter as CatalogFrontmatter,
    bodyMarkdown: row.bodyMarkdown,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Outbound: publish / retire broadcasts
// ---------------------------------------------------------------------------

export interface PublishAgentCatalogUpdatedResult {
  eventId: string;
  cursor: string;
  delivered: number;
}

/**
 * Broadcast a published or retired agent to every OPC connected to the
 * agent's org. Called from `publishAgent` and `retireAgent` after their
 * DB transactions commit — order matters, so a failed broadcast never
 * leaves the catalog and the wire out of step.
 */
export async function publishAgentCatalogUpdated(
  row: AgentRow,
): Promise<PublishAgentCatalogUpdatedResult> {
  const event = buildUpdatedEvent(row);
  const result = await dispatchServerEvent(row.orgId, event);
  log.info("agent.catalog: updated broadcast dispatched", {
    orgId: row.orgId,
    agentId: row.id,
    name: row.name,
    version: row.version,
    status: row.status,
    delivered: result.delivered,
  });
  return result;
}

// ---------------------------------------------------------------------------
// Snapshot construction (directory of currently-published entries)
// ---------------------------------------------------------------------------

/**
 * Build the directory of currently-published agents in an org. Returns
 * hashes only — the bodies are pulled lazily by the desktop via
 * `agent.catalog.fetch_request` (spec 111 §2.3). Retired agents are
 * excluded so the desktop infers removal from absence.
 */
export async function buildAgentCatalogSnapshotEntries(
  orgId: string,
): Promise<AgentCatalogSnapshotEntry[]> {
  // Spec 139 Phase 4 (T091): published-only filter realised by
  // `frontmatter.publication_status='published'` (Phase 2 mirror seeded
  // this; Phase 4 catalog.ts handlers maintain it). Substrate `status`
  // alone collapses draft+published to `active`, so the publication
  // ternary lives in frontmatter for substrate-direct consumers.
  const rows = await db
    .select({
      id: factoryArtifactSubstrate.id,
      orgId: factoryArtifactSubstrate.orgId,
      path: factoryArtifactSubstrate.path,
      version: factoryArtifactSubstrate.version,
      contentHash: factoryArtifactSubstrate.contentHash,
      frontmatter: factoryArtifactSubstrate.frontmatter,
      updatedAt: factoryArtifactSubstrate.updatedAt,
    })
    .from(factoryArtifactSubstrate)
    .where(
      and(
        eq(factoryArtifactSubstrate.orgId, orgId),
        eq(factoryArtifactSubstrate.origin, "user-authored"),
        eq(factoryArtifactSubstrate.kind, "agent"),
        eq(factoryArtifactSubstrate.status, "active"),
      ),
    );

  return rows
    .filter((r) => {
      const fm = r.frontmatter as Record<string, unknown> | null;
      return fm?.publication_status === "published";
    })
    .map((r) => {
      const name = r.path.startsWith("user-authored/")
        ? r.path.slice("user-authored/".length, r.path.length - ".md".length)
        : r.path;
      return {
        agentId: r.id,
        orgId: r.orgId,
        name,
        version: r.version,
        status: "published" as const,
        contentHash: r.contentHash,
        updatedAt: r.updatedAt.toISOString(),
      };
    });
}

/**
 * Send a targeted `agent.catalog.snapshot` to a single client. Called from
 * the duplex handshake after `sync.hello` so a reconnecting desktop can
 * diff against its local cache before any catalog deltas stream in.
 */
export async function sendAgentCatalogSnapshot(
  orgId: string,
  clientId: string,
): Promise<boolean> {
  const entries = await buildAgentCatalogSnapshotEntries(orgId);
  const event: Omit<ServerAgentCatalogSnapshot, "meta"> = {
    kind: "agent.catalog.snapshot",
    entries,
    generatedAt: new Date().toISOString(),
  };
  const sent = await sendTargetedServerEvent(orgId, clientId, event);
  log.info("agent.catalog: snapshot sent on handshake", {
    orgId,
    clientId,
    entryCount: entries.length,
    delivered: sent,
  });
  return sent;
}

// ---------------------------------------------------------------------------
// Spec 123 §7.2 — Project agent binding broadcasts
// ---------------------------------------------------------------------------

/**
 * Broadcast a binding mutation to every OPC connected to the project's org.
 * Desktop-side filters by `projectId` to apply only to the project the user
 * has active. The fan-out keys on org because that's the duplex session
 * scope; per-project routing is the desktop's responsibility.
 */
export async function publishProjectAgentBindingUpdated(args: {
  orgId: string;
  projectId: string;
  binding: BindingRow;
  agentName: string;
  action: "bound" | "rebound" | "unbound";
}): Promise<{ eventId: string; cursor: string; delivered: number }> {
  const event: Omit<ServerProjectAgentBindingUpdated, "meta"> = {
    kind: "project.agent_binding.updated",
    orgId: args.orgId,
    projectId: args.projectId,
    bindingId: args.binding.id,
    orgAgentId: args.binding.orgAgentId,
    agentName: args.agentName,
    pinnedVersion: args.binding.pinnedVersion,
    pinnedContentHash: args.binding.pinnedContentHash,
    action: args.action,
    boundAt: args.binding.boundAt.toISOString(),
  };
  const result = await dispatchServerEvent(args.orgId, event);
  log.info("agent.binding: updated broadcast dispatched", {
    orgId: args.orgId,
    projectId: args.projectId,
    bindingId: args.binding.id,
    action: args.action,
    delivered: result.delivered,
  });
  return result;
}

/**
 * Build the directory of bindings for one project. Carries no body or
 * frontmatter — the desktop joins entries against the org-wide catalog
 * snapshot to materialise the active agent set.
 */
export async function buildProjectAgentBindingSnapshotEntries(
  projectId: string,
): Promise<ProjectAgentBindingSnapshotEntry[]> {
  // Spec 139 Phase 4 (T091): bindings projected from substrate via
  // `factory_bindings` ⨝ `factory_artifact_substrate`. The legacy
  // `org_agent_id` field on the wire is preserved (Phase 2 migration
  // preserved `agent_catalog.id` as `factory_artifact_substrate.id`
  // so the field's UUID is still meaningful to existing consumers).
  const rows = await db
    .select({
      bindingId: factoryBindings.id,
      artifactId: factoryBindings.artifactId,
      pinnedVersion: factoryBindings.pinnedVersion,
      pinnedContentHash: factoryBindings.pinnedContentHash,
      path: factoryArtifactSubstrate.path,
    })
    .from(factoryBindings)
    .innerJoin(
      factoryArtifactSubstrate,
      eq(factoryArtifactSubstrate.id, factoryBindings.artifactId),
    )
    .where(eq(factoryBindings.projectId, projectId));

  return rows.map((r) => {
    const agentName = r.path.startsWith("user-authored/")
      ? r.path.slice("user-authored/".length, r.path.length - ".md".length)
      : r.path;
    return {
      bindingId: r.bindingId,
      orgAgentId: r.artifactId,
      agentName,
      pinnedVersion: r.pinnedVersion,
      pinnedContentHash: r.pinnedContentHash,
    };
  });
}

/**
 * Send the per-project binding snapshot to one connected client. Called
 * once per project the user has access to, immediately after the catalog
 * snapshot, on handshake or explicit resync.
 */
export async function sendProjectAgentBindingSnapshot(
  orgId: string,
  projectId: string,
  clientId: string,
): Promise<boolean> {
  const bindings = await buildProjectAgentBindingSnapshotEntries(projectId);
  const event: Omit<ServerProjectAgentBindingSnapshot, "meta"> = {
    kind: "project.agent_binding.snapshot",
    orgId,
    projectId,
    bindings,
    generatedAt: new Date().toISOString(),
  };
  const sent = await sendTargetedServerEvent(orgId, clientId, event);
  log.info("agent.binding: snapshot sent on handshake", {
    orgId,
    projectId,
    clientId,
    bindingCount: bindings.length,
    delivered: sent,
  });
  return sent;
}

/**
 * List every project an OPC session needs binding snapshots for. Returns
 * project ids in the connected user's org. Called from the duplex
 * handshake; the resync path uses the same lookup.
 */
export async function listProjectIdsForOrg(orgId: string): Promise<string[]> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.orgId, orgId));
  return rows.map((r) => r.id);
}
