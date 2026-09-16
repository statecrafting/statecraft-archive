/**
 * GET /api/v1/auth/csrf-token: issue a CSRF token (spec 002 INV-4, spec 006 FR-002).
 * Sets the httpOnly csrf cookie and returns the same token in the body so the SPA
 * can replay it as the X-CSRF-Token header on state-changing requests.
 */
import { api } from "encore.dev/api";
import { generateCsrfToken } from "../lib/csrf";
import { setCsrfCookie } from "../lib/cookies";
import { writeJson } from "./http";

export const csrfToken = api.raw(
  { expose: true, method: "GET", path: "/api/v1/auth/csrf-token" },
  async (_req, res) => {
    const token = generateCsrfToken();
    setCsrfCookie(res, token);
    writeJson(res, 200, { token });
  },
);
