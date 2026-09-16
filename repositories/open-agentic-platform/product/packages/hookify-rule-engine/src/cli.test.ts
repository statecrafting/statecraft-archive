import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cliMain } from "./cli.js";

describe("hookify-rule-engine CLI", () => {
  it("generate-manifest writes canonical hooks.json (command shape)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hky-cli-"));
    const out = join(dir, "hooks.json");
    const code = await cliMain(["generate-manifest", "--output", out]);
    expect(code).toBe(0);
    const json = JSON.parse(readFileSync(out, "utf8")) as {
      hooks: Record<string, { command: string }[]>;
    };
    expect(json.hooks.PreToolUse[0].command).toBe(
      "hookify-rule-engine evaluate --event PreToolUse",
    );
    expect(Object.keys(json.hooks)).toEqual([
      "SessionStart",
      "PreToolUse",
      "PostToolUse",
      "UserPromptSubmit",
      "FileChanged",
      "SessionStop",
    ]);
    rmSync(dir, { recursive: true });
  });

  it("generate-manifest --check succeeds when file matches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hky-cli-"));
    const out = join(dir, "hooks.json");
    await cliMain(["generate-manifest", "--output", out]);
    const code = await cliMain(["generate-manifest", "--output", out, "--check"]);
    expect(code).toBe(0);
    rmSync(dir, { recursive: true });
  });
});
