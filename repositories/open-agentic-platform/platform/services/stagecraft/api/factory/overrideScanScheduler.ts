// Spec 200 FR-001 — staleness sweeper cron for override scan runs.
// Re-drives `queued` rows whose publish was lost and fails stale `running`
// rows (`STATECRAFT_OVERRIDE_SCAN_STALE_AFTER_SEC`, default 600). Mirrors
// the spec 115 extraction-staleness-sweeper shape.

import { api } from "encore.dev/api";
import { CronJob } from "encore.dev/cron";
import log from "encore.dev/log";
import { sweepOverrideScanRuns } from "./overrideScanCore";

export const runOverrideScanStalenessSweep = api(
  {
    expose: false,
    method: "POST",
    path: "/internal/factory/override-scan-staleness-sweep",
  },
  async (): Promise<void> => {
    try {
      const result = await sweepOverrideScanRuns();
      if (result.redriven > 0 || result.failed > 0) {
        log.info("override-scan staleness sweep: rows recovered", result);
      }
    } catch (err) {
      log.error("override-scan staleness sweep failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

const _overrideScanSweeper = new CronJob("override-scan-staleness-sweeper", {
  title: "Factory Override Scan Staleness Sweeper",
  every: "1m",
  endpoint: runOverrideScanStalenessSweep,
});
void _overrideScanSweeper;
