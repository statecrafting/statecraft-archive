// Spec 112 Phase 5 — scaffold-readiness endpoint.
// Spec 139 Phase 2 (T056) — extended with `scaffold_source_resolved`
//   per adapter so the silent-reject path described in spec 112 §5.4
//   becomes an explicit blocker.
// Spec 140 Phase 3 (§2.3 / T060) — legacy `template_remote` fallback
//   removed. Create-eligibility is now purely a function of
//   `scaffold_source_id` resolving to a `factory_upstreams` row.
//
// Public read: returns the warmup state plus the per-org "do you have
// what you need to Create" preconditions (factory adapter on file,
// upstream PAT configured, scaffold source resolved per spec 139 §7.2).
// The /app/projects/new loader calls this on every render so the form
// can banner clearly when something is missing instead of surfacing the
// generic "an internal error occurred" 500.

import { api } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { loadFactoryUpstreamPatToken } from "../factory/upstreamPat";
import { loadSubstrateForOrg } from "../factory/substrateBrowser";
import { listAdapterViews } from "../factory/adapterView";
import { loadLatestAdmission } from "../factory/admission";
import { getInitStatus } from "./scaffold/templateCache";
import {
  resolveBlocker,
  type ScaffoldReadinessBlocker,
} from "./scaffoldReadinessBlocker";

export type {
  BlockerInputs,
  ScaffoldReadinessBlocker,
} from "./scaffoldReadinessBlocker";
export { resolveBlocker } from "./scaffoldReadinessBlocker";

export type AdapterReadinessVerdict = {
  /** Adapter row id (matches factory_adapters.id). */
  id: string;
  /** Adapter name (manifest-declared, e.g. `acme-vue-encore`). */
  name: string;
  /** True iff the manifest declares a `scaffold.source` (spec 199 FR-009). */
  declaresScaffoldSource: boolean;
  /** True iff the admission record resolved the scaffold source against a
   *  `factory_upstreams` row (resolution-at-admission, spec 198/199 D-5). */
  scaffoldSourceResolved: boolean;
  /** True iff this adapter alone is Create-eligible. */
  createEligible: boolean;
};

export interface ScaffoldReadinessResponse {
  ready: boolean;
  step: string;
  progress: number;
  error?: string;
  hasFactoryAdapter: boolean;
  hasUpstreamPat: boolean;
  /**
   * Spec 139 §7.2 — true iff at least one adapter has its
   * `scaffold_source_id` resolved to a `factory_upstreams` row in the
   * caller's org.
   */
  scaffoldSourceResolved: boolean;
  /**
   * Per-adapter eligibility verdicts. The web Create form renders one
   * row per adapter so users see WHY a particular pick is greyed out.
   */
  adapters: AdapterReadinessVerdict[];
  /**
   * Convenience flag — true iff every gate is green: warmup ready, at
   * least one adapter is Create-eligible, PAT configured. The UI uses
   * this to enable the submit button without AND-ing the three fields
   * itself.
   */
  canCreate: boolean;
  /** First missing precondition, in resolution order — purely for banner copy. */
  blocker?: ScaffoldReadinessBlocker;
}

/** Spec 139 Phase 4 — must match `browse.ts::synthesiseId`. */
function synthesiseAdapterId(orgId: string, name: string): string {
  return `synthetic-adapter-${orgId.slice(0, 8)}-${name}`;
}

export const scaffoldReadiness = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/scaffold-readiness",
  },
  async (): Promise<ScaffoldReadinessResponse> => {
    const auth = getAuthData()!;
    const status = getInitStatus();

    // Spec 199 FR-002 — adapters resolve by manifest-declared identity.
    // Spec 199 FR-009 / spec 198 D-5 — the scaffold source is resolved at
    // ADMISSION time; readiness reads the admission record, not a
    // manifest-injected scaffold_source_id.
    const substrate = await loadSubstrateForOrg(auth.orgId);
    const views = listAdapterViews(substrate);
    const hasFactoryAdapter = views.length > 0;

    const admissionByOrigin = new Map<
      string,
      Awaited<ReturnType<typeof loadLatestAdmission>>
    >();
    for (const view of views) {
      if (!admissionByOrigin.has(view.origin)) {
        admissionByOrigin.set(
          view.origin,
          await loadLatestAdmission(auth.orgId, view.origin),
        );
      }
    }

    const adapters: AdapterReadinessVerdict[] = views.map((view) => {
      const admission = admissionByOrigin.get(view.origin)!;
      const resolution = admission.scaffoldResolutions[view.name];
      const declaresScaffoldSource = Boolean(
        (view.manifest.scaffold as Record<string, unknown> | undefined)
          ?.source,
      );
      // Spec 199 FR-009 — Create-eligibility is "the admission record
      // resolved this adapter's scaffold source" AND the factory is
      // admitted (spec 198 FR-001: no bind without admission).
      const scaffoldSourceResolved = Boolean(resolution);
      const createEligible =
        scaffoldSourceResolved && admission.status === "admitted";
      return {
        id: synthesiseAdapterId(auth.orgId, view.name),
        name: view.name,
        declaresScaffoldSource,
        scaffoldSourceResolved,
        createEligible,
      };
    });

    const scaffoldSourceResolved = adapters.some(
      (a) => a.scaffoldSourceResolved,
    );
    const anyEligibleAdapter = adapters.some((a) => a.createEligible);

    const pat = await loadFactoryUpstreamPatToken(auth.orgId).catch(
      () => null,
    );
    const hasUpstreamPat = Boolean(pat);

    const blocker = resolveBlocker({
      hasFactoryAdapter,
      anyDeclaresScaffoldSource: adapters.some((a) => a.declaresScaffoldSource),
      scaffoldSourceResolved,
      hasUpstreamPat,
      warmupReady: status.ready,
      warmupError: status.error,
    });

    return {
      ready: status.ready,
      step: status.step,
      progress: status.progress,
      error: status.error,
      hasFactoryAdapter,
      hasUpstreamPat,
      scaffoldSourceResolved,
      adapters,
      canCreate: status.ready && hasFactoryAdapter && anyEligibleAdapter,
      blocker,
    };
  },
);
