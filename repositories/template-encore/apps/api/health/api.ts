import { api, APIError } from "encore.dev/api";
import { db } from "../db/db";
import { env } from "../lib/env";
import { logInfo } from "../lib/logger";

interface HealthResponse {
  status: "ok";
  service: string;
  timestamp: string;
}

interface ReadinessResponse {
  status: "ok";
  checks: Record<string, "ok">;
  timestamp: string;
}

interface InfoResponse {
  name: string;
  version: string;
  environment: "production" | "development";
  timestamp: string;
}

// Liveness: the process is up. Always 200 (no dependency checks).
export const liveness = api(
  { expose: true, method: "GET", path: "/health/liveness" },
  async (): Promise<HealthResponse> => ({
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
  }),
);

// Readiness: dependencies are reachable. 503 (via APIError.unavailable) if not.
export const readiness = api(
  { expose: true, method: "GET", path: "/health/readiness" },
  async (): Promise<ReadinessResponse> => {
    try {
      await db.queryRow`SELECT 1 AS ok`;
    } catch {
      throw APIError.unavailable("database not ready");
    }
    return { status: "ok", checks: { database: "ok" }, timestamp: new Date().toISOString() };
  },
);

// Composite health check.
export const health = api(
  { expose: true, method: "GET", path: "/health" },
  async (): Promise<HealthResponse> => ({
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
  }),
);

// API metadata.
export const info = api(
  { expose: true, method: "GET", path: "/api/v1/info" },
  async (): Promise<InfoResponse> => ({
    name: "vue-encore-enterprise-template",
    version: "0.1.0",
    environment: env.isProduction ? "production" : "development",
    timestamp: new Date().toISOString(),
  }),
);

// CSP violation sink. Browsers POST report-to / report-uri payloads here; we log
// a truncated copy and return 204. Unauthenticated by design.
export const cspReport = api.raw(
  { expose: true, method: "POST", path: "/api/v1/csp-report" },
  async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString("utf8");
      if (body) logInfo("csp.report", { report: body.slice(0, 4000) });
    } catch {
      // never let a malformed report break the endpoint
    }
    res.statusCode = 204;
    res.end();
  },
);
