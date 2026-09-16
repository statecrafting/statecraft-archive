/**
 * The admin API (enrahitu spec 023 §3.3, adopted under spec 012): Overview
 * (the governed-cell page), Catalog (model services/endpoints/capabilities),
 * and Traces (the spec 022 buffer). Read-only renders of the platform's own
 * truth: the loaded model, its load receipt, the governance spine, the trace
 * buffer. The API caller is a dashboard concern (spec 023 §3.3 amendment):
 * the browser calls target endpoints same-origin with its own session.
 *
 * Divergence from the chassis (spec 012): the platform has no kernel
 * Decision ledger; the Overview's ledger panel renders the spec 008
 * attestation chain instead (governance-native ledgerVerify), which is the
 * platform's real tamper-evident ledger.
 */
import { api, APIError } from "encore.dev/api";

import { governanceStateDir } from "../governance/config";
import native from "../governance/native";
import { modelJson, receipt } from "../lib/app-model";
import type { BufferedTrace, TraceSummary } from "../obs/traces";
import { getTrace, listTraces } from "../obs/traces";

import { requireOperator } from "./gate";

interface ModelDoc {
  app: { name: string; org?: string };
  contract: { name: string; version: string };
  source?: { revision?: string; uncommittedChanges?: boolean };
  extraction?: { producers?: { tool: string; version: string; tier: string }[] };
  capabilities: { id: string; kind: string; resource: string }[];
  services: {
    name: string;
    tier: string;
    capabilities: string[];
    endpoints: {
      name: string;
      path: string;
      methods: string[];
      access: string;
      raw?: boolean;
    }[];
  }[];
  agents: unknown[];
  trust?: { levels?: string[] };
  gate?: { checks?: string[]; configHash?: string };
  observability?: { metricsPath?: string; otel?: boolean };
  auth?: { idp?: string; operatorRole?: string };
  resources?: Record<string, { name?: string; id?: string }[]>;
}

const model = JSON.parse(modelJson) as ModelDoc;

export interface OverviewResponse {
  app: { name: string; org?: string };
  contract: { name: string; version: string };
  model: {
    hash: string;
    gateConfigHash: string;
    revision?: string;
    uncommittedChanges?: boolean;
    producers: { tool: string; version: string; tier: string }[];
  };
  counts: { services: number; endpoints: number; capabilities: number; agents: number };
  observability: { metricsPath?: string; otel?: boolean };
  auth: { idp?: string; operatorRole?: string };
  trust: { levels: string[] };
  gate: { checks: string[] };
  ledger: { records: number; headId?: string; chainVerified: boolean; chainError?: string };
}

export const overview = api(
  { expose: true, auth: true, method: "GET", path: "/api/admin/overview" },
  async (): Promise<OverviewResponse> => {
    requireOperator();
    // The attestation chain (spec 008): governance-native re-verifies the
    // whole chain independently on every call.
    const chain = native.ledgerVerify(governanceStateDir());
    return {
      app: model.app,
      contract: model.contract,
      model: {
        hash: receipt.modelHash,
        gateConfigHash: receipt.gateConfigHash,
        revision: model.source?.revision,
        uncommittedChanges: model.source?.uncommittedChanges,
        producers: model.extraction?.producers ?? [],
      },
      counts: {
        services: model.services.length,
        endpoints: model.services.reduce((n, svc) => n + svc.endpoints.length, 0),
        capabilities: model.capabilities.length,
        agents: model.agents.length,
      },
      observability: model.observability ?? {},
      auth: model.auth ?? {},
      trust: { levels: model.trust?.levels ?? [] },
      gate: { checks: model.gate?.checks ?? [] },
      ledger: {
        records: chain.seq,
        chainVerified: chain.ok,
        chainError: chain.error,
      },
    };
  },
);

export interface CatalogResponse {
  services: ModelDoc["services"];
  capabilities: ModelDoc["capabilities"];
  resources: Record<string, { name?: string; id?: string }[]>;
}

export const catalog = api(
  { expose: true, auth: true, method: "GET", path: "/api/admin/catalog" },
  async (): Promise<CatalogResponse> => {
    requireOperator();
    return {
      services: model.services,
      capabilities: model.capabilities,
      resources: model.resources ?? {},
    };
  },
);

export interface TraceListResponse {
  traces: TraceSummary[];
}

export const traces = api(
  { expose: true, auth: true, method: "GET", path: "/api/admin/traces" },
  async ({ limit }: { limit?: number }): Promise<TraceListResponse> => {
    requireOperator();
    return { traces: listTraces(limit && limit > 0 ? Math.min(limit, 200) : 50) };
  },
);

export interface TraceDetailResponse {
  trace: BufferedTrace;
}

export const traceDetail = api(
  { expose: true, auth: true, method: "GET", path: "/api/admin/traces/:id" },
  async ({ id }: { id: string }): Promise<TraceDetailResponse> => {
    requireOperator();
    const trace = getTrace(id);
    if (!trace) throw APIError.notFound("trace not in the buffer window");
    return { trace };
  },
);
