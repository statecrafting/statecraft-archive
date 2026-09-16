import { describe, it, expect } from "vitest";
import { parseStandardFile } from "./parser.js";

const VALID_YAML = `
id: error-handling-001
category: error-handling
priority: high
status: active
context: Applies to async TypeScript code.
tags:
  - typescript
  - async
rules:
  - verb: ALWAYS
    subject: wrap async in try/catch
    rationale: Prevents unhandled rejections.
  - verb: NEVER
    subject: use empty catch blocks
    rationale: Swallowing errors silently makes debugging impossible.
  - verb: USE
    subject: typed error classes
    rationale: Enables structured error handling.
  - verb: PREFER
    subject: typed error classes over generic Error
    rationale: Typed errors enable callers to handle specific failure modes.
  - verb: AVOID
    subject: string-based error matching
    rationale: Fragile and breaks on message changes.
anti_patterns:
  - pattern: "catch (e) {}"
    correction: "catch (e) { logger.error(e); }"
examples:
  - good: "try { await f(); } catch (e) { handle(e); }"
    bad: "await f();"
    explanation: Explicit error handling prevents unhandled rejections.
`;

describe("parseStandardFile", () => {
  it("parses a valid standard YAML", () => {
    const result = parseStandardFile(VALID_YAML, "test.yaml");
    expect(result.diagnostics).toHaveLength(0);
    expect(result.standard).not.toBeNull();
    expect(result.standard!.id).toBe("error-handling-001");
    expect(result.standard!.category).toBe("error-handling");
    expect(result.standard!.priority).toBe("high");
    expect(result.standard!.status).toBe("active");
    expect(result.standard!.rules).toHaveLength(5);
    expect(result.standard!.anti_patterns).toHaveLength(1);
    expect(result.standard!.examples).toHaveLength(1);
  });

  it("supports all five rule verbs (SC-005)", () => {
    const result = parseStandardFile(VALID_YAML, "test.yaml");
    const verbs = result.standard!.rules.map((r) => r.verb);
    expect(verbs).toEqual(["ALWAYS", "NEVER", "USE", "PREFER", "AVOID"]);
  });

  it("defaults status to active when omitted", () => {
    const yaml = `
id: naming-001
category: naming
priority: medium
rules:
  - verb: ALWAYS
    subject: use camelCase
    rationale: Convention.
`;
    const result = parseStandardFile(yaml, "test.yaml");
    expect(result.diagnostics).toHaveLength(0);
    expect(result.standard!.status).toBe("active");
  });

  it("returns diagnostics for invalid YAML syntax", () => {
    const result = parseStandardFile(":\n  bad: [yaml", "bad.yaml");
    expect(result.standard).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].code).toBe("CS_YAML_PARSE_ERROR");
    expect(result.diagnostics[0].filePath).toBe("bad.yaml");
  });

  it("returns diagnostics for YAML that is not an object", () => {
    const result = parseStandardFile("- item1\n- item2", "array.yaml");
    expect(result.standard).toBeNull();
    expect(result.diagnostics[0].code).toBe("CS_YAML_NOT_OBJECT");
  });

  it("returns diagnostics for null YAML", () => {
    const result = parseStandardFile("", "empty.yaml");
    expect(result.standard).toBeNull();
    expect(result.diagnostics[0].code).toBe("CS_YAML_NOT_OBJECT");
  });

  it("returns diagnostics for missing required fields", () => {
    const yaml = `
category: testing
priority: low
`;
    const result = parseStandardFile(yaml, "incomplete.yaml");
    expect(result.standard).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "CS_MISSING_ID")).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "CS_MISSING_RULES")).toBe(true);
  });

  it("includes file path and line number in YAML parse errors (NF-002)", () => {
    const result = parseStandardFile("bad:\n  - [unclosed", "path/to/file.yaml");
    expect(result.diagnostics[0].filePath).toBe("path/to/file.yaml");
    // Line number is available from yaml parseDocument
    expect(result.diagnostics[0].line).toBeDefined();
  });

  it("preserves unknown fields for forward compatibility (NF-003)", () => {
    const yaml = `
id: naming-001
category: naming
priority: medium
custom_field: custom_value
metadata:
  version: 2
rules:
  - verb: ALWAYS
    subject: use camelCase
    rationale: Convention.
`;
    const result = parseStandardFile(yaml, "test.yaml");
    expect(result.diagnostics).toHaveLength(0);
    const standard = result.standard as Record<string, unknown>;
    expect(standard.custom_field).toBe("custom_value");
    expect(standard.metadata).toEqual({ version: 2 });
  });

  it("parses the full spec example", () => {
    const yaml = `
id: error-handling-001
category: error-handling
priority: high
context: >
  Applies to all TypeScript and JavaScript source files that perform
  async operations or interact with external services.
tags:
  - typescript
  - javascript
  - async
  - error-handling
rules:
  - verb: ALWAYS
    subject: "wrap async operations in try/catch blocks"
    rationale: >
      Unhandled promise rejections crash the process in Node.js and produce
      opaque errors in browsers.
  - verb: NEVER
    subject: "use empty catch blocks"
    rationale: >
      Swallowing errors silently makes debugging impossible.
  - verb: PREFER
    subject: "typed error classes over generic Error"
    rationale: >
      Typed errors enable callers to handle specific failure modes.
anti_patterns:
  - pattern: "catch (e) {}"
    correction: "catch (e) { logger.error('Operation failed', { error: e }); }"
  - pattern: "catch (e) { return null; }"
    correction: "catch (e) { throw new SpecificError('Context', { cause: e }); }"
examples:
  - bad: |
      async function fetchUser(id) {
        const res = await fetch(\`/api/users/\${id}\`);
        return res.json();
      }
    good: |
      async function fetchUser(id: string): Promise<User> {
        try {
          const res = await fetch(\`/api/users/\${id}\`);
          if (!res.ok) throw new ApiError(\`Fetch user failed: \${res.status}\`);
          return await res.json();
        } catch (error) {
          throw new UserFetchError(id, { cause: error });
        }
      }
    explanation: >
      The good example wraps the fetch in try/catch, checks response status,
      and throws a typed error with context.
`;
    const result = parseStandardFile(yaml, "standards/official/error-handling-001.yaml");
    expect(result.diagnostics).toHaveLength(0);
    expect(result.standard).not.toBeNull();
    expect(result.standard!.id).toBe("error-handling-001");
    expect(result.standard!.tags).toEqual(["typescript", "javascript", "async", "error-handling"]);
    expect(result.standard!.rules).toHaveLength(3);
    expect(result.standard!.anti_patterns).toHaveLength(2);
    expect(result.standard!.examples).toHaveLength(1);
  });

  it("parses candidate status correctly", () => {
    const yaml = `
id: candidate-001
category: testing
priority: low
status: candidate
rules:
  - verb: PREFER
    subject: integration tests
    rationale: Catches real bugs.
`;
    const result = parseStandardFile(yaml, "test.yaml");
    expect(result.diagnostics).toHaveLength(0);
    expect(result.standard!.status).toBe("candidate");
  });
});
