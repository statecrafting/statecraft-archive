import fs from "node:fs";
import path from "node:path";
import type { HookEventType } from "./types.js";

/** All lifecycle events registered in the generated manifest (FR-001, SC-006). */
export const HOOKIFY_LIFECYCLE_EVENTS: readonly HookEventType[] = [
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "FileChanged",
  "SessionStop",
] as const;

export interface HooksManifest {
  hooks: Record<string, { command: string }[]>;
}

export interface BuildHooksManifestOptions {
  /**
   * Prefix before the event name. Default: `hookify-rule-engine evaluate --event`
   * (each event name is appended with a single space).
   */
  commandPrefix?: string;
}

/**
 * Default shell command for a hook event (spec § hooks.json integration).
 */
export function defaultHookCommandForEvent(
  event: HookEventType,
  commandPrefix = "hookify-rule-engine evaluate --event",
): string {
  return `${commandPrefix} ${event}`;
}

export function buildHooksManifest(options: BuildHooksManifestOptions = {}): HooksManifest {
  const prefix = options.commandPrefix ?? "hookify-rule-engine evaluate --event";
  const hooks: HooksManifest["hooks"] = {};
  for (const event of HOOKIFY_LIFECYCLE_EVENTS) {
    hooks[event] = [{ command: defaultHookCommandForEvent(event, prefix) }];
  }
  return { hooks };
}

export function stringifyHooksManifest(manifest: HooksManifest): string {
  const orderedHooks: Record<string, { command: string }[]> = {};
  for (const event of HOOKIFY_LIFECYCLE_EVENTS) {
    orderedHooks[event] = manifest.hooks[event] ?? [{ command: defaultHookCommandForEvent(event) }];
  }
  return `${JSON.stringify({ hooks: orderedHooks }, null, 2)}\n`;
}

export interface WriteHooksManifestOptions extends BuildHooksManifestOptions {
  /** Output file path (default: `hooks.json` in cwd). */
  outputPath?: string;
  /** If true, compare to existing file and throw if content differs (CI drift check). */
  check?: boolean;
}

export function writeHooksManifest(options: WriteHooksManifestOptions = {}): void {
  const manifest = buildHooksManifest(options);
  const body = stringifyHooksManifest(manifest);
  const outputPath = path.resolve(options.outputPath ?? "hooks.json");
  if (options.check) {
    if (!fs.existsSync(outputPath)) {
      throw new Error(`hooks manifest check failed: missing ${outputPath}`);
    }
    const existing = fs.readFileSync(outputPath, "utf8");
    if (existing !== body) {
      throw new Error(
        `hooks manifest check failed: ${outputPath} differs from generated. Regenerate without --check.`,
      );
    }
    return;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, body, "utf8");
}
