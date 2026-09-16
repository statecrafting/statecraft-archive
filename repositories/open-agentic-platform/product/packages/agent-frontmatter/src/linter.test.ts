import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatLintSummary, lintDefinitionsInDir } from "./linter.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-frontmatter-lint-"));
}

function writeFile(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

describe("lintDefinitionsInDir", () => {
  it("passes a valid agent definition", () => {
    const dir = createTempDir();
    const agentPath = path.join(dir, "agents", "code-review-agent.md");
    writeFile(
      agentPath,
      `---
name: code-review-agent
description: Activate when users request deep code review and risk analysis output.
tools:
  - Read
model: claude-sonnet
---
# Instructions
`,
    );

    const summary = lintDefinitionsInDir(dir);
    expect(summary.ok).toBe(true);
    expect(summary.errorCount).toBe(0);
    expect(summary.filesChecked).toBe(1);
  });

  it("fails short description, non-kebab name, and empty tools for agent", () => {
    const dir = createTempDir();
    const agentPath = path.join(dir, "agents", "bad-agent.md");
    writeFile(
      agentPath,
      `---
name: Bad_Agent
description: Too short.
tools: []
model: claude-sonnet
---
body
`,
    );

    const summary = lintDefinitionsInDir(dir);
    expect(summary.ok).toBe(false);
    const issues = summary.files[0].issues.map((x) => x.code);
    expect(issues).toContain("AFS_LINT_NAME_KEBAB_CASE");
    expect(issues).toContain("AFS_LINT_DESCRIPTION_TOO_SHORT");
    expect(issues).toContain("AFS_LINT_TOOLS_EMPTY");
  });

  it("supports skill mode and enforces common quality checks", () => {
    const dir = createTempDir();
    const skillPath = path.join(dir, "skills", "lint-fix.md");
    writeFile(
      skillPath,
      `---
name: lint-fix
description: Run linting across the repository and apply all safe autofix actions.
---
skill body
`,
    );

    const summary = lintDefinitionsInDir(dir, { kind: "skill" });
    expect(summary.ok).toBe(true);
    expect(summary.errorCount).toBe(0);
  });

  it("formats failing output with issue codes", () => {
    const dir = createTempDir();
    const filePath = path.join(dir, "agents", "invalid.md");
    writeFile(filePath, "no frontmatter");

    const summary = lintDefinitionsInDir(dir);
    const rendered = formatLintSummary(summary);
    expect(rendered).toContain("agent-frontmatter lint failed");
    expect(rendered).toContain("AFS_MISSING_FRONTMATTER");
  });
});
