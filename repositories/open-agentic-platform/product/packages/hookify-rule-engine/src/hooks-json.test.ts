import { describe, expect, it } from "vitest";
import {
  HOOKIFY_LIFECYCLE_EVENTS,
  buildHooksManifest,
  stringifyHooksManifest,
} from "./hooks-json.js";
import type { HookEventType } from "./types.js";

describe("hooks.json manifest (SC-006)", () => {
  it("registers all six lifecycle events with hookify evaluate commands", () => {
    const manifest = buildHooksManifest();
    const events = Object.keys(manifest.hooks);
    expect(events).toEqual([
      "SessionStart",
      "PreToolUse",
      "PostToolUse",
      "UserPromptSubmit",
      "FileChanged",
      "SessionStop",
    ]);
    expect(HOOKIFY_LIFECYCLE_EVENTS.length).toBe(6);

    for (const event of HOOKIFY_LIFECYCLE_EVENTS) {
      const entries = manifest.hooks[event as HookEventType];
      expect(entries).toBeDefined();
      expect(entries?.length).toBe(1);
      expect(entries?.[0]?.command).toBe(`hookify-rule-engine evaluate --event ${event}`);
    }
  });

  it("stringify preserves stable ordering for diff-friendly output", () => {
    const s = stringifyHooksManifest(buildHooksManifest());
    expect(s).toContain('"PreToolUse"');
    expect(s).toContain('"SessionStop"');
    const parsed = JSON.parse(s) as { hooks: Record<string, unknown> };
    expect(Object.keys(parsed.hooks)).toEqual([
      "SessionStart",
      "PreToolUse",
      "PostToolUse",
      "UserPromptSubmit",
      "FileChanged",
      "SessionStop",
    ]);
  });
});
