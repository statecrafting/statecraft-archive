import { Service } from "encore.dev/service";
import { securityHeaders } from "../lib/security-headers";

// Probes and CSP reports are unauthenticated, so only securityHeaders is mounted
// (no CSRF, no rate limiting). Spec 001.
export default new Service("health", { middlewares: [securityHeaders] });
