import { api } from "encore.dev/api";
import { secret } from "encore.dev/config";
import log from "encore.dev/log";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "../db/drizzle";
import {
  projectRepos,
  organizations,
  environments,
  projectArtifacts,
  githubInstallations,
  orgMemberships,
  users,
  auditLog,
} from "../db/schema";
import { eq, and } from "drizzle-orm";
import {
  createPreviewDeployment,
  destroyPreviewDeployment,
  isDeploydConfigured,
} from "../deploy/deploydClient";
import {
  createDeploymentRecord,
  getLatestDeploymentForEnv,
  mapDeploydStatus,
  updateDeploymentRecord,
} from "../deploy/deployments";
import {
  deriveArtifactRef,
  derivePreviewRef,
  type ArtifactVariant,
} from "../deploy/artifacts";
import { brokerInstallationToken, OAP_BUILD_WORKFLOW_NAME } from "./repoInit";
import { revokeOrgMembership } from "./teamSync";

const GITHUB_API = "https://api.github.com";

const webhookSecret = secret("GITHUB_WEBHOOK_SECRET");

// POST /api/github/webhook — receive GitHub webhook events
export const handleWebhook = api.raw(
  { expose: true, method: "POST", path: "/api/github/webhook", auth: false },
  async (req, resp) => {
    // Read raw body (required for HMAC verification over exact bytes)
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString("utf-8");

    // Verify HMAC-SHA256 signature
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    if (!verifySignature(body, signature)) {
      resp.writeHead(401, { "Content-Type": "text/plain" });
      resp.end("Invalid signature");
      return;
    }

    const event = req.headers["x-github-event"] as string | undefined;
    const delivery = req.headers["x-github-delivery"] as string | undefined;

    if (!event) {
      resp.writeHead(400, { "Content-Type": "text/plain" });
      resp.end("Missing x-github-event header");
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      resp.writeHead(400, { "Content-Type": "text/plain" });
      resp.end("Invalid JSON body");
      return;
    }

    log.info("GitHub webhook received", {
      event,
      delivery: delivery ?? "unknown",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      action: (payload as any)?.action ?? null,
    });

    try {
      await dispatchEvent(event, payload);
      resp.writeHead(200, { "Content-Type": "text/plain" });
      resp.end("ok");
    } catch (e) {
      log.error("Webhook handler failed", { event, error: String(e) });
      resp.writeHead(500, { "Content-Type": "text/plain" });
      resp.end("Internal error");
    }
  }
);

function verifySignature(body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const sec = webhookSecret();
  const expected =
    "sha256=" + createHmac("sha256", sec).update(body).digest("hex");

  // Constant-time comparison to prevent timing attacks
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    // Buffers differ in length — signature is invalid
    return false;
  }
}

