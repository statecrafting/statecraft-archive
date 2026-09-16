import { Service } from "encore.dev/service";
import { securityHeaders } from "../lib/security-headers";
import { csrfMiddleware } from "../lib/csrf";
import { apiRateLimit } from "../lib/rate-limit";

/**
 * User-management service (spec 003): the reference Encore feature module.
 *
 * Owns the app-managed role catalog (app_role) and per-user assignments
 * (user_role), and the admin CRUD surface over them at /api/v1/admin/*.
 * Identity (user_account) is owned by the auth/db services; this service
 * reads it for the admin user list and joins its own role tables on top.
 *
 * Composes the same lib middleware chain as the auth service (declaration
 * order): securityHeaders -> csrfMiddleware -> apiRateLimit. All endpoints are
 * auth:true and enforce requireRole("admin","user-manager") inline.
 */
export default new Service("user-management", {
  middlewares: [securityHeaders, csrfMiddleware, apiRateLimit],
});
