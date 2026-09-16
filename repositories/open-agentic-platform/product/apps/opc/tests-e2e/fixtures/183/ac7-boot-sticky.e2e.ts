import { describe, it, expect, afterEach } from "vitest";
import { launchOpc, type OpcSession } from "../_session";

// Spec 183 AC-7 (migrated; spec 187 AC-9 / FR-T7). Sidecar present but
// statecraft unreachable: the boot screen renders and STAYS; the cockpit MUST
// NOT appear. The mock runs in handshake-rejects so the local sidecar liveness
// probe passes (a real axiomregent is spawned) while sync.hello never arrives,
// so org-session-ready never flips. This is the load-bearing assertion for the
// constitutional claim that the cockpit cannot render before preconditions.
//
// Co-authority (FR-T7): shape governed by spec 187, content (this assertion)
// by spec 183.

describe("183 AC-7 — boot stays sticky when statecraft is unreachable", () => {
  let session: OpcSession | undefined;
  afterEach(async () => {
    await session?.teardown();
    session = undefined;
  });

  it("renders BootGate and never mounts the cockpit", async () => {
    session = await launchOpc({ mode: "handshake-rejects" });
    const { driver } = session;

    await driver.waitForPhase("boot", { timeoutMs: 15_000 });

    // Hold the observation window: the cockpit must not appear even though the
    // sidecar is alive (FR-T1 passes, FR-T2 stalls on sync.hello).
    await new Promise((r) => setTimeout(r, 4_000));
    expect(await driver.mountedComponent()).toBe("boot");
  });
});
