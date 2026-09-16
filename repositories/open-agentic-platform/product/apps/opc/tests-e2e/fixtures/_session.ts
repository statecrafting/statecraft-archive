// Spec 187 — per-fixture OPC session helper (CI-only; imports webdriverio, so
// it lives under fixtures/ outside the local typecheck scope).
//
// Each fixture launches its own built OPC binary through tauri-driver, pointed
// at a mock-statecraft instance in the requested mode. STATECRAFT_BASE_URL is
// set on the tauri-driver process so the launched OPC inherits it (lib.rs URL
// resolution order: app_settings -> STATECRAFT_BASE_URL env -> default), which
// is what lets a fixture redirect the binary at the mock with no src-tauri
// change.

import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { remote } from "webdriverio";
import { MockStatecraft, type MockMode } from "../harness/mock_statecraft";
import { OpcDriver, opcBinaryPath, type WebDriverLike } from "../harness/driver";
import {
  clearSeededSession,
  seedSignedInSession,
  type SeedSessionOptions,
} from "../harness/seed_session";

export interface OpcSession {
  driver: OpcDriver;
  mock: MockStatecraft;
  browser: WebElementHost;
  teardown: () => Promise<void>;
}

// The subset of WebdriverIO's Browser the fixtures touch directly (element
// lookup for affordance clicks); OpcDriver consumes the rest via WebDriverLike.
interface WebElementHost extends WebDriverLike {
  $(selector: string): Promise<{ click(): Promise<void>; isExisting(): Promise<boolean>; getAttribute(n: string): Promise<string | null> }>;
}

export interface LaunchOptions {
  mode: MockMode;
  orgId?: string;
  extraEnv?: Record<string, string>;
  /**
   * Seed a signed-in session into the OS keychain BEFORE the binary launches, so
   * the cockpit mounts headlessly without the real OAuth flow (spec 187
   * [[opc-e2e-auth-state-seeding]]). `true` uses defaults; an object customizes
   * the JWT claims. The seed's org id is aligned with the mock's effective org
   * id for a coherent fixture. Cleared on teardown.
   */
  seedSession?: boolean | SeedSessionOptions;
}

export async function launchOpc(opts: LaunchOptions): Promise<OpcSession> {
  const mock = new MockStatecraft({ mode: opts.mode, orgId: opts.orgId });
  const { url } = await mock.start();
  const httpBase = url.replace(/^ws:\/\//, "http://").replace(/\/api\/sync\/duplex$/, "");

  // Seed BEFORE spawning the binary: OPC reads the keychain "session" entry at
  // boot (Rust setup() + React AuthContext), so the token must already be there.
  // Align the seed's org id with the mock's effective org id (the mock defaults
  // to "org_mock") so `custom.oap_org_id` and the sync.hello org match.
  let seeded = false;
  if (opts.seedSession) {
    const seedOpts: SeedSessionOptions =
      typeof opts.seedSession === "object" ? { ...opts.seedSession } : {};
    seedOpts.orgId = seedOpts.orgId ?? opts.orgId ?? "org_mock";
    seedSignedInSession(seedOpts);
    seeded = true;
  }

  // tauri-driver spawns the OPC binary, so the binary inherits tauri-driver's
  // env. A fresh tauri-driver per fixture keeps STATECRAFT_BASE_URL per-mode.
  const tauriDriver = spawn("tauri-driver", [], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, STATECRAFT_BASE_URL: httpBase, ...opts.extraEnv },
  });
  await waitForPort(4444, 10_000);

  const browser = (await remote({
    hostname: "127.0.0.1",
    port: 4444,
    path: "/",
    // Silence WebdriverIO's own capability-negotiation logging noise; the real
    // signal is the fixture assertions.
    logLevel: "error",
    capabilities: {
      browserName: "wry",
      "tauri:options": { application: opcBinaryPath() },
      // WebdriverIO v9 negotiates WebDriver BiDi by default and adds
      // `webSocketUrl: true` to the requested capabilities. tauri-driver proxies
      // to WebKitWebDriver on Linux, which has no BiDi support and rejects the
      // whole session with "session not created: Failed to match capabilities".
      // Force classic WebDriver so only capabilities the driver can satisfy are
      // sent. (spec 187 §3.5.2)
      "wdio:enforceWebDriverClassic": true,
    } as Record<string, unknown>,
  })) as unknown as WebElementHost;

  const driver = new OpcDriver(browser);

  return {
    driver,
    mock,
    browser,
    teardown: async () => {
      await browser.deleteSession().catch(() => undefined);
      tauriDriver.kill();
      await mock.stop();
      if (seeded) {
        // Best effort: the CI runner is ephemeral, but leaving a stale session
        // entry would leak a signed-in state into a later fixture on the same
        // runner (keychain is process-external).
        try {
          clearSeededSession();
        } catch {
          /* ignore: teardown must not mask the test's own failure */
        }
      }
    },
  };
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) reject(new Error(`tauri-driver port ${port} not up in ${timeoutMs}ms`));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}
