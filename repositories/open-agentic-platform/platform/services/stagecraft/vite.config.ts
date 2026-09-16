import { defineConfig } from "vitest/config";
import path from "path";

// When running under `encore test`, the Encore CLI provides the native
// runtime.  When running bare `vitest` (npm test / CI), we swap in
// lightweight mocks so unit tests can execute without the runtime binary.
const hasEncoreRuntime = !!process.env.ENCORE_RUNTIME_LIB;

// Array form preserves entry order: vite matches the first `find` that
// applies, so more-specific prefixes (e.g. `~encore/auth`) MUST precede
// broader ones (`~encore`).
const bareVitestAliases = [
  {
    find: "encore.dev/api",
    replacement: path.resolve(__dirname, "./test/__mocks__/encore-api.ts"),
  },
  {
    find: "encore.dev/log",
    replacement: path.resolve(__dirname, "./test/__mocks__/encore-log.ts"),
  },
  {
    find: "encore.dev/pubsub",
    replacement: path.resolve(__dirname, "./test/__mocks__/encore-pubsub.ts"),
  },
  // Spec 143 — secrets read via env vars under bare vitest so storage
  // dual-client tests can pin S3_ENDPOINT / S3_PUBLIC_ENDPOINT per case.
  {
    find: "encore.dev/config",
    replacement: path.resolve(__dirname, "./test/__mocks__/encore-config.ts"),
  },
  // `~encore/*` normally resolves into `./encore.gen/*`, which is generated
  // by the Encore CLI and git-ignored. CI runs `npm test` without that
  // directory, so stub the auth barrel before the broader `~encore` prefix.
  {
    find: "~encore/auth",
    replacement: path.resolve(__dirname, "./test/__mocks__/encore-auth.ts"),
  },
];

const encoreRootAlias = {
  find: "~encore",
  replacement: path.resolve(__dirname, "./encore.gen"),
};

