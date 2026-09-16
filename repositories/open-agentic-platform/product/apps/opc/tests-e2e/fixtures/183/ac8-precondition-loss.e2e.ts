import { afterEach, describe, expect, it } from "vitest";
import { launchOpc, type OpcSession } from "../_session";
import { killProcess } from "../../harness/kill_process";

// Spec 183 AC-8 (migrated; spec 187 AC-9 / FR-T7). From a fully-signed-in
// cockpit, killing the axiomregent sidecar MUST unmount the cockpit and remount
// <BootGate> within an implementer-bounded window (~2s of CommandEvent::
// Terminated observation).
//
// Previously `describe.skip` (FR-T6 manual-only): reaching a signed-in cockpit
// headlessly was impossible. The spec 187 [[opc-e2e-auth-state-seeding]]
// follow-up added `seedSignedInSession` (via launchOpc's `seedSession` option)
// and `killProcess`, so this AC now runs in the nightly. OPC never verifies the
// session JWT's signature, so a seeded fake token + the healthy mock duplex
// (which accepts any bearer and emits sync.hello) is enough to flip
// `org_session_ready = has_org && sync_hello` and mount the cockpit.
describe("183 AC-8: cockpit reverts to BootGate on sidecar kill", () => {
  let session: OpcSession | undefined;

  afterEach(async () => {
    await session?.teardown();
    session = undefined;
  });

  it("remounts <BootGate> within the AC-8 window when axiomregent is killed", async () => {
    session = await launchOpc({ mode: "healthy", seedSession: true });
    const { driver } = session;

    // Seeded session + healthy mock => both boot preconditions hold, so the
    // cockpit mounts. A generous timeout absorbs first-launch WebView + sidecar
    // warmup on the CI runner.
    await driver.waitForPhase("cockpit", { timeoutMs: 20_000 });

    // Kill the sidecar out from under the signed-in cockpit. The name path
    // matches comm (process_tree/kill_process convention), not the argv.
    const killed = await killProcess({ name: "axiomregent" });
    expect(killed).toBeGreaterThan(0);

    // sidecar_alive drops -> boot_gate_status no longer satisfied -> the shell
    // remounts <BootGate>. Assert within the AC-8 observation window.
    await driver.waitForPhase("boot", { timeoutMs: 3_000 });
  });
});
