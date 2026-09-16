/** Diagnostic emitted when frontmatter cannot be parsed or is not a mapping (NF-002). */
export interface FrontmatterDiagnostic {
  code: string;
  severity: "error";
  message: string;
  filePath: string;
  /** 1-based line in the source file (including opening `---` line as line 1). */
  line?: number;
  /** 1-based column when available. */
  column?: number;
}

export interface ParsedFrontmatter {
  /** Raw YAML object; unknown keys preserved for NF-003 / SC-005. */
  metadata: Record<string, unknown>;
  /** Markdown body below the closing `---`. */
  body: string;
}

export interface ParseFrontmatterResult {
  /** Present when YAML parsed to a non-null object. */
  parsed: ParsedFrontmatter | null;
  diagnostics: FrontmatterDiagnostic[];
}
