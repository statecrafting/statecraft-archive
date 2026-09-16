import { describe, it, expect } from "vitest";
import { killProcess } from "./kill_process";

// Spec 187 [[opc-e2e-auth-state-seeding]]. The positive kill path (SIGKILL a
// real sidecar) is exercised by the nightly 183 AC-8 fixture against
// axiomregent; a unit test that pgrep-kills by a common name would over-match
// unrelated processes on the runner, so here we only assert the safe,
// deterministic no-match contract (0 killed, not an error).

describe("killProcess", () => {
  it("returns 0 and does not throw when nothing matches", async () => {
    const killed = await killProcess({
      name: "definitely-not-a-real-process-xyzzy-187",
    });
    expect(killed).toBe(0);
  });
});
