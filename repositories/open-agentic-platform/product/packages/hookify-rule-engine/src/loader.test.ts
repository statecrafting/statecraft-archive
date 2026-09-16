import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluate } from "./engine.js";
import {
  createRuleRuntime,
  DEFAULT_RULES_DIR,
  discoverMarkdownRuleFiles,
  loadRules,
} from "./loader.js";
import type { HookEvent } from "./types.js";

const RULE_A = `---
id: rule-a
event: PreToolUse
matcher:
  tool: Bash
conditions:
  - field: input.command
    contains: "alpha"
action:
  type: warn
priority: 10
---
Rationale A.
`;

const RULE_B = `---
id: rule-b
event: PreToolUse
matcher:
  tool: Bash
conditions:
  - field: input.command
    contains: "beta"
action:
  type: warn
priority: 10
---
Rationale B.
`;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("loadRules", () => {
  it("loads from a configurable directory (default path constant)", () => {
    expect(DEFAULT_RULES_DIR).toBe(".claude/hooks/rules");
  });

  it("returns empty rules when directory is missing", () => {
    const dir = path.join(os.tmpdir(), `missing-${Date.now()}`);
    const snap = loadRules({ rulesDir: dir });
    expect(snap.rules).toHaveLength(0);
    expect(snap.diagnostics).toHaveLength(0);
  });

  it("discovers nested markdown files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hky-loader-"));
    const sub = path.join(root, "nested", "deep");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "r.md"), RULE_A);
    expect(discoverMarkdownRuleFiles(root)).toEqual([path.join(sub, "r.md")]);
    const snap = loadRules({ rulesDir: root });
    expect(snap.rules).toHaveLength(1);
    expect(snap.rules[0]?.id).toBe("rule-a");
  });
});

describe("createRuleRuntime + hot reload (FR-008, SC-004)", () => {
  let root: string;

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("SC-004: new rule file takes effect after reload without new runtime", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hky-sc004-"));
    fs.writeFileSync(path.join(root, "a.md"), RULE_A);
    const runtime = createRuleRuntime({ rulesDir: root });
    expect(runtime.getRulesSnapshot().rules.map((r) => r.id)).toEqual(["rule-a"]);

    fs.writeFileSync(path.join(root, "b.md"), RULE_B);
    const after = runtime.loadRules();
    expect(after.rules.map((r) => r.id).sort()).toEqual(["rule-a", "rule-b"]);

    const ev: HookEvent = {
      type: "PreToolUse",
      payload: { tool: "Bash", input: { command: "beta" } },
    };
    const r = evaluate({ rules: after.rules, event: ev });
    expect(r.warnings).toContain("Rationale B.");
  });

  it("hot-reload picks up added file after debounce", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hky-hot-"));
    fs.writeFileSync(path.join(root, "a.md"), RULE_A);
    const runtime = createRuleRuntime({ rulesDir: root });
    runtime.startHotReload();
    fs.writeFileSync(path.join(root, "b.md"), RULE_B);
    await wait(250);
    const snap = runtime.getRulesSnapshot();
    expect(snap.rules.map((r) => r.id).sort()).toEqual(["rule-a", "rule-b"]);
    runtime.stopHotReload();
  });

  it("change and delete update snapshot", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hky-chg-"));
    const p = path.join(root, "a.md");
    fs.writeFileSync(p, RULE_A);
    const runtime = createRuleRuntime({ rulesDir: root });
    const v1 = runtime.getRulesSnapshot().version;

    fs.writeFileSync(
      p,
      RULE_A.replace("alpha", "gamma").replace("rule-a", "rule-a2"),
    );
    const v2 = runtime.loadRules().version;
    expect(v2).toBeGreaterThan(v1);
    expect(runtime.getRulesSnapshot().rules[0]?.id).toBe("rule-a2");

    fs.unlinkSync(p);
    expect(runtime.loadRules().rules).toHaveLength(0);
  });

  it("in-flight evaluation keeps prior snapshot (atomic replacement)", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hky-race-"));
    fs.writeFileSync(path.join(root, "a.md"), RULE_A);
    const runtime = createRuleRuntime({ rulesDir: root });
    const captured = runtime.getRulesSnapshot();
    fs.writeFileSync(path.join(root, "b.md"), RULE_B);
    runtime.loadRules();

    const ev: HookEvent = {
      type: "PreToolUse",
      payload: { tool: "Bash", input: { command: "beta" } },
    };
    const r = evaluate({ rules: [...captured.rules], event: ev });
    expect(captured.rules).toHaveLength(1);
    expect(r.warnings).toEqual([]);
    expect(runtime.getRulesSnapshot().rules).toHaveLength(2);
  });

  it("invalid rule file yields diagnostic, valid rules still load (FR-009)", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hky-inv-"));
    fs.writeFileSync(path.join(root, "good.md"), RULE_A);
    fs.writeFileSync(path.join(root, "bad.md"), "not yaml frontmatter");
    const snap = loadRules({ rulesDir: root });
    expect(snap.rules).toHaveLength(1);
    expect(snap.diagnostics.some((d) => d.code === "HKY_MISSING_FRONTMATTER")).toBe(true);
  });
});