async function dispatchEvent(event: string, payload: unknown): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = payload as any;

  switch (event) {
    case "installation":
      await handleInstallationEvent(p);
      break;

    case "repository":
      if (p.action === "created") {
        // Spec 213 FR-009: one GitHub repo maps to exactly one project, and a
        // newly-created repo has no inherent owning project. The create/clone/
        // import flows already insert the owning project's primary
        // project_repos row, so this webhook must NOT speculatively link the
        // new repo to an arbitrary project in the org. The previous
        // org-scoped `.limit(1)` pick raced project creation and
        // cross-attributed builds to whichever project happened to exist
        // first (e.g. a new repo created for project B was linked onto an
        // unrelated project A, which then resolved B's image at deploy time).
        // If the repo is already registered, refresh its installation id;
        // otherwise leave it unlinked for an explicit import/link.
        const existing = await findRepoRow(p.repository.full_name);
        const installId = p.installation?.id ?? null;
        if (existing) {
          if (installId !== null && existing.githubInstallId !== installId) {
            await db
              .update(projectRepos)
              .set({ githubInstallId: installId, updatedAt: new Date() })
              .where(eq(projectRepos.id, existing.id));
          }
          log.info("repository.created: repo already registered", {
            repo: p.repository.full_name,
            projectId: existing.projectId,
          });
        } else {
          log.info("repository.created: not auto-linked (no owning project)", {
            repo: p.repository.full_name,
          });
        }
      }
      break;

    case "pull_request":
      if (p.action === "opened" || p.action === "synchronize") {
        log.info("PR preview deploy trigger", {
          repo: p.repository.full_name,
          pr: p.number,
          sha: p.pull_request.head.sha,
        });
        if (isDeploydConfigured()) {
          const repoRow = await findRepoRow(p.repository.full_name);
          if (repoRow) {
            const previewEnv = await findOrCreatePreviewEnv(repoRow.projectId, p.number);
            // Shared ref convention (spec 213 FR-003/FR-005): the `oap-build`
            // workflow publishes this `pr-{n}` tag on the head commit, so the
            // dispatched image exists. Derived from the current project_repos
            // row (handles repo rename).
            const previewRef = derivePreviewRef({
              githubOrg: repoRow.githubOrg,
              repoName: repoRow.repoName,
              prNumber: p.number,
            });
            try {
              const result = await createPreviewDeployment({
                tenant_id: "default",
                app_id: repoRow.projectId,
                env_id: previewEnv.id,
                release_sha: p.pull_request.head.sha,
                artifact_ref: previewRef,
                lane: "LANE_A",
              });
              // FR-005: record the dispatch keyed to deployd's real release id
              // so the PR-close path destroys the actual release instead of a
              // constructed string it never minted.
              await createDeploymentRecord({
                environmentId: previewEnv.id,
                projectId: repoRow.projectId,
                releaseSha: p.pull_request.head.sha,
                artifactRef: previewRef,
                variant: "root",
                status: mapDeploydStatus(result.status),
                releaseId: result.release_id,
                dispatchedBy: "webhook",
              });
              log.info("Preview deploy triggered", { releaseId: result.release_id, pr: p.number });
            } catch (err) {
              log.error("Preview deploy failed", { error: String(err), pr: p.number });
            }
          }
        }
      } else if (p.action === "closed") {
        log.info("PR preview destroy trigger", {
          repo: p.repository.full_name,
          pr: p.number,
        });
        if (isDeploydConfigured()) {
          const repoRow = await findRepoRow(p.repository.full_name);
          if (repoRow) {
            // FR-005: resolve the stored deployd release id and destroy THAT.
            // The prior code destroyed a constructed `preview-{projectId}-pr-{n}`
            // string deployd never minted, so the DELETE 404'd and preview
            // releases leaked. A missing env/record is a logged no-op, never a
            // fabricated id.
            const previewEnv = await findPreviewEnv(repoRow.projectId, p.number);
            const record = previewEnv
              ? await getLatestDeploymentForEnv(previewEnv.id)
              : undefined;
            if (record?.releaseId && record.status !== "DESTROYED") {
              try {
                await destroyPreviewDeployment(record.releaseId);
                await updateDeploymentRecord(record.id, { status: "DESTROYED" });
                log.info("Preview destroy triggered", {
                  pr: p.number,
                  releaseId: record.releaseId,
                });
              } catch (err) {
                log.error("Preview destroy failed", {
                  error: String(err),
                  pr: p.number,
                  releaseId: record.releaseId,
                });
              }
            } else {
              log.info("Preview destroy skipped: no recorded release id", {
                pr: p.number,
                projectId: repoRow.projectId,
              });
            }
          }
        }
      }
      break;

    case "push":
      if (
        p.ref === `refs/heads/${p.repository.default_branch}` &&
        p.after !== "0000000000000000000000000000000000000000"
      ) {
        log.info("Push to default branch", {
          repo: p.repository.full_name,
          sha: p.after,
        });
        const pushRepo = await findRepoRow(p.repository.full_name);
        if (pushRepo) {
          log.info("Governance check triggered", {
            repo: p.repository.full_name,
            sha: p.after,
            projectId: pushRepo.projectId,
          });
          // Governance checks run adapter invariants against the pushed code.
          // The actual check runner is crates/orchestrator/src/verify.rs invoked
          // via the factory pipeline. This emits the audit event for the trigger.
        }
      }
      break;

    case "workflow_run":
      if (p.action === "completed") {
        await handleWorkflowRunCompleted(p);
      }
      break;

    case "organization":
      await handleOrganizationEvent(p);
      break;

    default:
      log.debug("Unhandled webhook event", { event });
  }
}

