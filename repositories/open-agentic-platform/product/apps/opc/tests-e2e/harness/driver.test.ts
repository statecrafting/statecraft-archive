import { describe, it, expect } from "vitest";
import {
  OpcDriver,
  opcBinaryPath,
  PHASE_TESTID,
  PHASE_ATTR,
  type WebDriverLike,
} from "./driver";

// Spec 187 FR-T1 + 187 AC-5. The WebView read is exercised here against a fake
// browser; the live-binary read runs in the Linux nightly (tauri-driver has no
// macOS WebView backend).

function fakeBrowser(state: {
  exists: boolean;
  phase: string | null;
  deleted?: boolean;
}): WebDriverLike {
  return {
    async $(selector: string) {
      expect(selector).toContain(PHASE_TESTID);
      return {
        async isExisting() {
          return state.exists;
        },
        async getAttribute(name: string) {
          expect(name).toBe(PHASE_ATTR);
          return state.phase;
        },
      };
    },
    async deleteSession() {
      state.deleted = true;
    },
  };
}

describe("FR-T1 built-binary driver", () => {
  it("AC-5: reports the mounted top-level component from the phase affordance", async () => {
    const driver = new OpcDriver(fakeBrowser({ exists: true, phase: "cockpit" }));
    expect(await driver.mountedComponent()).toBe("cockpit");
  });

  it("reports 'boot' when the BootGate subtree is mounted", async () => {
    const driver = new OpcDriver(fakeBrowser({ exists: true, phase: "boot" }));
    expect(await driver.mountedComponent()).toBe("boot");
  });

  it("reports 'unknown' when the affordance is absent", async () => {
    const driver = new OpcDriver(fakeBrowser({ exists: false, phase: null }));
    expect(await driver.mountedComponent()).toBe("unknown");
  });

  it("waitForPhase resolves once the phase flips to the expected value", async () => {
    const state = { exists: true, phase: "boot" as string | null };
    const driver = new OpcDriver(fakeBrowser(state));
    setTimeout(() => (state.phase = "cockpit"), 20);
    await expect(
      driver.waitForPhase("cockpit", { intervalMs: 5, timeoutMs: 1000 }),
    ).resolves.toBeUndefined();
  });

  it("quit tears down the WebDriver session", async () => {
    const state = { exists: true, phase: "cockpit" as string | null, deleted: false };
    const driver = new OpcDriver(fakeBrowser(state));
    await driver.quit();
    expect(state.deleted).toBe(true);
  });

  it("resolves the per-platform built-binary path", () => {
    expect(opcBinaryPath({ root: "/x", platform: "linux" })).toBe(
      "/x/src-tauri/target/release/opc",
    );
    expect(opcBinaryPath({ root: "/x", platform: "win32" })).toBe(
      "/x/src-tauri/target/release/opc.exe",
    );
  });
});
