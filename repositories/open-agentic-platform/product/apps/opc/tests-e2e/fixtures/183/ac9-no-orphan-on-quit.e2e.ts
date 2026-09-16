import { describe, it, afterEach } from "vitest";
import { launchOpc, type OpcSession } from "../_session";
import { assertNoOrphan } from "../../harness/process_tree";

// Spec 183 AC-9 (migrated; spec 187 AC-9 / FR-T7). Invoking Quit from the boot
// screen MUST leave no axiomregent process running. The boot gate spawns the
// sidecar; Quit must reap it. No sign-in is required (Quit is a boot-screen
// affordance), so this runs in the nightly without auth-state seeding.
//
// Co-authority (FR-T7): shape governed by spec 187, content by spec 183.

describe("183 AC-9 — Quit from boot screen leaves no orphan sidecar", () => {
  let session: OpcSession | undefined;
  afterEach(async () => {
    await session?.teardown();
    session = undefined;
  });

  it("kills the axiomregent sidecar on Quit", async () => {
    session = await launchOpc({ mode: "handshake-rejects" });
    const { driver, browser } = session;

    await driver.waitForPhase("boot", { timeoutMs: 15_000 });

    // "Quit OPC" is the boot-screen affordance (spec 183 §boot affordances).
    const quit = await browser.$("button=Quit OPC");
    await quit.click();

    // The SIGKILL -> process-table cleanup race is tolerated by bounded backoff
    // (FR-T3c). assertNoOrphan throws if axiomregent survives the window.
    await assertNoOrphan({ name: "axiomregent" }, { timeoutMs: 8_000 });
  });
});
