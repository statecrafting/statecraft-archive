import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  integer,
  bigint,
  numeric,
  pgEnum,
  jsonb,
  unique,
  index,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; notNull: true; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const roleEnum = pgEnum("role", ["user", "admin"]);
export const sessionKindEnum = pgEnum("session_kind", ["user", "admin"]);

// ---------------------------------------------------------------------------
// GitHub Identity Onboarding enums (spec 080)
// ---------------------------------------------------------------------------

export const installationStateEnum = pgEnum("installation_state", [
  "active",
  "suspended",
  "deleted",
]);

export const membershipSourceEnum = pgEnum("membership_source", [
  "github",
  "manual",
  "rauthy",
  "oidc",
]);

export const orgMembershipStatusEnum = pgEnum("org_membership_status", [
  "active",
  "suspended",
  "removed",
]);

export const platformRoleEnum = pgEnum("platform_role", [
  "owner",
  "admin",
  "member",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),  // nullable: OAuth users have no password
  role: roleEnum("role").notNull().default("user"),
  disabled: boolean("disabled").notNull().default(false),
  githubUserId: bigint("github_user_id", { mode: "number" }).unique(),
  githubLogin: text("github_login"),
  avatarUrl: text("avatar_url"),
  rauthyUserId: text("rauthy_user_id").unique(),
  idpProvider: text("idp_provider"),    // 'github' | 'azure-ad' | 'okta' | etc.
  idpSubject: text("idp_subject"),      // provider-specific user ID
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  kind: sessionKindEnum("kind").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// Spec 119 §6.4 — replaces workspace_grants. user × project tuple gates
// runtime tool permissions for OPC governance; project_members.role gates
// coarse access independently.
export const projectGrants = pgTable(
  "project_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id").notNull(),
    enableFileRead: boolean("enable_file_read").notNull().default(true),
    enableFileWrite: boolean("enable_file_write").notNull().default(true),
    enableNetwork: boolean("enable_network").notNull().default(true),
    maxTier: integer("max_tier").notNull().default(2),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.userId, t.projectId)]
);

export const agentPolicies = pgTable("agent_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: text("org_id").notNull().default("default"),
  slug: text("slug").notNull(),
  blocked: boolean("blocked").notNull().default(false),
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Project model enums
// ---------------------------------------------------------------------------

export const projectMemberRoleEnum = pgEnum("project_member_role", [
  "viewer",
  "developer",
  "deployer",
  "admin",
]);

export const environmentKindEnum = pgEnum("environment_kind", [
  "preview",
  "development",
  "staging",
  "production",
]);

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdBy: uuid("created_by"),  // nullable: orgs auto-created from GitHub App install
  githubOrgId: bigint("github_org_id", { mode: "number" }).unique(),
  githubOrgLogin: text("github_org_login"),
  githubInstallationId: bigint("github_installation_id", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Projects (spec 119 — top-level governance unit under organization)
// ---------------------------------------------------------------------------

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    // Spec 119 §4.2 — promoted from workspaces.object_store_bucket. Each
    // project owns its own S3-compatible bucket for the knowledge corpus
    // and factory artifacts.
    objectStoreBucket: text("object_store_bucket").notNull(),
    // Spec 112 §5.2 — link to the factory adapter this project was created
    // from (or translated to, for imported legacy projects). Nullable so
    // pre-spec-112 projects load without migration back-fill.
    // Spec 142 §2.2 — `text` (not `uuid`) since spec 139 Phase 4 cut
    // over to substrate-projected synthetic adapter ids of the form
    // `synthetic-adapter-<orgId8>-<name>` (migration 38).
    factoryAdapterId: text("factory_adapter_id"),
    // Spec 227 Stage 4 (FR-004/FR-005): whether the project opted into the
    // Redis infrastructure resource at scaffold (data-redis in the composed
    // set). Fixed at create time (topology is build-time under Option A). The
    // deploy trigger reads this to auto-provision a dev preview Redis
    // (previewRedis), mirroring the default-on previewDatabase path.
    usesRedis: boolean("uses_redis").notNull().default(false),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.slug)]
);

// ---------------------------------------------------------------------------
// Project Repos
// ---------------------------------------------------------------------------