export default defineConfig({
  resolve: {
    alias: hasEncoreRuntime
      ? [encoreRootAlias]
      : [...bareVitestAliases, encoreRootAlias],
  },
  test: {
    // Integration tests that require Encore service infrastructure
    // (databases, service-to-service calls) must run via `encore test`.
    // The DB-bound list below is excluded only under bare vitest
    // (npm test / CI); `encore test` sets ENCORE_RUNTIME_LIB and provides
    // the live infra these suites document as their posture. Before this
    // became conditional the list applied unconditionally, which made the
    // DB-bound suites unrunnable even under `encore test`.
    exclude: hasEncoreRuntime
      ? ["**/node_modules/**", "**/dist/**"]
      : [
      "**/node_modules/**",
      "**/dist/**",
      // Spec 143: the gateway auth handler constructs an Encore `Gateway` at
      // import time and its happy-path check reads the users table, so the
      // M2M-passthrough regression suite runs under `encore test`.
      "**/auth/handler.test.ts",
      // schema.ts <-> migrated-SQL drift gate: zero-row selects per table +
      // pgEnum label comparison against the live baseline-applied DB.
      "**/db/schemaDrift.test.ts",
      // Spec 124 — factory_runs migration assertions hit the live db
      // client and exercise FK/CHECK semantics that require Postgres.
      "**/runsMigration.test.ts",
      // Spec 124 — /api/factory/runs reservation/list/detail integration
      // tests touch agent_catalog + project_agent_bindings + factory_*
      // tables; they run under `encore test`.
      "**/factory/runs.test.ts",
      // Spec 124 — duplex handler integration tests mutate `factory_runs`
      // and `audit_log` rows; gated to `encore test` for the live DB.
      "**/factory/runDuplexHandlers.test.ts",
      // Spec 124 — runs staleness sweeper tests mutate `factory_runs`
      // and emit audit rows; same DB-bound posture as the others.
      "**/factory/runsScheduler.test.ts",
      // Spec 139 — conflict + artifacts API integration tests touch the
      // live `factory_artifacts*` tables and run only under `encore test`.
      "**/factory/conflicts.test.ts",
      "**/factory/artifacts.test.ts",
      // Spec 139 Phase 2: dispatch E2E test; live DB.
      "**/agents/dispatch.test.ts",
      // Spec 139 Phase 4b — bindings.ts substrate-direct integration
      // tests (bind / repin / unbind / retired-upstream).
      "**/agents/bindings.integration.test.ts",
      // Spec 115 — listKnowledgeObjects regression for
      // `IN (sql.join(...))` array binding (multi-row path that
      // previously 500'd in production). Live DB.
      "**/knowledge/listKnowledgeObjects.integration.test.ts",
      // Spec 143 FR-010 — orphan-imported sweeper (Class A delete +
      // Class B self-heal + concurrency + race-with-user). Live DB;
      // mocks storage.headObject only.
      "**/knowledge/orphanSweeper.integration.test.ts",
      // Spec 143 FR-011 — server-side upload size cap. Live DB;
      // exercises requestUpload's APIError on sizeBytes > cap.
      "**/knowledge/requestUpload.integration.test.ts",
      // (Per-migration .test.ts files were removed by the spec 199-era
      // migration squash: the 53 incremental migrations were consolidated into
      // a single 1_baseline.up.sql, so the idempotence/effect tests for
      // migrations 36/37/38/40/41 no longer have discrete files to exercise.)
      // Spec 140 Phase 2 — scaffold scheduler resolver test queries the
      // live `factory_upstreams` table.
      "**/projects/scaffold/scheduler.test.ts",
      // Spec 198 phase 4 — run-grant + countersign handler tests mutate
      // `factory_run_grants` / `factory_admissions` / `factory_runs`;
      // live DB, signing via throwaway env-injected keypair.
      "**/factory/grantDuplexHandlers.test.ts",
      // Spec 208 FR-001/AC-2: org-halt enforcement (scope lattice, verb
      // lifecycle + audits, and the grant issuance/renewal refusal under a
      // halt) mutates `org_halts` / `factory_*` / `audit_log`; live DB,
      // signing via throwaway env-injected keypair.
      "**/factory/orgHalt.test.ts",
      // Spec 198 FR-013 — override trust-class tests mutate
      // `factory_artifact_substrate*` (gate audit, verified flag,
      // consumed-override predicate matrix); live DB.
      "**/factory/overrideTrustClass.test.ts",
      // Spec 201 — approval-summary endpoint assembly + AC-3 GET-purity
      // assertions against seeded substrate/admission rows; live DB.
      "**/factory/approvalSummaryEndpoint.test.ts",
      // Spec 200 — override scan-run lifecycle (durable intent, dedupe,
      // policy skip, injected-verdict quarantine, retry, sweeper,
      // migration-47 constraint); live DB.
      "**/factory/overrideScanRuns.test.ts",
      // Spec 200 — quarantine enforcement sweeps (serve / grant /
      // approval-summary parity / agent resolution) + mode-sensitive
      // lift + verify interplay; live DB.
      "**/factory/overrideQuarantineEnforcement.test.ts",
      // Spec 215 FR-003: environment_deployments record writer
      // (create / patch-by-id / patch-by-release / latest-per-env /
      // by-release lookup) exercised against live Postgres.
      "**/deploy/deployments.test.ts",
      // Spec 207 AC-4: platform countersign of audit segments mutates
      // audit_log + org/user fixtures via the live DB; runs under encore test.
      "**/factory/auditSegmentHandlers.test.ts",
      // Spec 205 FR-005 / AC-4: two-principal audit attribution forensic
      // query seeds + reads audit_log + org/user fixtures via the live DB.
      "**/audit/auditTwoPrincipal.test.ts",
      // Spec 213 FR-009: project_repos one-repo-one-project unique index
      // (migration 51) + findRepoRow resolution; live Postgres.
      "**/github/webhook.test.ts",
      // Spec 202 FR-003(c): queue-storm gate integration tests drive
      // reserveRunCore end-to-end (substrate/admission seeding) and read
      // audit_log rows; live Postgres.
      "**/factory/queueStormGate.test.ts",
      // Spec 202 FR-004: approval-velocity counter integration tests seed
      // factory_runs + gate_approved audit rows and read them back through
      // the org-scoped join; live Postgres. (The pure windowing/classifier
      // coverage in approvalVelocity-pure.test.ts stays in the bare lane.)
      "**/factory/approvalVelocity.test.ts",
    ],
  },
});
