import { Service } from "encore.dev/service";

import { obsMiddleware } from "../obs/middleware";

// The governance spine: record/verify attestations, evaluate the action gate,
// and score per-actor trust. The tamper-evident chain and the gate decisions
// are computed in-process by the governance-native addon (spec 008); this
// service is the Encore.ts surface factory (005) and fleet (006) call at their
// privileged moments. Instrumented (spec 012).
export default new Service("governance", { middlewares: [obsMiddleware] });
