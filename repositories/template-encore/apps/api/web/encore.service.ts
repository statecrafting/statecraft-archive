import { Service } from "encore.dev/service";

// No middleware (spec 005 FR-001): static assets must cache normally, so the
// no-store securityHeaders middleware is deliberately omitted here.
export default new Service("web");