// ---------------------------------------------------------------------------
// FR-001: GitHub App Installation Handling (spec 080)
// ---------------------------------------------------------------------------

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleInstallationEvent(p: any): Promise<void> {
  const installId: number = p.installation.id;
  const githubOrgId: number = p.installation.account.id;
  const githubOrgLogin: string = p.installation.account.login;
  const installedBy: string | undefined = p.sender?.login;

  if (p.action === "created") {
    log.info("GitHub App installed", {
      installation_id: installId,
      account: githubOrgLogin,
    });

    // Determine allowed repos
    const allowedRepos = Array.isArray(p.repositories)
      ? (p.repositories as Array<{ name: string }>).map((r) => r.name).join(",")
      : "all";

    // Create or link OAP org
    let orgId: string;
    const [existingOrg] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.githubOrgId, githubOrgId))
      .limit(1);

    if (existingOrg) {
      orgId = existingOrg.id;
      await db
        .update(organizations)
        .set({
          githubOrgLogin,
          githubInstallationId: installId,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, orgId));
    } else {
      const [created] = await db
        .insert(organizations)
        .values({
          name: githubOrgLogin,
          slug: githubOrgLogin.toLowerCase(),
          githubOrgId,
          githubOrgLogin,
          githubInstallationId: installId,
        })
        .onConflictDoNothing()
        .returning({ id: organizations.id });

      if (created) {
        orgId = created.id;
      } else {
        // Slug conflict — find by slug
        const [bySlug] = await db
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.slug, githubOrgLogin.toLowerCase()))
          .limit(1);
        orgId = bySlug!.id;
        await db
          .update(organizations)
          .set({
            githubOrgId,
            githubOrgLogin,
            githubInstallationId: installId,
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, orgId));
      }
    }

    // Spec 119 collapsed workspace into project; org membership no longer
    // requires a default workspace row. Project creation lands later via
    // factory-create / factory-import / clone, each of which provisions
    // its own bucket per spec 119 §4.2.

    // Upsert github_installations row.
    //
    // Conflict target is github_org_id, not installation_id: on uninstall we
    // soft-transition to state=deleted and keep the row, so a re-install on
    // the same org creates a row with the same github_org_id but a new
    // installation_id. Targeting installation_id would miss the stale
    // deleted row and the INSERT would violate the github_org_id UNIQUE
    // constraint instead. installationId is re-set here so the new GitHub
    // installation ID is captured on re-install.
    await db
      .insert(githubInstallations)
      .values({
        githubOrgId,
        githubOrgLogin,
        installationId: installId,
        installationState: "active",
        allowedRepos,
        orgId,
        installedBy,
      })
      .onConflictDoUpdate({
        target: githubInstallations.githubOrgId,
        set: {
          installationId: installId,
          githubOrgLogin,
          installationState: "active",
          allowedRepos,
          orgId,
          installedBy,
          updatedAt: new Date(),
        },
      });

    // Also persist installation_id to matching repos (preserve existing behavior)
    if (Array.isArray(p.repositories)) {
      for (const r of p.repositories as Array<{ name: string }>) {
        await db
          .update(projectRepos)
          .set({ githubInstallId: installId })
          .where(
            and(
              eq(projectRepos.githubOrg, githubOrgLogin),
              eq(projectRepos.repoName, r.name)
            )
          );
      }
    }

    // Audit log
    await db.insert(auditLog).values({
      actorUserId: SYSTEM_USER_ID,
      action: "org.github_app_installed",
      targetType: "organization",
      targetId: orgId,
      metadata: {
        installation_id: installId,
        github_org_login: githubOrgLogin,
        installed_by: installedBy,
      },
    });
  } else if (p.action === "deleted") {
    log.info("GitHub App uninstalled", {
      installation_id: installId,
      account: githubOrgLogin,
    });

    // Read org linkage BEFORE updating state
    const [inst] = await db
      .select({ orgId: githubInstallations.orgId })
      .from(githubInstallations)
      .where(eq(githubInstallations.installationId, installId))
      .limit(1);

    // Soft-transition: mark as deleted, don't remove data
    await db
      .update(githubInstallations)
      .set({ installationState: "deleted", updatedAt: new Date() })
      .where(eq(githubInstallations.installationId, installId));

    // Clear installation IDs for all repos owned by this account
    await db
      .update(projectRepos)
      .set({ githubInstallId: null })
      .where(eq(projectRepos.githubOrg, githubOrgLogin));

    // Audit log (only if we found the installation row)
    if (inst?.orgId) {
      await db.insert(auditLog).values({
        actorUserId: SYSTEM_USER_ID,
        action: "org.github_app_uninstalled",
        targetType: "organization",
        targetId: inst.orgId,
        metadata: {
          installation_id: installId,
          github_org_login: githubOrgLogin,
        },
      });
    } else {
      log.warn("Uninstall webhook for unknown installation", {
        installation_id: installId,
      });
    }
  } else if (p.action === "suspend") {
    log.info("GitHub App suspended", { installation_id: installId });
    await db
      .update(githubInstallations)
      .set({ installationState: "suspended", updatedAt: new Date() })
      .where(eq(githubInstallations.installationId, installId));
  } else if (p.action === "unsuspend") {
    log.info("GitHub App unsuspended", { installation_id: installId });
    await db
      .update(githubInstallations)
      .set({ installationState: "active", updatedAt: new Date() })
      .where(eq(githubInstallations.installationId, installId));
  }
}

