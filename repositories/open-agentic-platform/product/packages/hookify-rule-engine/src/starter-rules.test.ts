import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate } from "./engine.js";
import { loadRules } from "./loader.js";

const packageRulesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "rules");

describe("built-in starter rules", () => {
  it("blocks force-push Bash commands (SC-001 shape)", () => {
    const snapshot = loadRules({ rulesDir: packageRulesDir });
    const result = evaluate({
      rules: [...snapshot.rules],
      event: {
        type: "PreToolUse",
        payload: {
          tool: "Bash",
          input: { command: "git push --force origin main" },
        },
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedByRuleId).toBe("block-force-push");
    expect(result.blockRationale).toContain("Force-pushing");
  });

  it("blocks reads of likely credential paths", () => {
    const snapshot = loadRules({ rulesDir: packageRulesDir });
    const result = evaluate({
      rules: [...snapshot.rules],
      event: {
        type: "PreToolUse",
        payload: {
          tool: "Read",
          input: { file_path: "/project/.env.local" },
        },
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedByRuleId).toBe("block-credential-read");
  });

  it("warns on very large Write payloads", () => {
    const snapshot = loadRules({ rulesDir: packageRulesDir });
    const large = "y".repeat(9000);
    const result = evaluate({
      rules: [...snapshot.rules],
      event: {
        type: "PreToolUse",
        payload: {
          tool: "Write",
          input: { content: large },
        },
      },
    });
    expect(result.allowed).toBe(true);
    expect(result.warnings.some((w) => w.includes("large"))).toBe(true);
    expect(result.matchedRuleIds).toContain("warn-large-write");
  });
});
