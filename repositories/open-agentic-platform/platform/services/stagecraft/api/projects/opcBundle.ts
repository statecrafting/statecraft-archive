// Spec 112 §6.3 (amended by spec 119) — Open-in-OPC handoff bundle endpoint.
//
// Returns the resolution OPC needs after activating an `opc://` deep link:
//   - project + primary repo (clone URL)
//   - the precomputed deep link the statecraft UI also surfaces
//   - the factory_adapters row referenced by projects.factory_adapter_id
//     (null for non-factory projects — the endpoint still works)
//   - org-scoped factory_contracts and factory_processes (latest sync per
//     name, mirroring the spec 108 browser behaviour)
//   - project-scoped agent catalog (status='published')
//   - a short-lived clone token (spec 112 §6.4) OPC threads into both
//     the git clone subprocess and the factory engine launch
//
// Per-project agent overrides and adapter-declared agent compatibility
// filters are out of scope here (spec 112 §6.3 step 3, "Agents") — the
// bundle returns the project's full published catalog and lets OPC
// decide. A future spec will narrow this.
//
// Authority posture: org-scoped via getAuthData(). The project must
// belong to the caller's org.

import { api, APIError } from "encore.dev/api";
import log from "encore.dev/log";
import { getAuthData } from "~encore/auth";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  factoryArtifactSubstrate,
  factoryBindings,
  projectRepos,
  projects,
} from "../db/schema";
import { parse as parseYaml } from "yaml";
import { loadSubstrateForOrg } from "../factory/substrateBrowser";
import {
  findEnvelopeProcess,
  listAdapterViews,
  manifestHasSchemaVersion,
} from "../factory/adapterView";
import {
  collectConsumedOverrides,
  isFactoryAdmitted,
  loadLatestAdmission,
} from "../factory/admission";
import { sweepContentHashRevocations } from "../factory/overrideScanCore";
import {
  buildOpcBundle,
  type BundleContractInput,
  type BundleProcessInput,
  type OpcBundleAdmission,
  type OpcBundleCloneToken,
  type OpcBundleResponse,
} from "./opcBundleHelpers";
import { resolveProjectToken } from "./tokenResolver";

interface OpcBundleRequest {
  projectId: string;
}

export const getProjectOpcBundle = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/opc-bundle",
  },
  async (req: OpcBundleRequest): Promise<OpcBundleResponse> => {
    const auth = getAuthData()!;

    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(eq(projects.id, req.projectId), eq(projects.orgId, auth.orgId))
      )
      .limit(1);

    if (!project) {
      throw APIError.notFound("project not found");
    }

    const [
      primaryRepo,
      adapterRow,
      contractRows,
      processRows,
      agentRows,
      admissionBlock,
    ] = await Promise.all([
      loadPrimaryRepo(project.id),
      project.factoryAdapterId
        ? loadAdapter(project.orgId, project.factoryAdapterId)
        : Promise.resolve(null),
      loadLatestContracts(project.orgId),
      loadLatestProcesses(project.orgId),
      loadPublishedAgents(project.id, project.orgId),
      loadAdmissionBlock(project.orgId),
    ]);

    const cloneToken = await resolveCloneTokenForBundle({
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: auth.userID,
      primaryRepo,
    });

    return buildOpcBundle({
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        orgId: project.orgId,
        factoryAdapterId: project.factoryAdapterId,
      },
      repo: primaryRepo,
      adapter: adapterRow,
      contracts: contractRows,
      processes: processRows,
      agents: agentRows,
      cloneToken,
      admission: admissionBlock,
    });
  }
);

// Spec 198 FR-014 — the standing admission + platform seal for the org's
// factory origin. The OPC engine verifies the seal against the published
// JWKS before trusting any factory content in this bundle; an unsealed
// admission (sealJws null) is refused engine-side, fail-closed. Returns
// null when no factory origin is configured or the factory is not
// admitted (its content is already excluded above).
//
// Spec 198 FR-013(c) — the block also carries the overrides the run will
// consume, predicate-checked first: when the admitted envelope declares
// `overrides.require_verified: true`, an unverified override fails this
// load (and therefore the whole bundle request) with an error naming the
// artifact and the predicate, fail-closed.
async function loadAdmissionBlock(
  orgId: string,
): Promise<OpcBundleAdmission | null> {
  const substrate = await loadSubstrateForOrg(orgId);
  if (!substrate.factoryOriginId) return null;
  const verdict = await isFactoryAdmitted(orgId, substrate.factoryOriginId);
  if (!verdict.admitted) return null;
  const state = await loadLatestAdmission(orgId, substrate.factoryOriginId);
  const consumedOverrides = await collectConsumedOverrides(
    orgId,
    substrate.factoryOriginId,
    state.composed,
  );
  return {
    origin: substrate.factoryOriginId,
    envelopeHash: state.envelopeHash,
    sealJws: state.sealJws,
    consumedOverrides,
  };
}