// ---------------------------------------------------------------------------
// Organization membership events (spec 080 FR-011)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleOrganizationEvent(p: any): Promise<void> {
  if (p.action === "member_removed") {
    const ghUserId: number = p.membership?.user?.id;
    const installId: number | undefined = p.installation?.id;

    if (!ghUserId) {
      log.warn("organization.member_removed: no user ID in payload");
      return;
    }

    log.info("Organization member removed", {
      github_user_id: ghUserId,
      org: p.organization?.login,
    });

    // Look up the OAP user by github_user_id
    const [oapUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.githubUserId, ghUserId))
      .limit(1);

    if (!oapUser) {
      log.info("Removed user not found in OAP, skipping", {
        github_user_id: ghUserId,
      });
      return;
    }

    // Resolve the org via installation or github_org_id
    let orgId: string | null = null;
    if (installId) {
      const [inst] = await db
        .select({ orgId: githubInstallations.orgId })
        .from(githubInstallations)
        .where(eq(githubInstallations.installationId, installId))
        .limit(1);
      orgId = inst?.orgId ?? null;
    }

    if (!orgId && p.organization?.id) {
      const [org] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.githubOrgId, p.organization.id))
        .limit(1);
      orgId = org?.id ?? null;
    }

    if (!orgId) {
      log.warn("Could not resolve OAP org for member removal", {
        github_user_id: ghUserId,
        org: p.organization?.login,
      });
      return;
    }

    await revokeOrgMembership(oapUser.id, orgId);
    log.info("Revoked membership via webhook", {
      userId: oapUser.id,
      orgId,
      github_user_id: ghUserId,
    });
  } else if (p.action === "member_added") {
    // Spec 106 FR-005 addendum: proactively upsert membership so the
    // resolver DB reflects the add immediately, not on next login. Kept
    // conservative — only writes when the user already exists in OAP;
    // first-time users are still provisioned by /auth/rauthy/callback.
    const ghUserId: number | undefined = p.membership?.user?.id;
    const installId: number | undefined = p.installation?.id;
    const githubOrgId: number | undefined = p.organization?.id;

    if (!ghUserId) {
      log.warn("organization.member_added: no user ID in payload");
      return;
    }

    const [oapUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.githubUserId, ghUserId))
      .limit(1);

    if (!oapUser) {
      log.info("Added user not known to OAP yet (will resolve on login)", {
        github_user_id: ghUserId,
        org: p.organization?.login,
      });
      return;
    }

    let orgId: string | null = null;
    if (installId) {
      const [inst] = await db
        .select({ orgId: githubInstallations.orgId })
        .from(githubInstallations)
        .where(eq(githubInstallations.installationId, installId))
        .limit(1);
      orgId = inst?.orgId ?? null;
    }

    if (!orgId && githubOrgId) {
      const [org] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.githubOrgId, githubOrgId))
        .limit(1);
      orgId = org?.id ?? null;
    }

    if (!orgId) {
      log.warn("Could not resolve OAP org for member addition", {
        github_user_id: ghUserId,
        org: p.organization?.login,
      });
      return;
    }

    await db
      .insert(orgMemberships)
      .values({
        userId: oapUser.id,
        orgId,
        source: "github",
        platformRole: "member",
        status: "active",
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [orgMemberships.userId, orgMemberships.orgId],
        set: {
          status: "active",
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    await db.insert(auditLog).values({
      actorUserId: SYSTEM_USER_ID,
      action: "membership.added",
      targetType: "user",
      targetId: oapUser.id,
      metadata: {
        org_id: orgId,
        reason: "github_membership_added",
        github_user_id: ghUserId,
      },
    });

    log.info("Upserted membership via webhook", {
      userId: oapUser.id,
      orgId,
      github_user_id: ghUserId,
    });
  }
}

// ---------------------------------------------------------------------------
// FR-006: record built images on workflow_run.completed
// ---------------------------------------------------------------------------

/**
 * Spec 213 recording gate for `project_artifacts` (pure).
 *
 * Only a default-branch push publishes the `sha-<head_sha>` tag the deploy
 * path resolves. A `pull_request` run checks out the ephemeral merge commit,
 * so it pushes `sha-<mergesha>` plus the `pr-<n>` alias, never
 * `sha-<head_sha>`; recording its head_sha would store a row pointing at a
 * tag that was never pushed (the phantom-artifact regression). Non-default
 * branch pushes are excluded so "latest deployable" tracks the deploy branch.
 * Fails closed when the default branch is unknown.
 */
export function isDefaultBranchPush(
  run: { event?: string; head_branch?: string } | null | undefined,
  defaultBranch: string,
): boolean {
  return (
    !!run &&
    run.event === "push" &&
    !!defaultBranch &&
    run.head_branch === defaultBranch
  );
}

/**
 * On a successful `oap-build` run, upsert a `project_artifacts` row per
 * built variant so the deploy path can resolve the image ref without a
 * registry round trip (spec 213 FR-006). Best-effort: a missed or failed
 * event degrades to the FR-005 derivation, never to a hard failure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleWorkflowRunCompleted(p: any): Promise<void> {
  const run = p.workflow_run;
  if (
    !run ||
    run.name !== OAP_BUILD_WORKFLOW_NAME ||
    run.conclusion !== "success"
  ) {
    return;
  }

  // Spec 213 (sha tags on every default-branch push): only a default-branch
  // push build publishes a `sha-<head_sha>` tag whose sha equals
  // `run.head_sha`, which is what the deploy path resolves. Skip everything
  // else (pull_request runs, non-default-branch pushes) so we never record a
  // row pointing at a tag that was never pushed. See isDefaultBranchPush.
  const defaultBranch: string = p.repository?.default_branch ?? "";
  if (!isDefaultBranchPush(run, defaultBranch)) {
    log.debug("oap-build completed but not a default-branch push; skipping artifact record", {
      repo: p.repository?.full_name,
      event: run.event,
      headBranch: run.head_branch,
      defaultBranch,
    });
    return;
  }

  const fullName: string = p.repository?.full_name ?? "";
  const repoRow = await findRepoRow(fullName);
  if (!repoRow) {
    log.debug("oap-build completed for unregistered repo", { repo: fullName });
    return;
  }

  const sha: string = run.head_sha;
  if (!sha) {
    log.warn("oap-build completed without head_sha", { repo: fullName });
    return;
  }

  const variants = await detectBuiltVariants(repoRow, sha);
  for (const variant of variants) {
    const imageRef = deriveArtifactRef({
      githubOrg: repoRow.githubOrg,
      repoName: repoRow.repoName,
      sha,
      variant,
    });
    await db
      .insert(projectArtifacts)
      .values({
        projectId: repoRow.projectId,
        releaseSha: sha,
        variant,
        imageRef,
        workflowRunId: typeof run.id === "number" ? run.id : null,
      })
      .onConflictDoUpdate({
        target: [
          projectArtifacts.projectId,
          projectArtifacts.releaseSha,
          projectArtifacts.variant,
        ],
        set: {
          imageRef,
          workflowRunId: typeof run.id === "number" ? run.id : null,
          builtAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }
  log.info("Recorded built artifact(s)", { repo: fullName, sha, variants });
}

/**
 * The `workflow_run` event does not carry the tree shape, so detect it the
 * same way the build workflow does (spec 213 FR-004): a dual-profile tree
 * has top-level `public/` and `internal/` directories, each containing
 * `apps/api`. Best-effort: any failure (no installation, API error) falls
 * back to the single-variant `root` record, and the deploy path can still
 * derive variant refs on demand (FR-005).
 */
async function detectBuiltVariants(
  repoRow: { githubOrg: string; repoName: string; githubInstallId: number | null },
  sha: string
): Promise<ArtifactVariant[]> {
  if (!repoRow.githubInstallId) return ["root"];
  const fullName = `${repoRow.githubOrg}/${repoRow.repoName}`;
  try {
    const { token } = await brokerInstallationToken(repoRow.githubInstallId, {
      contents: "read",
    });
    const [hasPublic, hasInternal] = await Promise.all([
      repoPathExists(token, fullName, "public/apps/api", sha),
      repoPathExists(token, fullName, "internal/apps/api", sha),
    ]);
    if (hasPublic && hasInternal) return ["public", "internal"];
    return ["root"];
  } catch (err) {
    log.warn("variant detection failed; recording root only", {
      repo: fullName,
      error: String(err),
    });
    return ["root"];
  }
}

async function repoPathExists(
  token: string,
  fullName: string,
  path: string,
  ref: string
): Promise<boolean> {
  const resp = await fetch(
    `${GITHUB_API}/repos/${fullName}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  return resp.ok;
}

// Spec 213 FR-009: resolve the single project that owns a GitHub repo. The
// (github_org, repo_name) edge is unique (schema unique index), so at most one
// row matches. As defense in depth for environments where the index is not yet
// applied, prefer the primary link and fail loud on a genuinely ambiguous
// match rather than silently picking one: the prior `.limit(1)` behaviour
// returned an arbitrary row and cross-attributed builds to the wrong project.
export async function findRepoRow(fullName: string) {
  const [owner, name] = fullName.split("/");
  if (!owner || !name) return null;
  const rows = await db
    .select()
    .from(projectRepos)
    .where(
      and(eq(projectRepos.githubOrg, owner), eq(projectRepos.repoName, name)),
    );
  if (rows.length <= 1) return rows[0] ?? null;
  const primaries = rows.filter((r) => r.isPrimary);
  if (primaries.length === 1) {
    log.warn("findRepoRow: multiple links for repo; using primary", {
      repo: fullName,
      count: rows.length,
    });
    return primaries[0];
  }
  log.error("findRepoRow: ambiguous repo->project links; refusing to guess", {
    repo: fullName,
    count: rows.length,
    primaries: primaries.length,
  });
  throw new Error(
    `ambiguous project_repos for ${fullName}: ${rows.length} links, ` +
      `${primaries.length} primary (FR-009 one-repo-one-project violated)`,
  );
}

/** Find-only lookup of a PR's preview environment (FR-005 destroy path); does
 *  NOT create one, so closing a PR that never deployed leaves no orphan env. */
async function findPreviewEnv(projectId: string, prNumber: number) {
  const envName = `preview-pr-${prNumber}`;
  const [row] = await db
    .select()
    .from(environments)
    .where(and(eq(environments.projectId, projectId), eq(environments.name, envName)))
    .limit(1);
  return row ?? null;
}

async function findOrCreatePreviewEnv(projectId: string, prNumber: number) {
  const envName = `preview-pr-${prNumber}`;
  const existing = await db
    .select()
    .from(environments)
    .where(and(eq(environments.projectId, projectId), eq(environments.name, envName)))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const [created] = await db
    .insert(environments)
    .values({
      projectId,
      name: envName,
      kind: "preview",
      autoDeployBranch: null,
      requiresApproval: false,
    })
    .returning();
  return created;
}
