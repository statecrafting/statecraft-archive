import { afterEach, describe, expect, it } from "vitest";
import { launchOpc, type OpcSession } from "../_session";

// Spec 208 FR-005 / AC-5: the org kill-switch pull-and-lift drill.
//
// "A kill switch that has never been pulled is decoration" (FR-005). This drill
// pulls an org halt against a live, seeded cockpit over the spec-187
// mock-statecraft seam and asserts the REAL client-side propagation bound: the
// OPC duplex client (on_org_halt_activated, live_sessions.rs) acknowledges the
// halt and, after the lift, the reintegration. Those per-engine ack timestamps
// are what FR-003/FR-004 make "an audited fact after every pull".
//
// Scope of this client drill (kept honest about what runs against the mock):
//  - connected leg: REAL. The seeded cockpit runs the halt handler and emits
//    org.halt.ack over the duplex (both the halt and the lift kinds). The
//    literal pause-and-checkpoint of a *running* session is NOT asserted here:
//    seeding a live session needs a Tauri invoke (create_checkpoint), which the
//    harness cannot reach because withGlobalTauri is off (no window.__TAURI__).
//    The ack IS the FR-003 propagation-bound evidence, so that is what the drill
//    measures.
//  - disconnected leg: modeled. The OPC sync client has no local halt-awareness
//    (it retries any non-101 handshake with backoff, sync_client.rs), so
//    "refused at the reconnect handshake" is the server's job. The mock refuses
//    the handshake (standing in for a halted statecraft) and the drill asserts
//    the boot gate stays sticky.
//  - idle "next action refused" (AC-1): OUT OF SCOPE for a client drill. That is
//    a statecraft-side grant/registration refusal (AC-2), covered by
//    platform/services/statecraft/api/factory/orgHalt.test.ts.
//
// Runs in the spec-187 nightly lane, auto-discovered by the fixtures/**/*.e2e.ts
// glob (vitest.e2e.config.ts), so no workflow edit is required (T021).

const ORG_ID = "org_drill";
const HALT_ID = "halt-drill-1";
// MUST equal ENVELOPE_SCHEMA_VERSION (sync_client.rs / mock_statecraft.ts). The
// desktop client silently drops any frame whose meta.v differs.
const ENVELOPE_V = 2;

interface OrgHaltAck {
  kind: string;
  haltId: string;
  haltKind: "halt" | "lift";
  ackedAt: string;
}

/**
 * Build an org.halt.* frame in the exact shape ServerEnvelopeWire deserializes
 * (flat top-level kind/haltId/scope/scopeKey, nested meta). `detail` rides only
 * on org.halt.activated. Scope "org" drives the real halt_aware_terminate path
 * (project / agent-profile scopes are ack-only no-ops in Phase 2).
 */
function orgHaltFrame(
  kind: "org.halt.activated" | "org.halt.lifted",
  detail?: string,
): Record<string, unknown> {
  const frame: Record<string, unknown> = {
    kind,
    meta: {
      v: ENVELOPE_V,
      eventId: `${kind}-${HALT_ID}`,
      sentAt: new Date().toISOString(),
      orgCursor: "drill-cursor-1",
      orgId: ORG_ID,
    },
    haltId: HALT_ID,
    scope: "org",
    scopeKey: ORG_ID,
  };
  if (detail !== undefined) frame.detail = detail;
  return frame;
}

/** Match the client's org.halt.ack for this drill's halt id and a given kind. */
function isOrgHaltAck(haltKind: "halt" | "lift"): (frame: unknown) => boolean {
  return (frame) => {
    const f = frame as Partial<OrgHaltAck>;
    return f.kind === "org.halt.ack" && f.haltId === HALT_ID && f.haltKind === haltKind;
  };
}

describe("208 FR-005: org kill-switch pull-and-lift drill", () => {
  let session: OpcSession | undefined;

  afterEach(async () => {
    await session?.teardown();
    session = undefined;
  });

  it("connected engine acks the halt pull and the lift over the duplex", async () => {
    session = await launchOpc({ mode: "healthy", orgId: ORG_ID, seedSession: true });
    const { driver, mock } = session;

    // Reaching cockpit proves the duplex handshake completed (sync.hello
    // received), so the mock has retained the client socket to push onto.
    await driver.waitForPhase("cockpit", { timeoutMs: 20_000 });

    // Pull the halt. on_org_halt_activated runs halt_aware_terminate (org scope)
    // then send_org_halt_ack(Halt): assert the REAL ack over the duplex.
    mock.push(orgHaltFrame("org.halt.activated", "drill: operator pull"));
    const haltAck = (await mock.waitForFrame(isOrgHaltAck("halt"), 15_000)) as OrgHaltAck;
    expect(haltAck.haltKind).toBe("halt");
    expect(typeof haltAck.ackedAt).toBe("string");
    expect(haltAck.ackedAt.length).toBeGreaterThan(0);

    // Lift. on_org_halt_lifted then send_org_halt_ack(Lift): staged
    // reintegration, a distinct per-engine ack timestamp for the lift (FR-004).
    mock.push(orgHaltFrame("org.halt.lifted"));
    const liftAck = (await mock.waitForFrame(isOrgHaltAck("lift"), 15_000)) as OrgHaltAck;
    expect(liftAck.haltKind).toBe("lift");
    expect(typeof liftAck.ackedAt).toBe("string");

    // The halt ack and the lift ack are distinct audited events (FR-003/FR-004),
    // not one echo replayed.
    expect(liftAck.ackedAt).not.toBe(haltAck.ackedAt);
  });

  it("disconnected engine stays refused at the reconnect handshake while halted", async () => {
    // FR-003 disconnected leg. A halted statecraft refuses the handshake fail-
    // closed (no sync.hello served). The OPC client has no local halt state, so
    // from its side this is indistinguishable from any handshake refusal: it
    // never flips org_session_ready (= has_org && sync_hello) and the boot gate
    // stays sticky (the spec-187 AC-7 mechanism, re-exercised as the 208
    // disconnected bound).
    session = await launchOpc({ mode: "handshake-rejects", orgId: ORG_ID, seedSession: true });
    const { driver } = session;

    // The seeded session satisfies the other cockpit precondition, so if the
    // handshake refusal were not fail-closed the cockpit could mount. Assert the
    // boot gate holds and never advances to cockpit within the window.
    await driver.waitForPhase("boot", { timeoutMs: 20_000 });
    await expect(
      driver.waitForPhase("cockpit", { timeoutMs: 3_000 }),
    ).rejects.toThrow();
  });
});
