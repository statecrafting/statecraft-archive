/**
 * Cross-platform PATH resolution for packaged Tauri apps.
 *
 * Ported from crystal's shellPath.ts + shellDetector.ts and adapted for
 * Tauri v2 (no Node `child_process`; uses `@tauri-apps/api/core` invoke
 * to delegate heavy shell work to the Rust backend).
 *
 * Exported API:
 *   getShellPATH()          - Resolve the full user PATH (cached after first call)
 *   findExecutable(name)    - Locate a binary by name within the resolved PATH
 *   clearCache()            - Invalidate the cached PATH so the next call re-resolves
 */

import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Platform helpers
// ---------------------------------------------------------------------------

type Platform = "macos" | "linux" | "windows" | "unknown";

function getPlatform(): Platform {
  // Vite injects `process.platform` at build time when targeting Tauri.
  // Fall back to navigator sniffing for safety.
  if (typeof process !== "undefined" && process.platform) {
    switch (process.platform) {
      case "darwin":
        return "macos";
      case "win32":
        return "windows";
      case "linux":
        return "linux";
    }
  }
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac os x") || ua.includes("macintosh")) return "macos";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

const PLATFORM = getPlatform();
const PATH_SEP = PLATFORM === "windows" ? ";" : ":";

// ---------------------------------------------------------------------------
// Rust backend contract
// ---------------------------------------------------------------------------

/**
 * The Rust side is expected to expose a `resolve_shell_path` command that
 * returns the user's full PATH string by spawning their login shell (or
 * reading PowerShell / cmd on Windows). This mirrors what crystal did via
 * `execSync` in the Electron main process.
 *
 * If the command is not wired up yet the module falls back to a purely
 * heuristic approach that combines well-known directories.
 */
interface RustShellPathResult {
  /** The resolved PATH string (entries separated by the platform separator). */
  path: string;
  /** Which strategy the Rust side used ("login_shell" | "config_parse" | "fallback"). */
  source: string;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cachedPATH: string | null = null;
let resolveInFlight: Promise<string> | null = null;

// ---------------------------------------------------------------------------
// Well-known path directories (heuristic fallback)
// ---------------------------------------------------------------------------

function homeDir(): string {
  if (typeof process !== "undefined" && process.env?.HOME) return process.env.HOME;
  if (typeof process !== "undefined" && process.env?.USERPROFILE) return process.env.USERPROFILE;
  // Last resort for webview context — won't work everywhere but covers most Tauri cases.
  return PLATFORM === "windows" ? "C:\\Users\\Default" : "/Users/unknown";
}

function wellKnownUnixPaths(home: string): string[] {
  return [
    // System essentials
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",

    // Homebrew (macOS)
    ...(PLATFORM === "macos"
      ? ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"]
      : []),

    // Linux extras
    ...(PLATFORM === "linux" ? ["/snap/bin", `${home}/.local/bin`, `${home}/bin`] : []),

    // npm / yarn / pnpm global bins
    `${home}/.npm-global/bin`,
    `${home}/.yarn/bin`,
    `${home}/.config/yarn/global/node_modules/.bin`,
    `${home}/.pnpm-global/bin`,

    // nvm — include the "current" symlink plus a glob-style fallback pattern
    // (actual version dirs are discovered asynchronously via Rust)
    `${home}/.nvm/current/bin`,

    // Misc
    `${home}/.cargo/bin`,
    `${home}/.local/bin`,
    "/usr/local/go/bin",
    `${home}/go/bin`,
    `${home}/.deno/bin`,
    `${home}/.bun/bin`,
  ];
}

function wellKnownWindowsPaths(home: string): string[] {
  const pf = "C:\\Program Files";
  const pf86 = "C:\\Program Files (x86)";
  return [
    `${home}\\AppData\\Roaming\\npm`,
    `${home}\\AppData\\Local\\Yarn\\bin`,
    `${home}\\AppData\\Local\\pnpm`,
    `${pf}\\Git\\bin`,
    `${pf}\\Git\\cmd`,
    `${pf86}\\Git\\bin`,
    `${pf86}\\Git\\cmd`,
    `${pf}\\nodejs`,
    "C:\\Windows\\system32",
    "C:\\Windows",
    "C:\\Windows\\System32\\Wbem",
  ];
}

// ---------------------------------------------------------------------------
// Core resolution
// ---------------------------------------------------------------------------

/**
 * Attempt to resolve the full user PATH via the Rust backend.
 * Falls back to heuristic paths if the invoke command is unavailable.
 */
async function resolveFromRust(): Promise<string | null> {
  try {
    const result = await invoke<RustShellPathResult>("resolve_shell_path");
    if (result?.path) {
      console.log(`[shellPath] Rust resolved PATH via "${result.source}" (${result.path.split(PATH_SEP).length} entries)`);
      return result.path;
    }
  } catch (err) {
    // Command not wired up yet — expected during early integration.
    console.warn("[shellPath] resolve_shell_path invoke failed, using heuristic fallback:", err);
  }
  return null;
}

/**
 * Build a heuristic PATH from well-known directories. This covers the
 * common case where the Rust command is not yet available or when the
 * login-shell approach times out.
 */
function buildHeuristicPATH(): string {
  const home = homeDir();
  const dirs =
    PLATFORM === "windows" ? wellKnownWindowsPaths(home) : wellKnownUnixPaths(home);

  // Try to salvage whatever the webview inherited (often minimal for packaged apps).
  const inherited =
    typeof process !== "undefined" && process.env?.PATH
      ? process.env.PATH.split(PATH_SEP)
      : [];

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const d of [...inherited, ...dirs]) {
    const normalised = d.replace(/\/+$/, ""); // strip trailing slashes
    if (normalised && !seen.has(normalised)) {
      seen.add(normalised);
      merged.push(normalised);
    }
  }
  return merged.join(PATH_SEP);
}

/**
 * Attempt to discover nvm node version directories via the Rust backend.
 * Returns additional PATH entries for every nvm-installed node version.
 */
async function discoverNvmPaths(): Promise<string[]> {
  try {
    const paths = await invoke<string[]>("discover_nvm_bin_paths");
    if (paths && paths.length > 0) {
      console.log(`[shellPath] Found ${paths.length} nvm bin directories`);
      return paths;
    }
  } catch {
    // Not wired up or nvm not installed — safe to ignore.
  }
  return [];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the user's shell PATH, resolved for a packaged Tauri app.
 *
 * The first call triggers async resolution (Rust login-shell probe, then
 * heuristic fallback). Subsequent calls return the cached value.
 *
 * @returns The full PATH string (entries separated by `;` on Windows, `:` elsewhere).
 */
export async function getShellPATH(): Promise<string> {
  if (cachedPATH) return cachedPATH;

  // Coalesce concurrent callers behind a single in-flight promise.
  if (resolveInFlight) return resolveInFlight;

  resolveInFlight = (async () => {
    try {
      // 1. Prefer the Rust backend (spawns login shell, reads real PATH).
      const rustPATH = await resolveFromRust();

      // 2. Start with whatever we got from Rust, or build heuristic fallback.
      const basePATH = rustPATH ?? buildHeuristicPATH();
      const entries = new Set(basePATH.split(PATH_SEP).filter(Boolean));

      // 3. Merge heuristic paths that Rust may not have covered.
      if (rustPATH) {
        const home = homeDir();
        const extras =
          PLATFORM === "windows"
            ? wellKnownWindowsPaths(home)
            : wellKnownUnixPaths(home);
        for (const p of extras) {
          entries.add(p.replace(/\/+$/, ""));
        }
      }

      // 4. Discover nvm version directories (async, best-effort).
      const nvmPaths = await discoverNvmPaths();
      for (const p of nvmPaths) {
        entries.add(p);
      }

      cachedPATH = Array.from(entries).filter(Boolean).join(PATH_SEP);
      console.log(
        `[shellPath] Final PATH has ${cachedPATH.split(PATH_SEP).length} entries ` +
          `(source: ${rustPATH ? "rust+heuristic" : "heuristic-only"})`
      );
      return cachedPATH;
    } finally {
      resolveInFlight = null;
    }
  })();

  return resolveInFlight;
}

/**
 * Find an executable by name within the resolved PATH.
 *
 * Delegates to the Rust backend (`find_executable_in_path`) which can
 * perform real filesystem `access(X_OK)` checks. Falls back to a naive
 * path-join check via the Tauri `fs:exists` capability when the Rust
 * command is unavailable.
 *
 * On Windows the function automatically probes `.exe`, `.cmd`, and `.bat`
 * suffixed variants.
 *
 * @param name - The bare executable name (e.g. `"node"`, `"git"`).
 * @returns The full path to the executable, or `null` if not found.
 */
export async function findExecutable(name: string): Promise<string | null> {
  // --- Fast path: ask Rust to do a proper which/where ---
  try {
    const result = await invoke<string | null>("find_executable_in_path", {
      name,
      pathOverride: await getShellPATH(),
    });
    if (result) {
      console.log(`[shellPath] findExecutable("${name}") -> ${result} (via Rust)`);
      return result;
    }
  } catch {
    // Rust command not available — fall through to client-side heuristic.
  }

  // --- Slow path: iterate PATH directories and probe via invoke ---
  const shellPATH = await getShellPATH();
  const dirs = shellPATH.split(PATH_SEP).filter(Boolean);
  const suffixes =
    PLATFORM === "windows" ? ["", ".exe", ".cmd", ".bat"] : [""];

  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const sep = PLATFORM === "windows" ? "\\" : "/";
      const candidate = `${dir}${sep}${name}${suffix}`;
      try {
        const exists = await invoke<boolean>("path_exists", { path: candidate });
        if (exists) {
          console.log(`[shellPath] findExecutable("${name}") -> ${candidate} (heuristic)`);
          return candidate;
        }
      } catch {
        // path_exists not wired up — can't verify. Skip.
      }
    }
  }

  console.warn(`[shellPath] findExecutable("${name}") -> not found`);
  return null;
}

/**
 * Clear the cached PATH so the next `getShellPATH()` call re-resolves.
 *
 * Useful after the user installs new tooling (e.g. nvm version switch)
 * or changes their shell configuration.
 */
export function clearCache(): void {
  cachedPATH = null;
  resolveInFlight = null;
  console.log("[shellPath] Cache cleared — next access will re-resolve");
}
