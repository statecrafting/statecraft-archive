// Spec 112 §7 / Phase 8 (amended by spec 119) — Project catalog sync relay
// (outbound only).
//
// Mirrors the spec 111 agent-catalog relay pattern. Two outbound paths:
//
//   create.ts / import.ts (post-insert)
//     -> publishProjectCatalogUpsert(input)
//        -> dispatchServerEvent(orgId, project.catalog.upsert)        // broadcast
//
//   handshake (duplex.ts)
//     -> sendProjectCatalogSnapshot(orgId, clientId)
//        -> sendTargetedServerEvent(orgId, clientId, project.catalog.upsert) per project
//
// Spec 112 §7 deliberately reuses one envelope for both live deltas
// and the post-handshake replay — the desktop merges by `projectId`,
// so a snapshot is just N upserts. Tombstones travel as upserts with
// `tombstone: true`.

import log from "encore.dev/log";
import { eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import { projectRepos, projects } from "../db/schema";
import {
  buildProjectCatalogUpsert,
  type ProjectRepoForCatalog,
  type ProjectRowForCatalog,
} from "./projectCatalog";
import { dispatchServerEvent, sendTargetedServerEvent } from "./service";
import { ENVELOPE_SCHEMA_VERSION } from "./types";

export interface PublishProjectCatalogUpsertInput {
  orgId: string;
  project: ProjectRowForCatalog;
  repo: ProjectRepoForCatalog | null;
  tombstone?: boolean;
}

export interface PublishProjectCatalogUpsertResult {
  eventId: string;
  cursor: string;
  delivered: number;
}

/**
 * Broadcast a project upsert to every OPC connected to the org.
 * Called from `createFactoryProject` and `importFactoryProject` after
 * their DB transactions commit so the wire and the rows can never end
 * up out of step.
 */
export async function publishProjectCatalogUpsert(
  input: PublishProjectCatalogUpsertInput
): Promise<PublishProjectCatalogUpsertResult> {
  const event = buildProjectCatalogUpsert({
    project: input.project,
    repo: input.repo,
    meta: {
      v: ENVELOPE_SCHEMA_VERSION,
      eventId: "",
      sentAt: "",
      orgId: "",
      orgCursor: "",
    },
    tombstone: input.tombstone === true,
  });
  // dispatchServerEvent stamps meta itself — strip the placeholder before handoff.
  const { meta: _meta, ...withoutMeta } = event;
  const result = await dispatchServerEvent(input.orgId, withoutMeta);
  log.info("project.catalog: upsert broadcast dispatched", {
    orgId: input.orgId,
    projectId: input.project.id,
    detectionLevel: input.project.detectionLevel,
    tombstone: input.tombstone === true,
    delivered: result.delivered,
  });
  return result;
}

/**
 * Build the directory of projects in an org as one upsert per row.
 * Each entry carries everything OPC needs to render its Projects panel
 * without a follow-up round-trip — repo metadata, opc:// deep link, and
 * a null `detectionLevel` (we don't persist the level on the row, so
 * snapshots leave the desktop to reconcile on open). Tombstoned rows
 * are excluded.
 */
export async function buildProjectCatalogSnapshotEntries(
  orgId: string
): Promise<
  Array<{
    project: ProjectRowForCatalog;
    repo: ProjectRepoForCatalog | null;
  }>
> {
  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      description: projects.description,
      factoryAdapterId: projects.factoryAdapterId,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.orgId, orgId));

  if (projectRows.length === 0) return [];

  const repoRows = await db
    .select({
      projectId: projectRepos.projectId,
      githubOrg: projectRepos.githubOrg,
      repoName: projectRepos.repoName,
      defaultBranch: projectRepos.defaultBranch,
      isPrimary: projectRepos.isPrimary,
    })
    .from(projectRepos);

  const reposByProject = new Map<string, ProjectRepoForCatalog>();
  for (const row of repoRows) {
    if (!row.isPrimary && reposByProject.has(row.projectId)) continue;
    reposByProject.set(row.projectId, {
      githubOrg: row.githubOrg,
      repoName: row.repoName,
      defaultBranch: row.defaultBranch,
    });
  }

  return projectRows.map((row) => ({
    project: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      factoryAdapterId: row.factoryAdapterId,
      detectionLevel: null,
      updatedAt: row.updatedAt,
    },
    repo: reposByProject.get(row.id) ?? null,
  }));
}

/**
 * Send a targeted project catalog snapshot to a single client. Called
 * from the duplex handshake after `sync.hello` so a reconnecting OPC
 * sees the full project list before any incremental upserts arrive.
 */
export async function sendProjectCatalogSnapshot(
  orgId: string,
  clientId: string
): Promise<{ delivered: number; entryCount: number }> {
  const entries = await buildProjectCatalogSnapshotEntries(orgId);
  let delivered = 0;
  for (const entry of entries) {
    const event = buildProjectCatalogUpsert({
      project: entry.project,
      repo: entry.repo,
      meta: {
        v: ENVELOPE_SCHEMA_VERSION,
        eventId: "",
        sentAt: "",
        orgId: "",
        orgCursor: "",
      },
      tombstone: false,
    });
    const { meta: _meta, ...withoutMeta } = event;
    const sent = await sendTargetedServerEvent(orgId, clientId, withoutMeta);
    if (sent) delivered++;
  }
  // Spec 112 §7 amendment — emit an explicit snapshot-complete terminator
  // so the desktop can flip its Projects panel out of "connecting" even when
  // the org has zero projects (entries === []) and no upsert frames went out.
  // The desktop reconciles by projectId regardless; this frame's payload is
  // informational (entryCount + generatedAt). Fire-and-log: a failure here
  // must not stop the duplex session.
  const completeFrame = {
    kind: "project.catalog.snapshot.complete" as const,
    orgId,
    entryCount: entries.length,
    generatedAt: new Date().toISOString(),
  };
  await sendTargetedServerEvent(orgId, clientId, completeFrame).catch((err) => {
    log.warn("project.catalog: snapshot.complete send failed", {
      orgId,
      clientId,
      err: err instanceof Error ? err.message : String(err),
    });
  });
  log.info("project.catalog: snapshot sent on handshake", {
    orgId,
    clientId,
    entryCount: entries.length,
    delivered,
  });
  return { delivered, entryCount: entries.length };
}
