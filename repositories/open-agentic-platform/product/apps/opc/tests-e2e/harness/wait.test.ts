import { describe, it, expect } from "vitest";
import { waitFor, waitForSubtree, DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS } from "./wait";

// Spec 187 FR-T4. The poller is decoupled from the WebView read: tests drive a
// fake `poll` source; Phase 4's driver supplies the real WebDriver read.

describe("FR-T4 time-bounded wait", () => {
  it("exposes harness-config defaults (not spec-bound)", () => {
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_INTERVAL_MS).toBeGreaterThan(0);
  });

  it("resolves immediately when the predicate already holds (one poll)", async () => {
    let calls = 0;
    const value = await waitFor(
      () => {
        calls++;
        return "cockpit";
      },
      (v) => v === "cockpit",
    );
    expect(value).toBe("cockpit");
    expect(calls).toBe(1);
  });

  it("polls on a bounded cadence until the predicate holds", async () => {
    let calls = 0;
    const value = await waitFor(
      () => {
        calls++;
        return calls >= 4 ? "cockpit" : "boot";
      },
      (v) => v === "cockpit",
      { intervalMs: 5, timeoutMs: 2000 },
    );
    expect(value).toBe("cockpit");
    expect(calls).toBeGreaterThanOrEqual(4);
  });

  it("rejects with a timeout that names the last-seen value", async () => {
    await expect(
      waitFor(() => "boot", (v) => v === "cockpit", {
        intervalMs: 20,
        timeoutMs: 150,
        description: 'wait for "cockpit" to mount',
      }),
    ).rejects.toThrow(/timed out.*boot/is);
  });

  it("waitForSubtree resolves when the mounted component matches", async () => {
    let mounted = "boot";
    setTimeout(() => (mounted = "cockpit"), 30);
    await expect(
      waitForSubtree(() => mounted, "cockpit", { intervalMs: 10, timeoutMs: 1000 }),
    ).resolves.toBeUndefined();
  });

  it("waitForSubtree timeout error names both expected and last-seen", async () => {
    await expect(
      waitForSubtree(() => "boot", "cockpit", { intervalMs: 20, timeoutMs: 120 }),
    ).rejects.toThrow(/cockpit[\s\S]*boot|boot[\s\S]*cockpit/i);
  });
});
