// Spec 112 §5.3 — scaffold warmup scheduler.
//
// Two Encore-native pieces wire the warmup machinery into statecraft:
//   1. `runScaffoldWarmup` — internal endpoint that resolves a warmup
//      context (scaffoldRepoUrl + scaffoldRef + PAT) and runs the cache
//      + four prebuilds. Called at boot via fire-and-forget at module
//      load AND by a 30-min cron for upstream-SHA refresh.
//   2. `_scaffoldRefresher` — Encore CronJob that fires `runScaffoldWarmup`
//      every 30 minutes. Replaces template-distributor's setInterval.
//
// Multi-tenancy: statecraft today resolves a single warmup context (the
// first org whose latest admission record carries a resolved scaffold
// source and which has a configured upstream PAT). Cache contents are
// public template files + npm node_modules — neither org-sensitive — so
// a shared cache is safe for MVP.
//
// Spec 199 FR-009 / spec 198 D-5 — the warmup resolver reads each org's
// admission record, where `scaffold.source.remote` from the adapter
// manifest was resolved against `factory_upstreams` at admission time.
// The manifest-injected `scaffold_source_id` (spec 140 §2.2) is retired.

import { api } from "encore.dev/api";
import { CronJob } from "encore.dev/cron";
import log from "encore.dev/log";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/drizzle";
import {
  factoryArtifactSubstrate,
  factoryUpstreams,
} from "../../db/schema";
import { loadFactoryUpstreamPatToken } from "../../factory/upstreamPat";
import { FACTORY_SOURCE_ID } from "../../factory/upstreams";
import { loadSubstrateForOrg } from "../../factory/substrateBrowser";
import { listAdapterViews } from "../../factory/adapterView";
import { loadLatestAdmission } from "../../factory/admission";
import {
  defaultWorkspaceDir,
  runWarmup,
  setInitErrorFromContext,
  startBackgroundRefresher,
  type WarmupContext,
} from "./templateCache";

interface ResolvedWarmupContext extends WarmupContext {
  /** Surfaced for log lines / readiness reports. */
  orgId: string;
}

export type WarmupResolution =
  | { kind: "ok"; ctx: ResolvedWarmupContext }
  | { kind: "no-adapters" }
  | { kind: "no-scaffold-source-id" }
  | { kind: "no-scaffold-source-resolved" }
  | { kind: "no-pat" }
  | { kind: "no-factory-source" };

const SHA40 = /^[0-9a-f]{40}$/i;
function refToBranch(ref: string): string {
  return SHA40.test(ref) ? "main" : ref;
}

/**
 * Org-scoped `factory_upstreams` lookup by source id. The admission-time
 * resolution (spec 199 FR-009) and the scaffoldReadiness endpoint share
 * this helper; tests drive it directly.
 */
