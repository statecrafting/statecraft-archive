import { Service } from "encore.dev/service";
import { securityHeaders } from "../lib/security-headers";
import { csrfMiddleware } from "../lib/csrf";
import { apiRateLimit } from "../lib/rate-limit";

// State-changing proxy calls carry the SPA's X-CSRF-Token (spec 004 FR / INV-4).
export default new Service("gateway", {
  middlewares: [securityHeaders, csrfMiddleware, apiRateLimit],
});
