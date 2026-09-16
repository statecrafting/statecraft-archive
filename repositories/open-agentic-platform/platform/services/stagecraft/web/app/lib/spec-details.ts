// Rich per-spec detail from the governed projection (see
// scripts/gen-spec-registry.mjs). This module imports a large JSON, so it MUST
// only be referenced from a route `loader` (server-only). The detail route
// returns a single spec's record to the client; the full blob never ships.

import data from "./spec-details.generated.json";

export interface SpecRef {
  id: string;
  title: string;
}

export interface SpecDetailRecord {
  id: string;
  num: string;
  title: string;
  status: string;
  implementation: string;
  kind: string;
  domain: string;
  created: string;
  owner: string;
  risk: string;
  slug: string;
  dates: { amended: string; closed: string };
  summary: string;
  specPath: string;
  codeAliases: string[];
  sectionHeadings: string[];
  establishes: { kind: string; path: string }[];
  extendsSpecs: (SpecRef & { nature: string })[];
  refines: { aspect: string; unit: string }[];
  amendsSpecs: SpecRef[];
  supersedesSpecs: SpecRef[];
  supersededBy: SpecRef | null;
  amendedBy: SpecRef | null;
  amendmentNote: string;
  timeline: { date: string; type: string; label: string }[];
  dependsOnSpecs: SpecRef[];
  constrains: { kind: string; targets: SpecRef[] }[];
  references: { unit: string; role: string }[];
  incoming: (SpecRef & { type: string })[];
  directDependents: SpecRef[];
  transitiveDependentCount: number;
  related: { id: string; num: string; title: string; status: string; sharedTags: string[] }[];
  body: string;
  bodyTruncated: boolean;
}

// Map, not a plain object: bracket access on a plain object resolves reserved
// prototype keys ("__proto__", "constructor", ...) to truthy prototype values,
// which would slip past the not-found guard for URLs like /registry/__proto__.
const details = new Map<string, SpecDetailRecord>(
  Object.entries((data as { details: Record<string, SpecDetailRecord> }).details)
);

export function getSpecDetail(id: string): SpecDetailRecord | undefined {
  return details.get(id);
}
