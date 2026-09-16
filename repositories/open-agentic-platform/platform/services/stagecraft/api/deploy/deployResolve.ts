// Spec 214: pure resolution helpers for the deploy proxy (api/deploy/deploy.ts).
//
// Kept free of Encore and DB imports so they unit-test under plain vitest, the
// same way chartSelector.ts and hostname.ts do. deploy.ts composes these with
// the DB lookups (env -> project -> org) and the wire forward.

import { listShapes, selectChart } from "./chartSelector";
import type { ChartSelection, TenantShape } from "./chartSelector";

/**
 * Config-ref keys with these prefixes are rejected at the proxy (FR-004).
 * `ENCORE_*` and `KUBERNETES_*` are owned by the Encore runtime and the
 * platform respectively; letting a tenant set them via `config_refs` would
 * let app config silently override runtime/infra wiring.
 */
export const RESERVED_CONFIG_REF_PREFIXES = ["ENCORE_", "KUBERNETES_"] as const;

/**
 * True when a `config_refs` key collides with a reserved runtime/platform
 * prefix. Compared case-insensitively: env-var convention is uppercase, and a
 * lowercase spelling would resolve to the same process env var, so both are
 * rejected.
 */
export function isReservedConfigRefKey(key: string): boolean {
  const upper = key.toUpperCase();
  return RESERVED_CONFIG_REF_PREFIXES.some((p) => upper.startsWith(p));
}

function isKnownShape(s: string): s is TenantShape {
  return (listShapes() as string[]).includes(s);
}

/**
 * Resolve the tenant chart shape for a dispatch (FR-002).
 *
 * Sole-shape mapping: any factory-created project (a non-empty
 * `factoryAdapterId`) deploys as `acme-vue-encore`, the one real post-cutover
 * shape. The spec hand-authors one chart for the one active adapter;
 * per-adapter chart generation is out of scope until a second real shape
 * exists, so the project's synthetic adapter id need not be decoded here, only
 * its presence checked. An explicit caller-supplied chart name wins when it is
 * a registered shape (back-compat for callers that drive the chart directly).
 * Returns `null` when no shape can be derived, leaving deployd to apply its
 * own default.
 */
export function resolveTenantShape(
  factoryAdapterId: string | null | undefined,
  explicitChart?: string,
): TenantShape | null {
  if (explicitChart && isKnownShape(explicitChart)) return explicitChart;
  if (factoryAdapterId && factoryAdapterId.length > 0) return "acme-vue-encore";
  return null;
}

/**
 * Resolve a full `{chart, version}` selection (or `null` when no shape is
 * derivable). Thin composition of [`resolveTenantShape`] and `selectChart`.
 */
export function resolveChartSelection(
  factoryAdapterId: string | null | undefined,
  explicitChart?: string,
): ChartSelection | null {
  const shape = resolveTenantShape(factoryAdapterId, explicitChart);
  return shape ? selectChart({ shape }) : null;
}
