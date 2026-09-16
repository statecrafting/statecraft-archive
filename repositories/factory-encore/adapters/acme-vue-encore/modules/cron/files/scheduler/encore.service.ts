import { Service } from "encore.dev/service";
import { startDaemon } from "./worker";

// Tie the polling daemon to service initialization (FR-005), not to a bare
// top-level import side-effect in worker.ts. The first tick is error-tolerant,
// so it absorbs any connection-pool warmup.
startDaemon();

export default new Service("scheduler");
