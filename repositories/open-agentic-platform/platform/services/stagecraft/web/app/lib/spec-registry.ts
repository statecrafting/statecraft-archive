// Typed access to the governed registry projection (see
// scripts/gen-spec-registry.mjs). The data is a build-time snapshot of OAP's
// own compiled spec corpus, read through the `spec-spine registry` consumer.

import data from "./spec-registry.generated.json";
export { DOMAIN_COLORS } from "./domain-colors";

export interface SpecRow {
  id: string;
  num: string;
  title: string;
  status: string;
  implementation: string;
  kind: string;
  domain: string;
  created: string;
  tags: string[];
  summary: string;
}

export interface SpecEdge {
  source: string;
  target: string;
  type: string;
}

export interface RegistryData {
  generatedAt: string;
  total: number;
  counts: {
    status: Record<string, number>;
    implementation: Record<string, number>;
    domain: Record<string, number>;
    kind: Record<string, number>;
  };
  specs: SpecRow[];
  edges: SpecEdge[];
}

export const registry = data as RegistryData;
export const specs: SpecRow[] = registry.specs;
export const edges: SpecEdge[] = registry.edges;

export function getSpec(id: string): SpecRow | undefined {
  return specs.find((s) => s.id === id);
}

export function uniqueValues(field: keyof SpecRow): string[] {
  const set = new Set<string>();
  for (const s of specs) {
    const v = s[field];
    if (typeof v === "string" && v) set.add(v);
  }
  return [...set].sort();
}
