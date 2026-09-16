import { describe, expect, it } from "vitest";
import {
  normalizeToolsField,
  parseFrontmatter,
  parseYamlMapping,
  splitFrontmatterDelimiters,
} from "./parser.js";

const path = "/test/agent.md";

describe("splitFrontmatterDelimiters", () => {
  it("splits LF delimiters", () => {
    const r = splitFrontmatterDelimiters("---\na: 1\n---\n# Body\n");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.yamlText).toBe("a: 1");
      expect(r.body).toBe("# Body\n");
      expect(r.yamlStartLine).toBe(2);
    }
  });

  it("strips BOM", () => {
    const r = splitFrontmatterDelimiters("\uFEFF---\nx: y\n---\nok");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.yamlText).toBe("x: y");
      expect(r.body).toBe("ok");
    }
  });

  it("rejects missing open", () => {
    const r = splitFrontmatterDelimiters("no frontmatter");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_open");
  });

  it("rejects missing close", () => {
    const r = splitFrontmatterDelimiters("---\na: 1\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_close");
  });

  it("handles CRLF delimiters", () => {
    const r = splitFrontmatterDelimiters("---\r\na: 1\r\n---\r\n# Body\r\n");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.yamlText).toBe("a: 1");
      expect(r.body).toBe("# Body\r\n");
      expect(r.yamlStartLine).toBe(2);
    }
  });
});

describe("parseFrontmatter", () => {
  it("parses valid frontmatter and preserves unknown keys (NF-003)", () => {
    const src = `---
name: demo
description: Hello
tools:
  - Read
model: sonnet
experimentalFlag: true
---

# Instructions
`;
    const { parsed, diagnostics } = parseFrontmatter(src, path);
    expect(diagnostics).toHaveLength(0);
    expect(parsed).not.toBeNull();
    expect(parsed!.metadata.name).toBe("demo");
    expect(parsed!.metadata.experimentalFlag).toBe(true);
    expect(parsed!.body.trim()).toBe("# Instructions");
  });

  it("normalizes comma-separated tools via normalizeToolsField (P1-002)", () => {
    const src = `---
name: architect
description: Plan things.
tools: Read, Grep, Glob, Bash, LS
model: sonnet
---

# Body
`;
    const { parsed } = parseFrontmatter(src, path);
    expect(parsed).not.toBeNull();
    expect(normalizeToolsField(parsed!.metadata.tools)).toEqual([
      "Read",
      "Grep",
      "Glob",
      "Bash",
      "LS",
    ]);
  });

  it("reports missing opening delimiter with path", () => {
    const { parsed, diagnostics } = parseFrontmatter("hello", path);
    expect(parsed).toBeNull();
    expect(diagnostics[0].filePath).toBe(path);
    expect(diagnostics[0].code).toBe("AFS_MISSING_FRONTMATTER");
    expect(diagnostics[0].line).toBe(1);
  });

  it("reports malformed YAML with line in file (NF-002)", () => {
    const src = `---
name: "unclosed string
---

body
`;
    const { parsed, diagnostics } = parseFrontmatter(src, path);
    expect(parsed).toBeNull();
    expect(diagnostics[0].code).toBe("AFS_YAML_PARSE_ERROR");
    expect(diagnostics[0].filePath).toBe(path);
    expect(diagnostics[0].line).toBeGreaterThanOrEqual(2);
    expect(diagnostics[0].column).toBeDefined();
  });

  it("rejects array root YAML", () => {
    const src = `---
- a
- b
---

x
`;
    const { parsed, diagnostics } = parseFrontmatter(src, path);
    expect(parsed).toBeNull();
    expect(diagnostics.some((d) => d.code === "AFS_YAML_NOT_OBJECT")).toBe(true);
  });
});

describe("parseYamlMapping", () => {
  it("returns line relative to file when yaml starts at line 2", () => {
    const bad = "a: 1\nx: [unclosed";
    const { value, diagnostics } = parseYamlMapping(bad, path, 2);
    expect(value).toBeNull();
    expect(diagnostics[0].line).toBeGreaterThanOrEqual(3);
  });
});

describe("normalizeToolsField", () => {
  it("handles array of strings", () => {
    expect(normalizeToolsField([" Read ", "Write"])).toEqual(["Read", "Write"]);
  });

  it("returns undefined for unsupported types", () => {
    expect(normalizeToolsField(42)).toBeUndefined();
  });
});