// ---------------------------------------------------------------------------
// Spec 112 §6.3 — lightweight deep-link sibling of getProjectOpcBundle
// ---------------------------------------------------------------------------
//
// The project-layout header's "Open in OPC" button consumes only two
// fields of the full bundle: the precomputed deep link and the adapter's
// display name. This endpoint returns exactly those.
//
// It deliberately does NOT mint a GitHub installation token
// (resolveCloneTokenForBundle) and does NOT load the org's contracts /
// processes / published agents. Under React Router v7 single-fetch the
// project layout loader revalidates on every navigation within a project,
// so wiring that header to the full bundle minted one installation token
// per hop (≈0.9–1.7s each) and loaded the org substrate three times for
// data the header never reads — avoidable GitHub-token churn and memory
// pressure. The full bundle remains the OPC-handoff payload; the header
// uses this.
interface OpcDeepLinkResponse {
  deepLink: string | null;
  adapterName: string | null;
}

export const getProjectOpcDeepLink = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/opc-deep-link",
  },
  async (req: OpcBundleRequest): Promise<OpcDeepLinkResponse> => {
    const auth = getAuthData()!;

    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(eq(projects.id, req.projectId), eq(projects.orgId, auth.orgId))
      )
      .limit(1);

    if (!project) {
      throw APIError.notFound("project not found");
    }

    const [primaryRepo, adapterRow] = await Promise.all([
      loadPrimaryRepo(project.id),
      project.factoryAdapterId
        ? loadAdapter(project.orgId, project.factoryAdapterId)
        : Promise.resolve(null),
    ]);

    // Reuse the canonical bundle builder so the deep-link derivation stays
    // byte-identical to the full endpoint; empty collections + a null
    // cloneToken are the only difference.
    const bundle = buildOpcBundle({
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        orgId: project.orgId,
        factoryAdapterId: project.factoryAdapterId,
      },
      repo: primaryRepo,
      adapter: adapterRow,
      contracts: [],
      processes: [],
      agents: [],
      cloneToken: null,
      admission: null,
    });

    return {
      deepLink: bundle.deepLink,
      adapterName: bundle.adapter?.name ?? null,
    };
  }
);

// ---------------------------------------------------------------------------
// Spec 112 §6.4 — clone-token refresh endpoint
// ---------------------------------------------------------------------------
//
// Lightweight sibling of the full bundle. OPC calls this to refresh
// an installation token within ~5 minutes of expiry, or after a 401
// from any GitHub call made through the cached token. Returns the
// same `OpcBundleCloneToken | null` shape the bundle exposes.

interface CloneTokenResponse {
  cloneToken: OpcBundleCloneToken | null;
}

export const refreshProjectCloneToken = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/clone-token",
  },
  async (req: OpcBundleRequest): Promise<CloneTokenResponse> => {
    const auth = getAuthData()!;

    const [project] = await db
      .select({
        id: projects.id,
        orgId: projects.orgId,
      })
      .from(projects)
      .where(
        and(eq(projects.id, req.projectId), eq(projects.orgId, auth.orgId))
      )
      .limit(1);

    if (!project) {
      throw APIError.notFound("project not found");
    }

    const primaryRepo = await loadPrimaryRepo(project.id);
    const cloneToken = await resolveCloneTokenForBundle({
      orgId: project.orgId,
      projectId: project.id,
      actorUserId: auth.userID,
      primaryRepo,
    });
    return { cloneToken };
  }
);

/**
 * Spec 112 §6.4.2 — resolve the clone token to ship in the bundle (or
 * the refresh endpoint). The long-lived PAT lives only in statecraft;
 * what crosses the wire is either an installation token (preferred,
 * ~1h TTL) or — when the target org has no App installation — a copy
 * of the project PAT (acknowledged in §10 risks). For repos with no
 * primary repo row we return null (the bundle still works for
 * non-factory projects), which OPC treats as "clone anonymously".
 *
 * Hard resolution failures (App broker timeout, PAT decrypt error)
 * surface as 503 — silent degradation to null would mis-classify as
 * "public repo" deep in OPC.
 */
