// Spec 187 FR-T1 — built-binary driver.
//
// Drives a *built* OPC Tauri binary (never a mocked Tauri context). The
// WebDriver session is injected as a minimal structural interface
// (`WebDriverLike`) rather than a hard `webdriverio` import: that keeps the
// mounted-component logic unit-testable without a live WebView and pins
// exactly the WebDriver surface the harness depends on. The concrete session
// is WebdriverIO's `browser` global, created in wdio.conf.ts against
// tauri-driver — which has a Linux/Windows WebView backend only, so the
// WebView read runs in the nightly (FR-T5), not on macOS.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { waitForSubtree, type WaitOptions } from "./wait";

/** data-testid + attribute the OPC React shell exposes on its phase wrapper. */
export const PHASE_TESTID = "opc-phase";
export const PHASE_ATTR = "data-phase";

export type OpcPhase = "boot" | "cockpit" | "unknown";

/**
 * Minimal structural view of the WebDriver session the driver needs. The
 * concrete impl is WebdriverIO's `browser` (wired in wdio.conf.ts). Keeping it
 * an interface lets the driver logic be unit-tested with a fake browser.
 */
export interface WebDriverLike {
  $(selector: string): Promise<WebElementLike>;
  deleteSession(): Promise<void>;
}
export interface WebElementLike {
  isExisting(): Promise<boolean>;
  getAttribute(name: string): Promise<string | null>;
}

export class OpcDriver {
  constructor(
    private readonly browser: WebDriverLike,
    /** PID of the launched OPC process, when the launcher captured it (AC-9). */
    readonly pid?: number,
  ) {}

  /** Name of the currently-mounted top-level component (FR-T1c / AC-5). */
  async mountedComponent(): Promise<OpcPhase> {
    const el = await this.browser.$(`[data-testid="${PHASE_TESTID}"]`);
    if (!(await el.isExisting())) return "unknown";
    const phase = await el.getAttribute(PHASE_ATTR);
    return phase === "boot" || phase === "cockpit" ? phase : "unknown";
  }

  /** Resolve once `expected` mounts; reject on timeout (delegates to FR-T4). */
  waitForPhase(expected: OpcPhase, opts?: WaitOptions): Promise<void> {
    return waitForSubtree(() => this.mountedComponent(), expected, opts);
  }

  /** Tear down the WebDriver session. Orphan cleanup is process_tree's job. */
  async quit(): Promise<void> {
    await this.browser.deleteSession();
  }
}

/** Repo path of the OPC app (parent of tests-e2e/), resolved from this module. */
function opcAppRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Per-target built OPC binary path (cargo tauri build output). FR-T1a/b. */
export function opcBinaryPath(opts?: { root?: string; platform?: NodeJS.Platform }): string {
  const root = opts?.root ?? opcAppRoot();
  const platform = opts?.platform ?? process.platform;
  const name = platform === "win32" ? "opc.exe" : "opc";
  return join(root, "src-tauri", "target", "release", name);
}

/** True if the built OPC binary exists at the resolved path. */
export function opcBinaryExists(opts?: { root?: string; platform?: NodeJS.Platform }): boolean {
  return existsSync(opcBinaryPath(opts));
}
