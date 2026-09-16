import { parseDocument } from "yaml";
import type { YAMLError } from "yaml";
import type { FrontmatterDiagnostic, ParseFrontmatterResult, ParsedFrontmatter } from "./types.js";

const CODE_MISSING = "AFS_MISSING_FRONTMATTER";
const CODE_MALFORMED = "AFS_MALFORMED_DELIMITERS";
const CODE_YAML_NOT_OBJECT = "AFS_YAML_NOT_OBJECT";
const CODE_YAML_PARSE = "AFS_YAML_PARSE_ERROR";

function diag(
  code: string,
  message: string,
  filePath: string,
  line?: number,
  column?: number,
): FrontmatterDiagnostic {
  return { code, severity: "error", message, filePath, line, column };
}

/**
 * Split markdown into YAML frontmatter and body using the same boundary rules as
 * `tools/shared/frontmatter` (Rust): first `---`, newline, content until first `\n---\n` or `\r\n---\r\n`.
 */
export function splitFrontmatterDelimiters(raw: string):
  | { ok: true; yamlText: string; body: string; yamlStartLine: number }
  | { ok: false; reason: "missing_open" | "missing_newline_after_open" | "missing_close" } {
  const text = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  if (!text.startsWith("---")) {
    return { ok: false, reason: "missing_open" };
  }
  const afterOpen = text.slice(3);
  let rest: string;
  if (afterOpen.startsWith("\r\n")) {
    rest = afterOpen.slice(2);
  } else if (afterOpen.startsWith("\n")) {
    rest = afterOpen.slice(1);
  } else {
    return { ok: false, reason: "missing_newline_after_open" };
  }

  const lf = rest.indexOf("\n---\n");
  const crlf = rest.indexOf("\r\n---\r\n");
  let splitAt: number;
  let delimLen: number;
  if (lf === -1 && crlf === -1) {
    return { ok: false, reason: "missing_close" };
  }
  if (lf === -1) {
    splitAt = crlf;
    delimLen = 7;
  } else if (crlf === -1) {
    splitAt = lf;
    delimLen = 5;
  } else {
    splitAt = Math.min(lf, crlf);
    delimLen = splitAt === lf ? 5 : 7;
  }

  const yamlText = rest.slice(0, splitAt);
  const body = rest.slice(splitAt + delimLen);
  // Line 1 = first `---`. First line of yaml is line 2.
  const yamlStartLine = 2;
  return { ok: true, yamlText, body, yamlStartLine };
}

function lineColInFile(
  yamlStartLine: number,
  err: YAMLError,
): { line?: number; column?: number } {
  const lp = err.linePos;
  if (!lp) {
    return {};
  }
  const start = lp[0];
  return {
    line: yamlStartLine + start.line - 1,
    column: start.col,
  };
}

/**
 * Parse YAML text to a plain object, surfacing path + line + column on failure (NF-002).
 */
export function parseYamlMapping(
  yamlText: string,
  filePath: string,
  yamlStartLine: number,
): { value: Record<string, unknown> | null; diagnostics: FrontmatterDiagnostic[] } {
  const diagnostics: FrontmatterDiagnostic[] = [];
  const doc = parseDocument(yamlText);

  if (doc.errors.length > 0) {
    const e = doc.errors[0];
    const { line, column } = lineColInFile(yamlStartLine, e);
    diagnostics.push(
      diag(CODE_YAML_PARSE, e.message, filePath, line, column),
    );
    return { value: null, diagnostics };
  }

  const js = doc.toJS();
  if (js === null || js === undefined) {
    diagnostics.push(
      diag(
        CODE_YAML_NOT_OBJECT,
        "Frontmatter YAML must resolve to a mapping (object), not null.",
        filePath,
        yamlStartLine,
      ),
    );
    return { value: null, diagnostics };
  }
  if (typeof js !== "object" || Array.isArray(js)) {
    diagnostics.push(
      diag(
        CODE_YAML_NOT_OBJECT,
        "Frontmatter YAML must resolve to a mapping (object), not an array or scalar.",
        filePath,
        yamlStartLine,
      ),
    );
    return { value: null, diagnostics };
  }

  return { value: js as Record<string, unknown>, diagnostics };
}

/**
 * Tier-1 parse: YAML frontmatter block + markdown body. Preserves unknown keys (NF-003).
 * For agent files, use {@link normalizeToolsField} on `metadata.tools` to accept comma-separated strings (P1-002).
 */
export function parseFrontmatter(content: string, filePath: string): ParseFrontmatterResult {
  const split = splitFrontmatterDelimiters(content);
  if (!split.ok) {
    if (split.reason === "missing_open") {
      return {
        parsed: null,
        diagnostics: [
          diag(
            CODE_MISSING,
            "Missing opening YAML frontmatter delimiter (expected file to start with '---').",
            filePath,
            1,
            1,
          ),
        ],
      };
    }
    if (split.reason === "missing_newline_after_open") {
      return {
        parsed: null,
        diagnostics: [
          diag(
            CODE_MALFORMED,
            "Malformed frontmatter: expected newline after opening '---'.",
            filePath,
            1,
            1,
          ),
        ],
      };
    }
    return {
      parsed: null,
      diagnostics: [
        diag(
          CODE_MALFORMED,
          "Malformed frontmatter: missing closing '---' delimiter before body.",
          filePath,
          1,
          1,
        ),
      ],
    };
  }

  const { yamlText, body, yamlStartLine } = split;
  const { value, diagnostics } = parseYamlMapping(yamlText, filePath, yamlStartLine);
  if (!value) {
    return { parsed: null, diagnostics };
  }

  const parsed: ParsedFrontmatter = { metadata: value, body };
  return { parsed, diagnostics };
}

/**
 * Normalize `tools` from FR-001 array form or legacy comma-separated string (P1-002 / Phase 6 migration).
 * Returns a new array; does not mutate metadata.
 */
export function normalizeToolsField(value: unknown): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const x of value) {
      if (typeof x === "string") {
        const t = x.trim();
        if (t.length > 0) {
          out.push(t);
        }
      }
    }
    return out;
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return undefined;
}