async function resolveCloneTokenForBundle(args: {
  orgId: string;
  projectId: string;
  actorUserId: string;
  primaryRepo: { githubOrg: string; repoName: string; defaultBranch: string } | null;
}): Promise<OpcBundleCloneToken | null> {
  if (!args.primaryRepo) return null;

  let resolved;
  try {
    resolved = await resolveProjectToken({
      orgId: args.orgId,
      projectId: args.projectId,
      targetGithubOrgLogin: args.primaryRepo.githubOrg,
      permissions: { contents: "read", metadata: "read" },
    });
  } catch (err) {
    log.error("opc bundle: clone-token resolution failed hard", {
      orgId: args.orgId,
      projectId: args.projectId,
      githubOrg: args.primaryRepo.githubOrg,
      err: String(err),
    });
    throw APIError.unavailable(
      "Clone token could not be resolved. Check the GitHub App installation or the project PAT under /app/project/:id/settings/github-pat."
    );
  }

  if (!resolved) {
    // Anonymous-clone path — bundle returns null. OPC treats null as
    // "public repo, no auth". Distinct from the 503 above.
    return null;
  }

  // Spec 109 §8 — the resolver itself emits no audit event today; we
  // record one here so the audit trail captures *who* obtained a clone
  // token *for which project* and via which credential.
  await db.insert(auditLog).values({
    actorUserId: args.actorUserId,
    action: "project.token.resolved",
    targetType: "projects",
    targetId: args.projectId,
    metadata: {
      source: resolved.source,
      target_github_org: args.primaryRepo.githubOrg,
      expires_at: resolved.expiresAt?.toISOString() ?? null,
    },
  });

  return {
    value: resolved.token,
    source: resolved.source,
    expiresAt: resolved.expiresAt?.toISOString() ?? null,
  };
}

async function loadPrimaryRepo(projectId: string) {
  const rows = await db
    .select({
      githubOrg: projectRepos.githubOrg,
      repoName: projectRepos.repoName,
      defaultBranch: projectRepos.defaultBranch,
      isPrimary: projectRepos.isPrimary,
      createdAt: projectRepos.createdAt,
    })
    .from(projectRepos)
    .where(eq(projectRepos.projectId, projectId))
    .orderBy(desc(projectRepos.isPrimary), asc(projectRepos.createdAt));

  const pick = rows[0];
  if (!pick) return null;
  return {
    githubOrg: pick.githubOrg,
    repoName: pick.repoName,
    defaultBranch: pick.defaultBranch,
  };
}

// Spec 199 FR-006 — adapter / contract / process bundle inputs serve from
// the substrate BY KIND and by manifest-declared identity (thin consumer;
// the categorical projection is retired). The bundle path carries the same
// `schema_version` guard `getAdapter` has, and honours the spec 198
// admission gate: a non-admitted factory's content never reaches the
// desktop engine.
async function loadAdapter(orgId: string, adapterId: string) {
  const substrate = await loadSubstrateForOrg(orgId);
  const found = listAdapterViews(substrate).find(
    (a) => synthesiseAdapterId(orgId, a.name) === adapterId,
  );
  if (!found) return null;
  const admission = await isFactoryAdmitted(orgId, found.origin);
  if (!admission.admitted) {
    log.warn("opcBundle: adapter excluded — factory not admitted", {
      orgId,
      adapter: found.name,
      reason: admission.reason,
    });
    return null;
  }
  if (!manifestHasSchemaVersion(found)) {
    log.error("opcBundle: adapter manifest lacks schema_version — excluded", {
      orgId,
      adapter: found.name,
      path: found.path,
    });
    return null;
  }
  return {
    id: adapterId,
    name: found.name,
    version: found.version,
    sourceSha: found.sourceSha,
    syncedAt: new Date(),
    manifest: found.manifest,
  };
}

async function loadLatestContracts(orgId: string): Promise<BundleContractInput[]> {
  const substrate = await loadSubstrateForOrg(orgId);
  const admission = substrate.factoryOriginId
    ? await isFactoryAdmitted(orgId, substrate.factoryOriginId)
    : { admitted: false, reason: null };
  const out: BundleContractInput[] = [];
  const seen = new Set<string>();
  for (const row of substrate.rows) {
    if (row.kind !== "contract-schema") continue;
    if (row.origin !== "oap-self" && !admission.admitted) continue;
    const name = (row.path.split("/").pop() ?? row.path).replace(
      /\.schema\.(json|ya?ml)$/i,
      "",
    );
    if (seen.has(name)) continue;
    seen.add(name);
    let schema: unknown = null;
    try {
      schema = row.path.endsWith(".json")
        ? JSON.parse(row.upstreamBody)
        : parseYaml(row.upstreamBody);
    } catch {
      schema = null;
    }
    out.push({
      name,
      version: row.upstreamSha.slice(0, 12),
      sourceSha: row.upstreamSha,
      syncedAt: new Date(),
      schema,
    });
  }
  return out;
}

