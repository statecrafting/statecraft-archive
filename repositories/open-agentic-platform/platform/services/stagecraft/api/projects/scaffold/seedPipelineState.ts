// Spec 112 §3.5 — L0 pipeline-state.json seed.
//
// Statecraft is the sole author of commit #1's `.factory/pipeline-state.json`
// for newly-created factory projects. Post-commit writes are OPC's
// responsibility (spec 112 §5.4 boundary).
//
// The L0 shape carries only identity: no started_at, no stages, status
// "pending". The ACP engine transitions this to "running" on first stage
// execution.

import { randomUUID } from "node:crypto";
import type { ScaffoldAdapterRef } from "./types";

export interface L0PipelineStateSeed {
  schema_version: "1.0.0";
  pipeline: {
    id: string;
    factory_version: string;
    started_at: string | null;
    updated_at: string;
    status: "pending";
    adapter: { name: string; version: string; source_sha: string };
    build_spec: { path: string | null; hash: string | null };
  };
  stages: Record<string, never>;
}

export function buildL0PipelineStateSeed(
  adapter: ScaffoldAdapterRef,
  factoryVersion = "acp-1.0.0"
): L0PipelineStateSeed {
  const now = new Date().toISOString();
  return {
    schema_version: "1.0.0",
    pipeline: {
      id: randomUUID(),
      factory_version: factoryVersion,
      started_at: null,
      updated_at: now,
      status: "pending",
      adapter: {
        name: adapter.name,
        version: adapter.version,
        source_sha: adapter.sourceSha,
      },
      build_spec: { path: null, hash: null },
    },
    stages: {},
  };
}