export const projectRepos = pgTable(
  "project_repos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    githubOrg: text("github_org").notNull(),
    repoName: text("repo_name").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    isPrimary: boolean("is_primary").notNull().default(false),
    githubInstallId: bigint("github_install_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Spec 213 FR-009: one GitHub repo maps to exactly one project. A build
  // event's owning project is derived from this row (FR-006 findRepoRow), so
  // the (org, repo) -> project edge must be 1:1 or the build is attributed to
  // an arbitrary project and the deploy path resolves the wrong image.
  (t) => [unique().on(t.githubOrg, t.repoName)]
);

// ---------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------

export const environments = pgTable("environments", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull(),
  name: text("name").notNull(),
  kind: environmentKindEnum("kind").notNull().default("development"),
  k8sNamespace: text("k8s_namespace"),
  autoDeployBranch: text("auto_deploy_branch"),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Environment Access Gates (spec 137 Phase 1)
// ---------------------------------------------------------------------------
//
// 1:1 with `environments`. Migration 40 wires up the FK + CASCADE plus
// three CHECK constraints (enabled-requires-ref, federated-provider
// allowed values, federated pair consistency). Allowlist entries live in
// the sibling table below.

export const environmentAccessGates = pgTable("environment_access_gates", {
  environmentId: uuid("environment_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  rauthyClientRef: text("rauthy_client_ref"),
  // Spec 137 migration 41 — deploy descriptor secrets. Required when
  // `enabled = true` (CHECK enabled_requires_secrets). NULL when the
  // descriptor is in its off-state. Plaintext at rest; KMS-backed
  // encryption is a follow-up spec (plan.md risk register, amended PR).
  rauthyClientSecret: text("rauthy_client_secret"),
  cookieSecret: text("cookie_secret"),
  tlsSecretName: text("tls_secret_name")
    .notNull()
    .default("tenants-wildcard-tls"),
  loginMethodMagicLink: boolean("login_method_magic_link")
    .notNull()
    .default(true),
  loginMethodFederatedProvider: text("login_method_federated_provider"),
  loginMethodFederatedProviderClientRef: text(
    "login_method_federated_provider_client_ref",
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const environmentAccessGateAllowlistEmails = pgTable(
  "environment_access_gate_allowlist_emails",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    environmentId: uuid("environment_id").notNull(),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("environment_access_gate_allowlist_emails_env_idx").on(
      t.environmentId,
      t.kind,
    ),
  ],
);

export type EnvironmentAccessGate = typeof environmentAccessGates.$inferSelect;
export type EnvironmentAccessGateInsert =
  typeof environmentAccessGates.$inferInsert;
export type EnvironmentAccessGateAllowlistEmail =
  typeof environmentAccessGateAllowlistEmails.$inferSelect;
export type EnvironmentAccessGateAllowlistEmailInsert =
  typeof environmentAccessGateAllowlistEmails.$inferInsert;

// ---------------------------------------------------------------------------
// Project Artifacts (spec 213)
// ---------------------------------------------------------------------------
//
// One row per successfully published OCI image for a project commit; the
// deploy path's first lookup for "what image does this commit have?"
// (FR-006). Populated by the GitHub webhook on `workflow_run.completed`
// (workflow `oap-build`, conclusion `success`). A missed event degrades to
// the deterministic `deriveArtifactRef` convention (FR-005), never to a
// hard failure. `variant` is `root` for single-variant trees and
// `public`/`internal` for dual-profile trees (spec 214 FR-009).

export const projectArtifacts = pgTable(
  "project_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    releaseSha: text("release_sha").notNull(),
    variant: text("variant").notNull().default("root"),
    imageRef: text("image_ref").notNull(),
    workflowRunId: bigint("workflow_run_id", { mode: "number" }),
    builtAt: timestamp("built_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Idempotent upsert key (FR-006; re-run/race on the same SHA).
  (t) => [unique().on(t.projectId, t.releaseSha, t.variant)]
);

export type ProjectArtifact = typeof projectArtifacts.$inferSelect;
export type ProjectArtifactInsert = typeof projectArtifacts.$inferInsert;

// ---------------------------------------------------------------------------
// Environment Deployments (spec 215 FR-003)
// ---------------------------------------------------------------------------
//
// Statecraft's durable record of every deploy dispatch (UI trigger or PR
// webhook), keyed to deployd-api's release id. Source of truth for the env
// page (FR-004) and the destroy path's release-id lookup (FR-005). Migration
// 49 owns the table; the status / variant CHECK constraints live in SQL.
export const deploymentStatusValues = [
  "REQUESTED",
  "PENDING",
  "ROLLED_OUT",
  "FAILED",
  "REQUEST_FAILED",
  "DESTROYED",
] as const;
// Explicit union, NOT `(typeof deploymentStatusValues)[number]`: Encore.ts's
// TS parser rejects that indexed-access-on-typeof-array form ("unsupported
// indexed access type operation") and fails service compilation. Keep this
// union in sync with deploymentStatusValues above (and migration 49's CHECK).
export type DeploymentStatus =
  | "REQUESTED"
  | "PENDING"
  | "ROLLED_OUT"
  | "FAILED"
  | "REQUEST_FAILED"
  | "DESTROYED";

export const environmentDeployments = pgTable(
  "environment_deployments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    environmentId: uuid("environment_id").notNull(),
    projectId: uuid("project_id").notNull(),
    releaseId: text("release_id"),
    releaseSha: text("release_sha").notNull(),
    artifactRef: text("artifact_ref").notNull(),
    variant: text("variant").notNull().default("public"),
    status: text("status").$type<DeploymentStatus>().notNull(),
    endpoints: jsonb("endpoints").$type<string[]>().notNull().default([]),
    dispatchedBy: text("dispatched_by").notNull(),
    diagnostic: text("diagnostic"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_environment_deployments_env_created").on(
      t.environmentId,
      t.createdAt,
    ),
  ],
);

export type EnvironmentDeployment = typeof environmentDeployments.$inferSelect;
export type EnvironmentDeploymentInsert =
  typeof environmentDeployments.$inferInsert;

// ---------------------------------------------------------------------------
// Project Members
// ---------------------------------------------------------------------------

export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: projectMemberRoleEnum("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.projectId, t.userId)]
);

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorUserId: uuid("actor_user_id").notNull(),
  // Spec 205 FR-005: two-principal attribution. When an agent acts, nhiSub
  // is the non-human identity that acted and onBehalfOf is the human it
  // acted for; actorUserId continues to hold the human. Both NULL for
  // ordinary (non-agent) writes.
  nhiSub: text("nhi_sub"),
  onBehalfOf: text("on_behalf_of"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// GitHub App Installations (spec 080)
// ---------------------------------------------------------------------------

export const githubInstallations = pgTable("github_installations", {
  id: uuid("id").defaultRandom().primaryKey(),
  githubOrgId: bigint("github_org_id", { mode: "number" }).notNull().unique(),
  githubOrgLogin: text("github_org_login").notNull(),
  installationId: bigint("installation_id", { mode: "number" })
    .notNull()
    .unique(),
  installationState: installationStateEnum("installation_state")
    .notNull()
    .default("active"),
  allowedRepos: text("allowed_repos"),
  orgId: uuid("org_id"),
  installedBy: text("installed_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// User Identity Linkage (spec 080)
// ---------------------------------------------------------------------------

export const userIdentities = pgTable(
  "user_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    provider: text("provider").notNull().default("github"),
    providerUserId: text("provider_user_id").notNull(),
    providerLogin: text("provider_login").notNull(),
    providerEmail: text("provider_email"),
    avatarUrl: text("avatar_url"),
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.provider, t.providerUserId)]
);

// ---------------------------------------------------------------------------
// Org Membership Linkage (spec 080)
// ---------------------------------------------------------------------------

export const orgMemberships = pgTable(
  "org_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    orgId: uuid("org_id").notNull(),
    source: membershipSourceEnum("source").notNull().default("github"),
    githubRole: text("github_role"),
    platformRole: platformRoleEnum("platform_role").notNull().default("member"),
    status: orgMembershipStatusEnum("status").notNull().default("active"),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.userId, t.orgId)]
);

// ---------------------------------------------------------------------------
// Factory Pipeline Lifecycle (spec 077)
// ---------------------------------------------------------------------------

export const factoryPipelineStatusEnum = pgEnum("factory_pipeline_status", [
  "initialized",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export const factoryStageStatusEnum = pgEnum("factory_stage_status", [
  "pending",
  "in_progress",
  "completed",
  "confirmed",
  "rejected",
]);

export const factoryScaffoldStatusEnum = pgEnum("factory_scaffold_status", [
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

export const factoryScaffoldCategoryEnum = pgEnum("factory_scaffold_category", [
  "data",
  "api",
  "ui",
  "configure",
  "trim",
  "validate",
]);

export const factoryPipelines = pgTable("factory_pipelines", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull(),
  adapterName: text("adapter_name").notNull(),
  status: factoryPipelineStatusEnum("status").notNull().default("initialized"),
  policyBundleId: uuid("policy_bundle_id"),
  buildSpecHash: text("build_spec_hash"),
  previousPipelineId: uuid("previous_pipeline_id"),
  // spec 110 §2 + §8 rollout — trigger source for this pipeline. CHECK
  // constraint lives in migration 20; keep the literal union here aligned.
  source: text("source").$type<"opc-direct" | "statecraft">()
    .notNull()
    .default("opc-direct"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const factoryBusinessDocs = pgTable("factory_business_docs", {
  id: uuid("id").defaultRandom().primaryKey(),
  pipelineId: uuid("pipeline_id").notNull(),
  name: text("name").notNull(),
  storageRef: text("storage_ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const factoryStages = pgTable(
  "factory_stages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pipelineId: uuid("pipeline_id").notNull(),
    stageId: text("stage_id").notNull(),
    status: factoryStageStatusEnum("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    rejectedBy: text("rejected_by"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionFeedback: text("rejection_feedback"),
    promptTokens: integer("prompt_tokens").default(0),
    completionTokens: integer("completion_tokens").default(0),
    model: text("model"),
  },
  (t) => [unique().on(t.pipelineId, t.stageId)]
);

export const factoryScaffoldFeatures = pgTable(
  "factory_scaffold_features",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pipelineId: uuid("pipeline_id").notNull(),
    featureId: text("feature_id").notNull(),
    category: factoryScaffoldCategoryEnum("category").notNull(),
    status: factoryScaffoldStatusEnum("status").notNull().default("pending"),
    retryCount: integer("retry_count").default(0),
    lastError: text("last_error"),
    filesCreated: text("files_created").array(),
    promptTokens: integer("prompt_tokens").default(0),
    completionTokens: integer("completion_tokens").default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.pipelineId, t.featureId)]
);

export const factoryAuditLog = pgTable("factory_audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  pipelineId: uuid("pipeline_id").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true })
    .notNull()
    .defaultNow(),
  event: text("event").notNull(),
  actor: text("actor"),
  stageId: text("stage_id"),
  featureId: text("feature_id"),
  details: jsonb("details").notNull().default({}),
});

export const factoryPolicyBundles = pgTable("factory_policy_bundles", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull(),
  adapterName: text("adapter_name").notNull(),
  rules: jsonb("rules").notNull(),
  compiledAt: timestamp("compiled_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Knowledge Intake Domain (spec 087 Phase 2)
// ---------------------------------------------------------------------------

export const connectorTypeEnum = pgEnum("connector_type", [
  "upload",
  "sharepoint",
  "s3",
  "azure-blob",
  "gcs",
]);

export const connectorStatusEnum = pgEnum("connector_status", [
  "active",
  "paused",
  "error",
  "disabled",
]);

export const knowledgeObjectStateEnum = pgEnum("knowledge_object_state", [
  "imported",
  "extracting",
  "extracted",
  "classified",
  "available",
  // Spec 143 §12 FU-019 — terminal informational state for rows whose
  // MIME type has no registered extractor under any policy. Worker
  // transitions to this state instead of leaving the row in `imported`
  // with a `policy_pending` / `extractor_not_implemented` red badge.
  "unsupported_type",
]);

export const sourceConnectors = pgTable("source_connectors", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull(),
  type: connectorTypeEnum("type").notNull(),
  name: text("name").notNull(),
  configEncrypted: jsonb("config_encrypted"),
  syncSchedule: text("sync_schedule"),
  status: connectorStatusEnum("status").notNull().default("active"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const knowledgeObjects = pgTable("knowledge_objects", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull(),
  connectorId: uuid("connector_id"),
  storageKey: text("storage_key").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  contentHash: text("content_hash").notNull(),
  state: knowledgeObjectStateEnum("state").notNull().default("imported"),
  extractionOutput: jsonb("extraction_output"),
  classification: jsonb("classification"),
  provenance: jsonb("provenance").notNull(),
  // Spec 115 FR-025 — populated on extraction failure; reverted to NULL on
  // successful retry. Shape: { code, message, extractorKind, attemptedAt }.
  lastExtractionError: jsonb("last_extraction_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Sync Runs (spec 087 Phase 4)
// ---------------------------------------------------------------------------

export const syncRunStatusEnum = pgEnum("sync_run_status", [
  "running",
  "completed",
  "failed",
]);

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  connectorId: uuid("connector_id").notNull(),
  projectId: uuid("project_id").notNull(),
  status: syncRunStatusEnum("status").notNull().default("running"),
  objectsCreated: integer("objects_created").notNull().default(0),
  objectsUpdated: integer("objects_updated").notNull().default(0),
  objectsSkipped: integer("objects_skipped").notNull().default(0),
  error: text("error"),
  deltaToken: text("delta_token"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Factory Artifact Registry (spec 082 Phase 3)
// ---------------------------------------------------------------------------

export const factoryArtifacts = pgTable("factory_artifacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  pipelineId: uuid("pipeline_id").notNull(),
  stageId: text("stage_id").notNull(),
  artifactType: text("artifact_type").notNull(),
  contentHash: text("content_hash").notNull(),
  storagePath: text("storage_path").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  // Project scoping (spec 094 Slice 5; the prior workspace-keyed column was
  // renamed by spec 119 Phase C). Nullable — pre-collapse rows carry an
  // orphan UUID that no longer resolves to anything.
  projectId: uuid("project_id"),
  // Provenance: which agent produced this artifact (spec 094 Slice 5).
  producerAgent: text("producer_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Promotions (spec 097 — Promotion-Grade Platform Mirror)
// ---------------------------------------------------------------------------

export const promotionStatusEnum = pgEnum("promotion_status", [
  "promoted",
  "revoked",
]);

// Spec 119 Phase C — promotions are now project-scoped. Pre-collapse rows
// carry an orphan UUID that no longer resolves; new writes use the real
// destination project.
export const promotions = pgTable("promotions", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull(),
  pipelineId: uuid("pipeline_id").notNull(),
  workflowId: text("workflow_id").notNull(),
  status: promotionStatusEnum("status").notNull().default("promoted"),
  promotedBy: text("promoted_by"),
  evidence: jsonb("evidence").notNull().default({}),
  promotedAt: timestamp("promoted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// GitHub Team Role Mappings (spec 080 Phase 3 — FR-009)
// ---------------------------------------------------------------------------

export const targetScopeEnum = pgEnum("target_scope", ["org", "project"]);

export const githubTeamRoleMappings = pgTable(
  "github_team_role_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull(),
    githubTeamSlug: text("github_team_slug").notNull(),
    githubTeamId: bigint("github_team_id", { mode: "number" }).notNull(),
    targetScope: targetScopeEnum("target_scope").notNull(),
    targetId: uuid("target_id"), // NULL for org-level, project_id for project-level
    role: text("role").notNull(), // platform_role or project_member_role
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.githubTeamSlug, t.targetScope, t.targetId)]
);

// ---------------------------------------------------------------------------
// Desktop Refresh Tokens (spec 080 Phase 1 — OPC PKCE auth)
// ---------------------------------------------------------------------------

export const desktopRefreshTokens = pgTable("desktop_refresh_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull(),
  orgId: uuid("org_id").notNull(),
  orgSlug: text("org_slug").notNull().default(""),
  githubLogin: text("github_login").default(""),
  idpProvider: text("idp_provider").notNull().default(""),
  idpLogin: text("idp_login").notNull().default(""),
  platformRole: text("platform_role").notNull().default("member"),
  rauthyUserId: text("rauthy_user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// User GitHub Personal Access Tokens (spec 106 FR-005/FR-006)
// ---------------------------------------------------------------------------

export const userGithubPats = pgTable("user_github_pats", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  tokenEnc: bytea("token_enc").notNull(),
  tokenNonce: bytea("token_nonce").notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  scopes: text("scopes").array().notNull().default([]),
  isFineGrained: boolean("is_fine_grained").notNull().default(false),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// OIDC Providers (spec 080 Phase 4 — Enterprise OIDC Federation)
// ---------------------------------------------------------------------------

export const oidcProviders = pgTable(
  "oidc_providers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull(),
    name: text("name").notNull(),
    providerType: text("provider_type").notNull().default("oidc"), // oidc | azure-ad | okta | google-workspace | saml-bridge
    issuer: text("issuer").notNull(),
    clientId: text("client_id").notNull(),
    clientSecretEnc: text("client_secret_enc").notNull(),
    scopes: text("scopes").notNull().default("openid profile email"),
    claimsMapping: jsonb("claims_mapping").notNull().default({}),
    emailDomain: text("email_domain"),
    autoProvision: boolean("auto_provision").notNull().default(true),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.issuer)]
);

// ---------------------------------------------------------------------------
// OIDC Group-to-Role Mappings (spec 080 Phase 4)
// ---------------------------------------------------------------------------

export const oidcGroupRoleMappings = pgTable(
  "oidc_group_role_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull(),
    providerId: uuid("provider_id").notNull(),
    idpGroupId: text("idp_group_id").notNull(),
    idpGroupName: text("idp_group_name"),
    targetScope: targetScopeEnum("target_scope").notNull(),
    targetId: uuid("target_id"), // NULL for org-level, project_id for project-level
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.providerId, t.idpGroupId, t.targetScope, t.targetId)]
);

// ---------------------------------------------------------------------------
// Factory as a first-class platform feature (spec 108)
// ---------------------------------------------------------------------------
// factory_upstreams is the one writable config per org — it replaces the
// repo-rooted upstream-map.yaml. The three derived tables are replaced on
// every sync run; only the latest snapshot per (org, name[, version]) is
// retained.

// Spec 139 Phase 4b — N-per-org keyed by (org_id, source_id). The legacy
// singleton wire shape on `GET/POST /api/factory/upstreams` composes
// from two rows: `factory` (factory side, role='mixed') and
// `template` (template side, role='scaffold'). The four
// legacy per-side columns (factory_source/factory_ref/template_source/
// template_ref) are dropped in migration 35.
export const factoryUpstreams = pgTable(
  "factory_upstreams",
  {
    orgId: uuid("org_id").notNull(),
    // Spec 139 §3.1 — stable per-org identifier for this upstream.
    sourceId: text("source_id").notNull(),
    // Spec 139 §2.2 — 'orchestration' | 'scaffold' | 'mixed' | 'oap-self'.
    role: text("role").notNull(),
    // Repo identity + ref drive `cloneAndTranslate` regardless of role.
    repoUrl: text("repo_url").notNull(),
    ref: text("ref").notNull().default("main"),
    // Optional subpath inside the repo (e.g. 'process/' or
    // 'orchestration/'); NULL means whole repo.
    subpath: text("subpath"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSyncSha: jsonb("last_sync_sha"),
    lastSyncStatus: text("last_sync_status"),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.sourceId] })],
);

// Spec 139 cutover history:
//   * Phase 4 narrow (migration 34) dropped `factory_adapters`,
//     `factory_contracts`, `factory_processes`. Reads project from
//     `factory_artifact_substrate` via `loadSubstrateForOrg` +
//     `projectSubstrateToLegacy`.
//   * Phase 4b (migration 35) dropped `agent_catalog`,
//     `agent_catalog_audit`, `project_agent_bindings`. Reads project
//     from `factory_artifact_substrate` (origin='user-authored',
//     kind='agent') and `factory_bindings`.
// The substrate is the only authoritative store post-cutover. The
// `projectSubstrateToLegacy` projection named above was itself retired
// by spec 199 (FR-005): reads now serve substrate rows verbatim by kind.

// ---------------------------------------------------------------------------
// Spec 139 Phase 1 — content-addressed factory artifact substrate.
//
// One row per upstream file (verbatim mirror), indexed by
// (org_id, origin, path, version). `effective_body` is generated stored
// from COALESCE(user_body, upstream_body); consumers select that column.
// Closed-set kind/status/conflict_state are CHECK-constrained at the SQL
// level (migration 32) — these TS unions document the narrowing for
// handlers and the substrate state machine.
// ---------------------------------------------------------------------------

export type ArtifactKind =
  | "agent"
  | "skill"
  | "process-stage"
  | "adapter-manifest"
  | "contract-schema"
  | "pattern"
  | "page-type-reference"
  | "sample-html"
  | "reference-data"
  | "invariant"
  | "pipeline-orchestrator"
  // Spec 198 FR-012 — the process-layer governance envelope
  // (`process/governance-envelope.yaml`); CHECK widened in migration 43.
  | "governance-envelope";

export type ArtifactStatus = "active" | "retired";

export type ArtifactConflictState = "ok" | "diverged" | null;

export type ArtifactAuditAction =
  | "artifact.synced"
  | "artifact.retired"
  | "artifact.overridden"
  | "artifact.override_cleared"
  | "artifact.conflict_detected"
  | "artifact.conflict_resolved"
  // Spec 139 §6.4 — added Phase 2 to absorb spec 111
  // `agent_catalog_audit.action='fork'` 1:1 (T051).
  | "artifact.forked"
  // Spec 198 FR-013 — deterministic override-gate refusal (a) and the
  // privileged verified-flag transition (c).
  | "artifact.override_gate_rejected"
  | "artifact.override_verified"
  // Spec 200 FR-008 — async-scanner outcome vocabulary. Widened into the
  // audit check constraint by migration 47 (the migration-46 lesson: the
  // constraint rides the same migration as the writers).
  | "artifact.scan_flagged"
  | "artifact.scan_clean"
  | "artifact.scan_skipped"
  | "artifact.scan_failed";

// SQL table is `factory_artifact_substrate` (NOT `factory_artifacts`) — the
// shorter name was already taken by spec 082's per-run pipeline artifact
// registry (`factoryArtifacts` declared above at line ~583). See spec 139
// §2.1 Naming Note. Drizzle export name mirrors the SQL identifier.
export const factoryArtifactSubstrate = pgTable(
  "factory_artifact_substrate",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull(),
    origin: text("origin").notNull(),
    path: text("path").notNull(),
    kind: text("kind").$type<ArtifactKind>().notNull(),
    bundleId: uuid("bundle_id"),
    version: integer("version").notNull().default(1),
    status: text("status").$type<ArtifactStatus>().notNull().default("active"),
    upstreamSha: text("upstream_sha"),
    upstreamBody: text("upstream_body"),
    userBody: text("user_body"),
    userModifiedAt: timestamp("user_modified_at", { withTimezone: true }),
    userModifiedBy: uuid("user_modified_by"),
    // Spec 198 FR-013(c) — override trust class (migration 45). Every new
    // override revision resets to unverified; only the privileged
    // verify-override endpoint flips it. Enforced at bundle assembly when
    // the admitted envelope declares `overrides.require_verified: true`.
    userBodyVerified: boolean("user_body_verified").notNull().default(false),
    verifiedBy: uuid("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    // Generated-stored at the SQL level: COALESCE(user_body, upstream_body)
    // (migration 32). Drizzle excludes `generatedAlwaysAs` columns from
    // $inferInsert so TS handlers cannot accidentally write to it.
    effectiveBody: text("effective_body")
      .generatedAlwaysAs(sql`COALESCE(user_body, upstream_body)`)
      .notNull(),
    contentHash: text("content_hash").notNull(),
    frontmatter: jsonb("frontmatter"),
    conflictState: text("conflict_state").$type<ArtifactConflictState>(),
    conflictUpstreamSha: text("conflict_upstream_sha"),
    conflictResolvedAt: timestamp("conflict_resolved_at", {
      withTimezone: true,
    }),
    conflictResolvedBy: uuid("conflict_resolved_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.origin, t.path, t.version)],
);

// Spec 198 FR-001/FR-003 — governance-envelope admission records. One row
// per evaluation; the latest row per (org_id, origin) is the standing
// admission state. Refusals are kept as attributable evidence.
export const factoryAdmissions = pgTable("factory_admissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull(),
  origin: text("origin").notNull(),
  status: text("status").$type<"admitted" | "refused">().notNull(),
  envelopeHash: text("envelope_hash"),
  // The composed admitted envelope: process ⊕ adapter sub-envelope(s) ⊕
  // constituent digests ⊕ resolved scaffold sources (FR-004: composition
  // preserved, never flattened).
  composed: jsonb("composed"),
  violations: jsonb("violations").notNull().default([]),
  // Spec 199 FR-009 / D-5: adapter name → { source_id, repo_url, ref }
  // resolved at admission time.
  scaffoldResolutions: jsonb("scaffold_resolutions").notNull().default({}),
  factorySha: text("factory_sha"),
  // Spec 198 FR-014 — admission seal: platform compact-JWS over the admitted
  // composition's content-addressed constituents. NULL = unsealed (pre-seal
  // row or unconfigured signing authority); the OPC engine refuses unsealed
  // admissions fail-closed (PD-5; a re-sync re-admits with a seal).
  sealJws: text("seal_jws"),
  sealedAt: timestamp("sealed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Spec 198 FR-005 — run-grants: the signed intent capsule, issued at run
// start (seq 0) and renewed at every stage boundary. Refusals are recorded
// with a reason (goal-shift / revocation refusals are attributable
// evidence, ASI01 m4/m7). The issued sequence is what the emission
// countersign reconciles against (FR-014).
export const factoryRunGrants = pgTable("factory_run_grants", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull(),
  runId: uuid("run_id").notNull(),
  projectId: uuid("project_id"),
  goalId: text("goal_id").notNull(),
  capsuleHash: text("capsule_hash").notNull(),
  envelopeHash: text("envelope_hash").notNull(),
  buildSpecHash: text("build_spec_hash"),
  seq: integer("seq").notNull(),
  status: text("status").$type<"issued" | "refused">().notNull(),
  refusedReason: text("refused_reason"),
  grantJws: text("grant_jws"),
  kid: text("kid"),
  issuedAt: timestamp("issued_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

// Spec 198 FR-010 — revocations keyed on the admission graph. org_id NULL
// is a global (OAP-published) advisory row. Checked fail-closed at serve,
// bind, and run-grant issuance/renewal; `lifted_at` set only after fresh
// validation + human approval (ASI10 m7).
export const factoryRevocations = pgTable("factory_revocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id"),
  scopeKind: text("scope_kind")
    .$type<"factory" | "adapter" | "agent" | "content-hash">()
    .notNull(),
  key: text("key").notNull(),
  mode: text("mode").$type<"revoked" | "quarantined">().notNull(),
  reason: text("reason").notNull(),
  actor: uuid("actor"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  liftedAt: timestamp("lifted_at", { withTimezone: true }),
  liftedBy: uuid("lifted_by"),
});

// Spec 208 FR-001/FR-004: org-wide agent kill-switch quarantine record. One
// row per halt scope; consulted fail-closed at grant issuance/renewal,
// new-session registration, and serve/bind (the spec 198 FR-010 check sites
// the switch reuses). A scope is "active" when it has no non-'lifted' row.
// `pulledBy`/`liftedBy` hold the human actor uuid bare (the
// factory_revocations.actor convention; a service identity can never reach
// the write path). The partial UNIQUE index `idx_org_halts_active`
// (WHERE state != 'lifted') is owned by migration 53: it is the liveness
// lookup and the at-most-one-active-halt-per-scope backstop. drizzle's
// index() cannot express the partial predicate, and the migration is the
// source of truth for the schema here.
export const orgHalts = pgTable("org_halts", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull(),
  scope: text("scope").$type<"org" | "project" | "agent-profile">().notNull(),
  scopeKey: text("scope_key").notNull(),
  state: text("state")
    .$type<"halted" | "reintegrating" | "lifted">()
    .notNull()
    .default("halted"),
  reason: text("reason").notNull(),
  pulledBy: uuid("pulled_by").notNull(),
  pulledAt: timestamp("pulled_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  liftedBy: uuid("lifted_by"),
  liftedAt: timestamp("lifted_at", { withTimezone: true }),
  // `clientId` and `recordedAt` are server-authoritative (stamped from the
  // authenticated duplex session and the server clock at ack receipt);
  // `ackedAt` is the engine's CLAIMED pause/checkpoint boundary, kept as an
  // observation, not trusted as the audit fact (the audit.candidate posture).
  // `recordedAt` is the trustworthy propagation bound for an auditor.
  acks: jsonb("acks")
    .$type<
      {
        clientId: string;
        ackedAt: string;
        recordedAt: string;
        kind: "halt" | "lift";
      }[]
    >()
    .notNull()
    .default([]),
});

export type OrgHalt = typeof orgHalts.$inferSelect;
export type OrgHaltInsert = typeof orgHalts.$inferInsert;

// Spec 200 FR-001 — durable scan intent for the substrate override async
// scanner. Inserted inside the `user_body` write transaction; the publish
// happens after commit; the staleness sweeper re-drives lost publishes and
// fails stale `running` rows. `scanner_version` subsumes the prompt
// registry version, so a prompt-only update produces fresh (non-deduped)
// runs.
export const factoryOverrideScanRuns = pgTable(
  "factory_override_scan_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull(),
    artifactId: uuid("artifact_id").notNull(),
    contentHash: text("content_hash").notNull(),
    scannerVersion: text("scanner_version").notNull(),
    status: text("status")
      .$type<"queued" | "running" | "completed" | "failed" | "skipped">()
      .notNull()
      .default("queued"),
    verdict: text("verdict").$type<"clean" | "flagged">(),
    // Untrusted model output — recorded evidence only, never parsed into
    // further actions (FR-007).
    rationale: text("rationale"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    attempts: integer("attempts").notNull().default(0),
    detail: jsonb("detail"),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    runningAt: timestamp("running_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastEventAt: timestamp("last_event_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_override_scan_runs_dedupe").on(
      t.orgId,
      t.artifactId,
      t.contentHash,
      t.scannerVersion,
      t.queuedAt,
    ),
    index("idx_override_scan_runs_status_event").on(t.status, t.lastEventAt),
    index("idx_override_scan_runs_org_completed").on(t.orgId, t.completedAt),
  ],
);

export const factoryArtifactSubstrateAudit = pgTable(
  "factory_artifact_substrate_audit",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    artifactId: uuid("artifact_id").notNull(),
    orgId: uuid("org_id").notNull(),
    action: text("action").$type<ArtifactAuditAction>().notNull(),
    actorUserId: uuid("actor_user_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// Spec 139 §2.1 — universal pinning. Replaces spec 123
// `project_agent_bindings`; same shape, applies to any kind.
// Invariants I-B1..I-B4 carry over:
//   I-B1: no definition override (only id+version+hash).
//   I-B2: pin integrity — `pinnedContentHash` MUST match the
//         artifact row's `contentHash` at `(artifactId, pinnedVersion)`.
//   I-B3: retired-upstream bindings stay readable but cannot be repinned.
//   I-B4: ON DELETE RESTRICT on `artifactId` — retire instead of hard delete.
export const factoryBindings = pgTable(
  "factory_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    artifactId: uuid("artifact_id").notNull(),
    pinnedVersion: integer("pinned_version").notNull(),
    pinnedContentHash: text("pinned_content_hash").notNull(),
    boundBy: uuid("bound_by").notNull(),
    boundAt: timestamp("bound_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.projectId, t.artifactId)],
);

// ---------------------------------------------------------------------------
// Spec 124 — factory_runs. One row per OPC factory run, mutated via the
// duplex bus (`factory.run.*` envelopes) once reserved. Closes the spec 108
// §7.4 deferral. Migration `31_create_factory_runs.up.sql`.
// ---------------------------------------------------------------------------

/** Spec 124 §3 — closed set for the `status` column. The migration
 *  enforces it with a CHECK constraint; this alias documents the
 *  TypeScript-side narrowing for handlers and loaders. */
export type FactoryRunStatus =
  | "queued"
  | "running"
  | "ok"
  | "failed"
  | "cancelled";

/** Spec 124 §3 — per-stage entry shape persisted under
 *  `factory_runs.stage_progress` and projected onto the run-detail UI.
 *  `agentRef` is the spec-123 triple (snake_case in the JSONB column). */
export interface FactoryRunStageProgressEntry {
  stage_id: string;
  status: "running" | "ok" | "failed" | "skipped";
  started_at: string;
  completed_at?: string;
  agent_ref?: {
    org_agent_id: string;
    version: number;
    content_hash: string;
  };
  /** Free-form failure detail for this stage. Distinct from the row-level
   *  `error` column which is only set on terminal `factory.run.failed`. */
  error?: string;
}

/** Spec 124 §3 — `source_shas` JSONB shape. snake_case to match the
 *  columns the platform handlers read/write directly. */
export interface FactoryRunSourceShas {
  adapter: string;
  process: string;
  contracts: Record<string, string>;
  agents: {
    org_agent_id: string;
    version: number;
    content_hash: string;
  }[];
}

/** Spec 124 §6.1 — `token_spend` JSONB shape, populated on
 *  `factory.run.completed`. */
export interface FactoryRunTokenSpend {
  input: number;
  output: number;
  total: number;
}

export const factoryRuns = pgTable(
  "factory_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull(),
    /** NULL for ad-hoc runs (no project binding consulted). */
    projectId: uuid("project_id"),
    triggeredBy: uuid("triggered_by").notNull(),
    // Spec 142 §2.2 — `text` (not `uuid`). Spec 139 Phase 4 writes
    // `synthesiseAdapterId` / `synthesiseProcessId` synthetic strings
    // here (`api/factory/runs.ts:325-326`); migration 38 aligned the
    // column types to match the substrate-projected runtime format.
    adapterId: text("adapter_id").notNull(),
    processId: text("process_id").notNull(),
    /** Idempotency key supplied by the desktop on POST /api/factory/runs.
     *  Unique per `(org_id, client_run_id)` so retries return the existing
     *  row (T021 / T023). */
    clientRunId: text("client_run_id").notNull(),
    status: text("status").$type<FactoryRunStatus>().notNull(),
    stageProgress: jsonb("stage_progress")
      .$type<FactoryRunStageProgressEntry[]>()
      .notNull()
      .default([]),
    tokenSpend: jsonb("token_spend").$type<FactoryRunTokenSpend>(),
    error: text("error"),
    sourceShas: jsonb("source_shas")
      .$type<FactoryRunSourceShas>()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Spec 198 FR-014 — emission countersign evidence: the certificate hash
    // the engine reported at completion and when the platform countersigned
    // it (NULL until the run completes and the chain reconciles).
    certificateSha256: text("certificate_sha256"),
    countersignedAt: timestamp("countersigned_at", { withTimezone: true }),
    /** Refreshed on every duplex event for the row; drives the staleness
     *  sweeper (T061). */
    lastEventAt: timestamp("last_event_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("factory_runs_org_client_run_id_uniq").on(t.orgId, t.clientRunId)]
);

// ---------------------------------------------------------------------------
// Spec 112 — Factory scaffold jobs.
// Durable, concurrency-safe record of every Create request (replaces the
// retired `template-distributor` service's in-memory job map).
// ---------------------------------------------------------------------------

export const scaffoldJobs = pgTable("scaffold_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull(),
  projectId: uuid("project_id"),
  // Spec 142 §2.2 — `text` (not `uuid`). Spec 139 Phase 4 writes
  // `synthesiseAdapterId(...)` synthetic strings here from
  // `api/projects/create.ts:225`; migration 38 aligned the column
  // type. The runtime format is the contract — there is no surviving
  // table to FK against post-substrate cutover.
  factoryAdapterId: text("factory_adapter_id").notNull(),
  requestedBy: uuid("requested_by").notNull(),
  variant: text("variant").notNull(),
  profileName: text("profile_name"),
  status: text("status").notNull().default("pending"), // pending | running | succeeded | failed | orphaned
  step: text("step"), // clone | prebuild | run-entry | seed-pipeline-state | push | cleanup
  errorMessage: text("error_message"),
  githubOrg: text("github_org"),
  repoName: text("repo_name"),
  cloneUrl: text("clone_url"),
  commitSha: text("commit_sha"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Spec 109 — Factory PAT broker + PubSub sync.
// ---------------------------------------------------------------------------
// Two parallel PAT surfaces sharing the same AES-256-GCM crypto helpers
// (api/auth/patCrypto.ts). factory_upstream_pats authenticates the Factory
// sync worker against the configured upstream repos; project_github_pats
// authenticates repo operations against external (non-platform-org) repos.
// Unlike user_github_pats, revoke is a hard delete — these are operational
// credentials, audit history lives in audit_log.

export const factoryUpstreamPats = pgTable("factory_upstream_pats", {
  orgId: uuid("org_id").primaryKey(),
  tokenEnc: bytea("token_enc").notNull(),
  tokenNonce: bytea("token_nonce").notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  scopes: text("scopes").array().notNull().default([]),
  isFineGrained: boolean("is_fine_grained").notNull().default(false),
  githubLogin: text("github_login"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projectGithubPats = pgTable("project_github_pats", {
  projectId: uuid("project_id").primaryKey(),
  tokenEnc: bytea("token_enc").notNull(),
  tokenNonce: bytea("token_nonce").notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  scopes: text("scopes").array().notNull().default([]),
  isFineGrained: boolean("is_fine_grained").notNull().default(false),
  githubLogin: text("github_login"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const factorySyncRunStatusEnum = pgEnum("factory_sync_run_status", [
  "pending",
  "running",
  "ok",
  "failed",
]);

export const factorySyncRuns = pgTable("factory_sync_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull(),
  status: factorySyncRunStatusEnum("status").notNull().default("pending"),
  triggeredBy: uuid("triggered_by").notNull(),
  factorySha: text("factory_sha"),
  templateSha: text("template_sha"),
  counts: jsonb("counts"),
  error: text("error"),
  queuedAt: timestamp("queued_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Spec 114 — Async Project Clone Pipeline.
// ---------------------------------------------------------------------------
// Run row driving the queue → worker → poll lifecycle for spec 113 clones.
// Same enum shape as factory_sync_runs (pending/running/ok/failed) but
// distinct so the typed status doesn't bleed across domains.

export const projectCloneRunStatusEnum = pgEnum("project_clone_run_status", [
  "pending",
  "running",
  "ok",
  "failed",
]);

export const projectCloneRuns = pgTable(
  "project_clone_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceProjectId: uuid("source_project_id").notNull(),
    orgId: uuid("org_id").notNull(),
    triggeredBy: uuid("triggered_by").notNull(),
    status: projectCloneRunStatusEnum("status").notNull().default("pending"),
    requestedName: text("requested_name"),
    requestedSlug: text("requested_slug"),
    requestedRepoName: text("requested_repo_name"),
    finalName: text("final_name"),
    finalSlug: text("final_slug"),
    finalRepoName: text("final_repo_name"),
    defaultBranch: text("default_branch"),
    destRepoFullName: text("dest_repo_full_name"),
    // Spec 119 — org_id captures listing scope; the (nullable) project_id
    // below is the destination project once created.
    projectId: uuid("project_id"),
    opcDeepLink: text("opc_deep_link"),
    rawArtifactsCopied: integer("raw_artifacts_copied"),
    rawArtifactsSkipped: integer("raw_artifacts_skipped"),
    durationMs: integer("duration_ms"),
    error: text("error"),
    errorDetail: text("error_detail"),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("idx_project_clone_runs_org_queued").on(t.orgId, t.queuedAt)],
);

// ---------------------------------------------------------------------------
// Spec 111/123 wire-shape constants — preserved post-cutover.
// ---------------------------------------------------------------------------
// Spec 139 Phase 4b (migration 35) dropped the `agent_catalog`,
// `agent_catalog_audit`, and `project_agent_bindings` tables. The
// publication ternary and the audit-action enum survive on the wire
// because the substrate's frontmatter mirror carries
// `publication_status`, and the `audit_log.action` strings remain
// `agent.binding_*` for spec 123 §7.1 wire compatibility. Spec 139 §6.4
// reserves `factory.binding_*` for non-agent kinds; today's binding
// surface is agent-only.

export type AgentCatalogStatus = "draft" | "published" | "retired";
export type AgentCatalogAuditAction =
  | "create"
  | "edit"
  | "publish"
  | "retire"
  | "fork";

/**
 * Spec 123 — `audit_log.action` values for binding lifecycle events.
 * Bindings have no dedicated audit table; mutations land in the global
 * `audit_log` keyed by these actions.
 */
export type AgentBindingAuditAction =
  | "agent.binding_created"
  | "agent.binding_repinned"
  | "agent.binding_unbound";

// ---------------------------------------------------------------------------
// Spec 115 — Knowledge Extraction Pipeline.
// ---------------------------------------------------------------------------
// One row per extraction attempt. Drives the Topic + Subscription worker
// that walks `imported → extracting → extracted` automatically. Idempotency
// key (project_id, content_hash, extractor_version) — spec 119 collapsed
// the legacy workspace scope into project — is enforced in extractionCore.ts,
// not as a SQL UNIQUE: same key may recur after a 24h window so retries
// against the same content remain possible.

export const knowledgeExtractionRunStatusEnum = pgEnum(
  "knowledge_extraction_run_status",
  ["pending", "running", "completed", "failed", "abandoned"],
);

export const knowledgeExtractionRuns = pgTable(
  "knowledge_extraction_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    knowledgeObjectId: uuid("knowledge_object_id").notNull(),
    projectId: uuid("project_id").notNull(),
    status: knowledgeExtractionRunStatusEnum("status")
      .notNull()
      .default("pending"),
    extractorKind: text("extractor_kind"),
    extractorVersion: text("extractor_version"),
    agentRun: jsonb("agent_run"),
    tokenSpend: jsonb("token_spend"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    error: jsonb("error"),
    attempts: integer("attempts").notNull().default(0),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    runningAt: timestamp("running_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("idx_knowledge_extraction_runs_project_status").on(
      t.projectId,
      t.status,
    ),
    index("idx_knowledge_extraction_runs_object_queued").on(
      t.knowledgeObjectId,
      t.queuedAt,
    ),
    index("idx_knowledge_extraction_runs_project_completed").on(
      t.projectId,
      t.completedAt,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Project spec-spine group names (spec 163 FR-004)
// ---------------------------------------------------------------------------
//
// Cosmetic display names attached to derived-group identities for the
// Requirements view. The `group_id` is the projection-prefixed stable
// id the grouping function emits (e.g. `by-category:lifecycle` or
// `by-supersession-chain:042-old-spec`). Custom names are presentation
// metadata only — they do not change spec ownership, authority, or
// gate behaviour.

export const projectSpecGroupNames = pgTable(
  "project_spec_group_names",
  {
    projectId: uuid("project_id").notNull(),
    groupId: text("group_id").notNull(),
    displayName: text("display_name").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.groupId] }),
    index("project_spec_group_names_by_project").on(t.projectId),
  ],
);

// ---------------------------------------------------------------------------
// Spec 207 AC-4: session-scoped audit segment countersign seals.
//
// One row per countersigned segment head submitted over the duplex channel.
// Statecraft is the sole signing authority (spec 198 FR-014 posture). The
// upsert is idempotent on (org_id, session_id, segment_id) to handle
// at-least-once reconnect re-submission.
// ---------------------------------------------------------------------------

export const factorySessionAuditSeals = pgTable(
  "factory_session_audit_seals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull(),
    sessionId: text("session_id").notNull(),
    segmentId: text("segment_id").notNull(),
    segmentHeadHash: text("segment_head_hash").notNull(),
    segmentRecordCount: integer("segment_record_count").notNull(),
    firstRecordAt: timestamp("first_record_at", { withTimezone: true }),
    lastRecordAt: timestamp("last_record_at", { withTimezone: true }),
    // A row is only created once countersigned, so unanchored defaults false.
    // The local side tracks its own unanchored state.
    unanchored: boolean("unanchored").notNull().default(false),
    countersignJws: text("countersign_jws"),
    countersignKid: text("countersign_kid"),
    countersignedAt: timestamp("countersigned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.sessionId, t.segmentId)],
);