async function loadLatestProcesses(orgId: string): Promise<BundleProcessInput[]> {
  const substrate = await loadSubstrateForOrg(orgId);
  if (!substrate.factoryOriginId) return [];
  const admission = await isFactoryAdmitted(orgId, substrate.factoryOriginId);
  if (!admission.admitted) return [];
  const envelope = findEnvelopeProcess(substrate);
  if (!envelope) return [];
  // Spec 199 FR-004 — opaque-by-kind definition; no categorical assembly.
  const byKind: Record<string, Array<{ path: string; contentHash: string }>> =
    {};
  for (const row of substrate.rows) {
    if (row.origin !== substrate.factoryOriginId) continue;
    if (
      ![
        "governance-envelope",
        "pipeline-orchestrator",
        "process-stage",
        "agent",
        "skill",
      ].includes(row.kind)
    ) {
      continue;
    }
    (byKind[row.kind] ??= []).push({
      path: row.path,
      contentHash: row.contentHash,
    });
  }
  return [
    {
      name: envelope.name,
      version: substrate.factorySourceSha.slice(0, 12),
      sourceSha: substrate.factorySourceSha,
      syncedAt: new Date(),
      definition: { byKind },
    },
  ];
}

// Spec 139 Phase 4 (T091): project-scoped agents resolve via the
// substrate-direct path. The published-only filter is realised by
// `frontmatter.publication_status='published'` (set by Phase 2's
// mirror + Phase 4's catalog.ts handlers). Retired-upstream bindings
// (I-B3) stay readable but are excluded from the OPC active-agent
// bundle so OPC doesn't invoke a retired prompt.
async function loadPublishedAgents(projectId: string, orgId: string) {
  const rows = await db
    .select({
      id: factoryArtifactSubstrate.id,
      path: factoryArtifactSubstrate.path,
      version: factoryArtifactSubstrate.version,
      contentHash: factoryArtifactSubstrate.contentHash,
      frontmatter: factoryArtifactSubstrate.frontmatter,
      userBody: factoryArtifactSubstrate.userBody,
      effectiveBody: factoryArtifactSubstrate.effectiveBody,
      status: factoryArtifactSubstrate.status,
    })
    .from(factoryBindings)
    .innerJoin(
      factoryArtifactSubstrate,
      eq(factoryArtifactSubstrate.id, factoryBindings.artifactId),
    )
    .where(
      and(
        eq(factoryBindings.projectId, projectId),
        eq(factoryArtifactSubstrate.origin, "user-authored"),
        eq(factoryArtifactSubstrate.kind, "agent"),
        eq(factoryArtifactSubstrate.status, "active"),
      ),
    )
    .orderBy(asc(factoryArtifactSubstrate.path));

  // Filter to rows whose substrate frontmatter declares
  // publication_status='published'. Drafts are excluded by design.
  const published = rows.filter((r) => {
    const fm = r.frontmatter as Record<string, unknown> | null;
    return fm?.publication_status === "published";
  });

  // Spec 200 FR-003(c) — user-authored agent content joins the
  // content-hash revocation sweep at serve: a quarantined revision
  // refuses the bundle fail-closed (FR-010-class) rather than shipping
  // into OPC.
  const quarantine = await sweepContentHashRevocations(
    orgId,
    published.map((r) => r.contentHash),
  );
  if (quarantine) {
    const hit = published.find((r) => r.contentHash === quarantine.key);
    throw APIError.failedPrecondition(
      `agent '${hit?.path ?? "(unknown)"}' revision ${quarantine.key} is ` +
        `${quarantine.mode} (revocation ${quarantine.revocationId}) — lift ` +
        `the quarantine or publish a fixed revision ` +
        `(spec 198 FR-010 / spec 200 FR-003)`,
    );
  }

  return published
    .map((r) => {
      const fm = (r.frontmatter as Record<string, unknown> | null) ?? null;
      const stripped = fm ? { ...fm } : {};
      delete stripped.publication_status;
      // Recover the spec 111 catalog `name` from the substrate path.
      const name = r.path.startsWith("user-authored/")
        ? r.path.slice("user-authored/".length, r.path.length - ".md".length)
        : r.path;
      return {
        id: r.id,
        name,
        version: r.version,
        contentHash: r.contentHash,
        frontmatter: stripped,
        bodyMarkdown: r.userBody ?? r.effectiveBody,
      };
    });
}

/**
 * Spec 139 Phase 4 — must match `browse.ts::synthesiseId` so any consumer
 * that received the synthesised adapter id from `listAdapters` can use
 * it here without re-resolving by name.
 */
function synthesiseAdapterId(orgId: string, name: string): string {
  return `synthetic-adapter-${orgId.slice(0, 8)}-${name}`;
}

/**
 * Spec 108 keeps `factory_contracts` / `factory_processes` keyed on
 * (orgId, name, version). The catalog browser picks the latest synced
 * row per name (browse.ts §getContract / §getProcess). We mirror that
 * here so the bundle is consistent with what the UI shows.
 */
