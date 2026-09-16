import { Service } from "encore.dev/service";

import { apiRateLimit } from "../lib/rate-limit";
import { obsMiddleware } from "../obs/middleware";

// The factory service (spec 005): stamps EnRaHiTu apps into customer orgs. The
// general API rate-limit tier is mounted here; the actual stamping runs as an
// un-awaited pipeline keyed off the StampJob status (single-flight per job).
// Observation outermost (spec 012).
export default new Service("factory", { middlewares: [obsMiddleware, apiRateLimit] });
