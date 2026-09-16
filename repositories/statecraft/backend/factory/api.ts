/**
 * Factory API (spec 005 §3). Auth as spec 004: every endpoint requires auth and
 * is owner-scoped through the tenant (a job whose tenant the caller does not own
 * reads as 404). POST kicks the async pipeline and returns the job; the two GETs
 * report status. Posture is REQUEST-EXPLICIT: a stamp with no posture is
 * rejected, never defaulted.
 */
import { APIError, api } from "encore.dev/api";
import { getAuthData } from "~encore/auth";

import { authorizeTenant, principalFrom } from "../tenants/access/authz";
import { listInstallationsForTenant } from "../tenants/store";

import { isStampMode } from "./attest";
import { isPosture } from "./cert";
import { TEMPLATE_REF } from "./config";
import type { Posture, StampJob, StampMode } from "./entities";
import { runStampPipeline } from "./pipeline";
import { createOrGetLiveJob, getJob, listJobsForTenant } from "./store";

export interface StampJobView {
  id: string;
  tenantId: string;
  appName: string;
  org: string;
  frontend: string;
  mode: string;
  pages: boolean;
  templateRef: string;
  contractVersion: string;
  posture: string;
  status: string;
  certHash: string | null;
  prUrl: string | null;
  checksRunId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

function toView(j: StampJob): StampJobView {
  return {
    id: j.id,
    tenantId: j.tenantId,
    appName: j.appName,
    org: j.org,
    frontend: j.frontend,
    mode: j.mode,
    pages: j.pages,
    templateRef: j.templateRef,
    contractVersion: j.contractVersion,
    posture: j.posture,
    status: j.status,
    certHash: j.certHash,
    prUrl: j.prUrl,
    checksRunId: j.checksRunId,
    error: j.error,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

interface CreateStampRequest {
  id: string;
  appName: string;
  targetOrg: string;
  frontend?: string;
  posture: string;
  /** How the stamp lands: "create" a new repo (default) or "adopt" an existing one. */
  mode?: string;
  /** Opt in (create mode) to provisioning GitHub Pages on the new repo. */
  pages?: boolean;
}

/**
 * POST /api/v1/tenants/:id/stamps: queue a stamp job and kick the pipeline.
 * Idempotent: a live job for the same tenant + appName is returned as-is.
 * `mode` selects create (new repo, default) vs adopt (PR onto an existing repo).
 */
export const createStamp = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/tenants/:id/stamps" },
  async ({ id, appName, targetOrg, frontend, posture, mode, pages }: CreateStampRequest): Promise<StampJobView> => {
    const auth = getAuthData()!;
    const tenant = await authorizeTenant(id, principalFrom(auth), "write");
    if (!tenant) throw APIError.notFound("tenant not found");

    const name = (appName ?? "").trim();
    if (!name) throw APIError.invalidArgument("appName is required");
    const org = (targetOrg ?? "").trim();
    if (!org) throw APIError.invalidArgument("targetOrg is required");
    if (!posture || !isPosture(posture)) {
      throw APIError.invalidArgument("posture is required and must be one of none, assisted, autonomous");
    }
    const stampMode: StampMode = (mode ?? "create").trim() as StampMode;
    if (!isStampMode(stampMode)) {
      throw APIError.invalidArgument("mode must be one of create, adopt");
    }

    const installs = await listInstallationsForTenant(id);
    const inst = installs.find((i) => i.githubOrg === org && i.status === "active");
    if (!inst) {
      throw APIError.failedPrecondition(`tenant has no active installation for org ${org}`);
    }

    const { job, created } = await createOrGetLiveJob({
      tenantId: id,
      installationId: inst.installationId,
      appName: name,
      org,
      // Frontend flavor (enrahitu spec 015): normalized here, validated against
      // the contract's [slots].frontend.allowed by the pipeline (validateSlots),
      // like app_name's pattern. Empty means the template default.
      frontend: (frontend ?? "").trim(),
      mode: stampMode,
      pages: pages ?? false,
      templateRef: TEMPLATE_REF,
      contractVersion: "",
      posture: posture as Posture,
    });
    if (created) void runStampPipeline(job.id).catch(() => {});
    return toView(job);
  },
);

interface StampJobParams {
  jobId: string;
}

/** GET /api/v1/stamps/:jobId: job status (owner-scoped via the job's tenant). */
export const getStamp = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/stamps/:jobId" },
  async ({ jobId }: StampJobParams): Promise<StampJobView> => {
    const auth = getAuthData()!;
    const job = await getJob(jobId);
    if (!job) throw APIError.notFound("stamp job not found");
    const tenant = await authorizeTenant(job.tenantId, principalFrom(auth), "read");
    if (!tenant) throw APIError.notFound("stamp job not found");
    return toView(job);
  },
);

interface ListStampsResponse {
  stamps: StampJobView[];
}

/** GET /api/v1/tenants/:id/stamps: the tenant's stamp jobs, newest first. */
export const listStamps = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/tenants/:id/stamps" },
  async ({ id }: { id: string }): Promise<ListStampsResponse> => {
    const auth = getAuthData()!;
    const tenant = await authorizeTenant(id, principalFrom(auth), "read");
    if (!tenant) throw APIError.notFound("tenant not found");
    const rows = await listJobsForTenant(id);
    return { stamps: rows.map(toView) };
  },
);
