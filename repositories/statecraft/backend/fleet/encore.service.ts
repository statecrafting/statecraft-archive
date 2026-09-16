import { Service } from "encore.dev/service";

import { csrfMiddleware } from "../lib/csrf";
import { apiRateLimit } from "../lib/rate-limit";
import { obsMiddleware } from "../obs/middleware";

// The fleet service (spec 006): operates stamped EnRaHiTu apps on the
// hetzner-k3s cluster via the fleet-native addon. Unlike tenants/factory this
// service carries a DELETE verb (remove), so it mounts csrfMiddleware alongside
// the general rate-limit tier: a destructive browser call must present the
// double-submit token (the auth service's posture, not tenants/factory's
// omission). Every mutating verb writes a FleetOp intent-journal row and, when
// governance (spec 008) is reachable, gates through the action gate.
// Observation outermost (spec 012).
export default new Service("fleet", {
  middlewares: [obsMiddleware, apiRateLimit, csrfMiddleware],
});
