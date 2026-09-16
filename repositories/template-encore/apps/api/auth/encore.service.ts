import { Service } from "encore.dev/service";
import { securityHeaders } from "../lib/security-headers";
import { csrfMiddleware } from "../lib/csrf";
import { apiRateLimit } from "../lib/rate-limit";

// Middlewares run in declaration order (spec 003 FR-005). SSO callbacks and
// /auth/refresh are CSRF-exempt (handled inside csrfMiddleware).
export default new Service("auth", {
  middlewares: [securityHeaders, csrfMiddleware, apiRateLimit],
});
