#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { evaluate } from "./engine.js";
import { loadRules } from "./loader.js";
import type { HookEventType } from "./types.js";
import { writeHooksManifest } from "./hooks-json.js";

const EVENTS = new Set<HookEventType>([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionStart",
  "SessionStop",
  "FileChanged",
]);

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export async function cliMain(argv: string[]): Promise<number> {
  const sub = argv[0];
  if (sub === "generate-manifest") {
    const outIdx = argv.indexOf("--output");
    const outputPath = outIdx >= 0 ? argv[outIdx + 1] : undefined;
    const check = argv.includes("--check");
    const prefixIdx = argv.indexOf("--command-prefix");
    const commandPrefix = prefixIdx >= 0 ? argv[prefixIdx + 1] : undefined;
    writeHooksManifest({
      outputPath,
      check,
      ...(commandPrefix !== undefined ? { commandPrefix } : {}),
    });
    return 0;
  }

  if (sub !== "evaluate") {
    console.error(
      "Usage:\n  hookify-rule-engine evaluate --event <HookEventType> [--rules-dir <path>]\n  hookify-rule-engine generate-manifest [--output <path>] [--check] [--command-prefix <prefix>]",
    );
    return 2;
  }

  const eventIdx = argv.indexOf("--event");
  if (eventIdx === -1 || !argv[eventIdx + 1]) {
    console.error("Missing --event <HookEventType>");
    return 2;
  }
  const eventType = argv[eventIdx + 1] as HookEventType;
  if (!EVENTS.has(eventType)) {
    console.error(`Invalid event: ${eventType}`);
    return 2;
  }

  let rulesDir: string | undefined;
  const rulesIdx = argv.indexOf("--rules-dir");
  if (rulesIdx !== -1 && argv[rulesIdx + 1]) {
    rulesDir = argv[rulesIdx + 1];
  }

  const stdinText = readStdinSync();
  let payload: Record<string, unknown> = {};
  if (stdinText.trim()) {
    try {
      const parsed = JSON.parse(stdinText) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      console.error("Invalid JSON on stdin");
      return 2;
    }
  }

  const snapshot = loadRules({ rulesDir });
  const result = evaluate({
    rules: [...snapshot.rules],
    event: { type: eventType, payload },
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  void cliMain(process.argv.slice(2)).then((c) => process.exit(c));
}