export async function resolveScaffoldUpstream(
  orgId: string,
  scaffoldSourceId: string,
): Promise<{ repoUrl: string; ref: string } | null> {
  const rows = await db
    .select({
      repoUrl: factoryUpstreams.repoUrl,
      ref: factoryUpstreams.ref,
    })
    .from(factoryUpstreams)
    .where(
      and(
        eq(factoryUpstreams.orgId, orgId),
        eq(factoryUpstreams.sourceId, scaffoldSourceId),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const { repoUrl, ref } = rows[0];
  if (!repoUrl) return null;
  return { repoUrl, ref };
}

async function resolveWarmupContext(): Promise<WarmupResolution> {
  // Spec 199 FR-009 / spec 198 D-5 — the warmup reads each org's
  // ADMISSION record: the scaffold source was resolved at admission time
  // from the manifest's org-agnostic `scaffold.source.remote`. The
  // manifest-injected `scaffold_source_id` (spec 140 §2.2) is retired.
  const orgRows = await db
    .selectDistinctOn([factoryArtifactSubstrate.orgId], {
      orgId: factoryArtifactSubstrate.orgId,
    })
    .from(factoryArtifactSubstrate)
    .where(eq(factoryArtifactSubstrate.status, "active"));

  if (orgRows.length === 0) return { kind: "no-adapters" };

  let sawScaffoldSource = false;
  let sawResolvedSource = false;
  for (const { orgId } of orgRows) {
    const substrate = await loadSubstrateForOrg(orgId);
    const views = listAdapterViews(substrate);
    if (views.length === 0) continue;
    const admissionByOrigin = new Map<
      string,
      Awaited<ReturnType<typeof loadLatestAdmission>>
    >();
    for (const view of views) {
      if (
        (view.manifest.scaffold as Record<string, unknown> | undefined)
          ?.source
      ) {
        sawScaffoldSource = true;
      }
      if (!admissionByOrigin.has(view.origin)) {
        admissionByOrigin.set(
          view.origin,
          await loadLatestAdmission(orgId, view.origin),
        );
      }
      const admission = admissionByOrigin.get(view.origin)!;
      const resolution = admission.scaffoldResolutions[view.name];
      if (!resolution) continue;
      sawResolvedSource = true;

      // PAT is optional: the ctx.patResolver below loads the org PAT on demand
      // and the clone (buildCloneUrl) falls back to an anonymous clone for
      // public template repos when none is configured.

      // Spec 112 §5.3.1: the generator + module catalog live in factory-encore,
      // resolved from the org's `factory` factory_upstreams row. This is a
      // configuration fact (no new admission gate); an unconfigured factory
      // upstream is a sibling warmup blocker.
      const factory = await resolveScaffoldUpstream(
        orgId,
        FACTORY_SOURCE_ID,
      );
      if (!factory) return { kind: "no-factory-source" };

      return {
        kind: "ok",
        ctx: {
          orgId,
          workspaceDir: defaultWorkspaceDir(),
          scaffoldRepoUrl: resolution.repo_url,
          scaffoldRef: refToBranch(resolution.ref),
          factoryRepoUrl: factory.repoUrl,
          factoryRef: refToBranch(factory.ref),
          patResolver: () => loadFactoryUpstreamPatToken(orgId),
        },
      };
    }
  }
  if (!sawScaffoldSource) return { kind: "no-scaffold-source-id" };
  if (!sawResolvedSource) return { kind: "no-scaffold-source-resolved" };
  return { kind: "no-pat" };
}

function reportUnresolvable(resolution: WarmupResolution): void {
  if (resolution.kind === "ok") return;
  const messages: Record<Exclude<WarmupResolution["kind"], "ok">, string> = {
    "no-adapters":
      "scaffold warmup: no factory adapter rows for any org — run /factory-sync to populate (spec 139 §7.2)",
    "no-scaffold-source-id":
      "scaffold warmup: factory adapters are present but none declare a scaffold.source in their manifest (spec 199 FR-009)",
    "no-scaffold-source-resolved":
      "scaffold warmup: no admission record resolves an adapter's scaffold source — register the upstream at /app/factory/upstreams and re-run /factory-sync (spec 198/199)",
    "no-pat":
      "scaffold warmup: an adapter and matching upstream are configured but no factory_upstream_pats row exists — configure a PAT at /app/admin/factory/pat",
    "no-factory-source":
      "scaffold warmup: the template scaffold source is resolved but no factory-encore upstream (factory) is registered; the generator + module catalog live there (spec 112 §5.3.1). Register it at /app/factory/upstreams and re-run /factory-sync",
  };
  const reason = messages[resolution.kind];
  log.info(reason);
  setInitErrorFromContext(reason);
}

export const runScaffoldWarmup = api(
  { expose: false, method: "POST", path: "/internal/scaffold/warmup" },
  async (): Promise<void> => {
    const resolution = await resolveWarmupContext();
    if (resolution.kind !== "ok") {
      reportUnresolvable(resolution);
      return;
    }
    const ctx = resolution.ctx;
    log.info("scaffold warmup: starting", {
      orgId: ctx.orgId,
      scaffoldRepoUrl: ctx.scaffoldRepoUrl,
      scaffoldRef: ctx.scaffoldRef,
    });
    await runWarmup(ctx);
    // Idempotent — first call wires the in-process refresher; subsequent
    // calls are no-ops. Belt-and-braces with the CronJob below: the
    // setInterval keeps refreshing if the cron is unavailable in dev.
    startBackgroundRefresher(ctx);
  }
);

// Fire-and-forget initial warmup at module load. Encore handlers must
// remain responsive while warmup runs; the CronJob's first fire is up to
// 30 min out, which is too slow for the post-deploy "first user creates
// a project" flow.
void (async () => {
  try {
    const resolution = await resolveWarmupContext();
    if (resolution.kind !== "ok") {
      reportUnresolvable(resolution);
      return;
    }
    const ctx = resolution.ctx;
    log.info("scaffold warmup: kicking off at module load", {
      orgId: ctx.orgId,
    });
    await runWarmup(ctx);
    startBackgroundRefresher(ctx);
  } catch (err) {
    log.warn("initial scaffold warmup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
})();

const _scaffoldRefresher = new CronJob("scaffold-warmup-refresher", {
  title: "Scaffold Warmup Refresher",
  every: "30m",
  endpoint: runScaffoldWarmup,
});
void _scaffoldRefresher;
