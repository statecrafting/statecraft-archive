import path from "node:path";
import { loadTier1MetadataFromDir } from "./loader.js";
import { normalizeToolsField } from "./parser.js";
import type { FrontmatterDiagnostic } from "./types.js";

const DESCRIPTION_MIN_LENGTH = 50;
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type DefinitionKind = "agent" | "skill" | "auto";

export interface LintOptions {
  kind?: DefinitionKind;
}

export interface LintIssue {
  code: string;
  severity: "error";
  message: string;
  filePath: string;
}

export interface LintFileResult {
  filePath: string;
  kind: "agent" | "skill";
  issues: LintIssue[];
}

export interface LintSummary {
  filesChecked: number;
  errorCount: number;
  ok: boolean;
  files: LintFileResult[];
}

function toLintIssue(diagnostic: FrontmatterDiagnostic): LintIssue {
  const location =
    diagnostic.line !== undefined
      ? ` (line ${diagnostic.line}${diagnostic.column !== undefined ? `, col ${diagnostic.column}` : ""})`
      : "";
  return {
    code: diagnostic.code,
    severity: "error",
    message: `${diagnostic.message}${location}`,
    filePath: diagnostic.filePath,
  };
}

function classifyKind(
  metadata: Record<string, unknown> | null,
  filePath: string,
  mode: DefinitionKind,
): "agent" | "skill" {
  if (mode !== "auto") return mode;
  const normalized = filePath.split(path.sep).join("/");
  if (normalized.includes("/agents/")) return "agent";
  if (normalized.includes("/skills/")) return "skill";
  if (!metadata) return "skill";
  if ("model" in metadata || "tools" in metadata || "category" in metadata) return "agent";
  return "skill";
}

function readStringField(
  metadata: Record<string, unknown>,
  key: string,
  issues: LintIssue[],
  filePath: string,
): string | null {
  const value = metadata[key];
  if (typeof value !== "string") {
    issues.push({
      code: "AFS_LINT_REQUIRED_FIELD",
      severity: "error",
      message: `Missing required string field '${key}'.`,
      filePath,
    });
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    issues.push({
      code: "AFS_LINT_REQUIRED_FIELD",
      severity: "error",
      message: `Required string field '${key}' must be non-empty.`,
      filePath,
    });
    return null;
  }
  return trimmed;
}

function lintCommon(
  metadata: Record<string, unknown>,
  filePath: string,
  issues: LintIssue[],
): void {
  const name = readStringField(metadata, "name", issues, filePath);
  const description = readStringField(metadata, "description", issues, filePath);

  if (name && !KEBAB_CASE.test(name)) {
    issues.push({
      code: "AFS_LINT_NAME_KEBAB_CASE",
      severity: "error",
      message: "Field 'name' must be kebab-case (lowercase letters, numbers, hyphens).",
      filePath,
    });
  }

  if (description && description.length < DESCRIPTION_MIN_LENGTH) {
    issues.push({
      code: "AFS_LINT_DESCRIPTION_TOO_SHORT",
      severity: "error",
      message: `Field 'description' must be at least ${DESCRIPTION_MIN_LENGTH} characters.`,
      filePath,
    });
  }
}

function lintAgent(
  metadata: Record<string, unknown>,
  filePath: string,
  issues: LintIssue[],
): void {
  lintCommon(metadata, filePath, issues);
  readStringField(metadata, "model", issues, filePath);

  if (!("tools" in metadata)) {
    issues.push({
      code: "AFS_LINT_REQUIRED_FIELD",
      severity: "error",
      message: "Missing required field 'tools'.",
      filePath,
    });
    return;
  }

  const tools = normalizeToolsField(metadata.tools);
  if (!tools || tools.length === 0) {
    issues.push({
      code: "AFS_LINT_TOOLS_EMPTY",
      severity: "error",
      message: "Field 'tools' must contain at least one allowed tool for agent definitions.",
      filePath,
    });
  }
}

function lintSkill(
  metadata: Record<string, unknown>,
  filePath: string,
  issues: LintIssue[],
): void {
  lintCommon(metadata, filePath, issues);
}

export function lintDefinitionsInDir(rootDir: string, options: LintOptions = {}): LintSummary {
  const mode = options.kind ?? "auto";
  const entries = loadTier1MetadataFromDir(rootDir);
  const files: LintFileResult[] = [];
  let errorCount = 0;

  for (const entry of entries) {
    const issues: LintIssue[] = [];
    for (const diagnostic of entry.diagnostics) {
      issues.push(toLintIssue(diagnostic));
    }
    if (entry.metadata) {
      const kind = classifyKind(entry.metadata, entry.filePath, mode);
      if (kind === "agent") {
        lintAgent(entry.metadata, entry.filePath, issues);
      } else {
        lintSkill(entry.metadata, entry.filePath, issues);
      }
      errorCount += issues.length;
      files.push({ filePath: entry.filePath, kind, issues });
      continue;
    }

    const fallbackKind = classifyKind(null, entry.filePath, mode);
    errorCount += issues.length;
    files.push({ filePath: entry.filePath, kind: fallbackKind, issues });
  }

  files.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return {
    filesChecked: entries.length,
    errorCount,
    ok: errorCount === 0,
    files,
  };
}

export function formatLintSummary(summary: LintSummary): string {
  const lines: string[] = [];
  lines.push(
    summary.ok
      ? `agent-frontmatter lint passed (${summary.filesChecked} files checked)`
      : `agent-frontmatter lint failed (${summary.errorCount} errors across ${summary.filesChecked} files)`,
  );
  for (const file of summary.files) {
    if (file.issues.length === 0) continue;
    lines.push(`- ${file.filePath}`);
    for (const issue of file.issues) {
      lines.push(`  [${issue.code}] ${issue.message}`);
    }
  }
  return lines.join("\n");
}

