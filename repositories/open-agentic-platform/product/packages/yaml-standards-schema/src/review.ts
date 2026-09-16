import { readdir, readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { stringify } from "yaml";
import type { CodingStandard, StandardDiagnostic } from "./types.js";
import type { TierName } from "./loader.js";
import { parseStandardFile } from "./parser.js";
import { diag } from "./schema.js";

/** Well-known candidates directory under `standards/` (spec architecture). */
const CANDIDATES_DIR = "standards/candidates";

/** Tier directory mapping for promotion targets. */
const TIER_DIRS: Record<TierName, string> = {
  official: "standards/official",
  community: "standards/community",
  local: "standards/local",
};

// --- Types ---

/** A candidate standard loaded from the candidates directory. */
export interface CandidateEntry {
  /** The parsed candidate standard. */
  standard: CodingStandard;
  /** Absolute path to the candidate YAML file. */
  filePath: string;
  /** Base filename (e.g., "security-001.yaml"). */
  fileName: string;
}

/** Result of listing candidates. */
export interface ListCandidatesResult {
  /** Candidate standards found (only status: candidate). */
  candidates: CandidateEntry[];
  /** Diagnostics from files that failed to parse. */
  diagnostics: StandardDiagnostic[];
}

/** Options for editing a candidate before promotion. */
export interface EditCandidateOptions {
  /** Updated priority. */
  priority?: CodingStandard["priority"];
  /** Updated context description. */
  context?: string;
  /** Updated tags. */
  tags?: string[];
  /** Updated rules (replaces all rules). */
  rules?: CodingStandard["rules"];
  /** Updated anti-patterns (replaces all). */
  anti_patterns?: CodingStandard["anti_patterns"];
  /** Updated examples (replaces all). */
  examples?: CodingStandard["examples"];
}

/** Result of a promote or reject operation. */
export interface ReviewActionResult {
  /** Whether the action succeeded. */
  success: boolean;
  /** Diagnostics on failure. */
  diagnostics: StandardDiagnostic[];
  /** Path of the output file (promoted location or rejected file). */
  outputPath?: string;
}

// --- Implementation ---

/**
 * List all candidate standards from the `standards/candidates/` directory (Phase 5).
 *
 * Reads and parses all YAML files, returns only those with `status: candidate`.
 * Files that fail to parse or have non-candidate status are reported as diagnostics.
 */
export async function listCandidates(projectRoot: string): Promise<ListCandidatesResult> {
  const candidatesDir = join(projectRoot, CANDIDATES_DIR);
  const candidates: CandidateEntry[] = [];
  const diagnostics: StandardDiagnostic[] = [];

  let entries: string[];
  try {
    entries = await readdir(candidatesDir);
  } catch {
    return { candidates, diagnostics };
  }

  const yamlFiles = entries
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();

  for (const file of yamlFiles) {
    const filePath = join(candidatesDir, file);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (err) {
      diagnostics.push(
        diag(
          "CS_FILE_READ_ERROR",
          `Failed to read candidate file: ${err instanceof Error ? err.message : String(err)}`,
          filePath,
        ),
      );
      continue;
    }

    const result = parseStandardFile(content, filePath);
    diagnostics.push(...result.diagnostics);

    if (result.standard) {
      if (result.standard.status === "candidate") {
        candidates.push({ standard: result.standard, filePath, fileName: file });
      } else {
        diagnostics.push({
          code: "CS_NOT_CANDIDATE",
          severity: "info",
          message: `File "${file}" has status "${result.standard.status}", not "candidate"; skipped.`,
          filePath,
        });
      }
    }
  }

  return { candidates, diagnostics };
}

/**
 * Promote a candidate standard to active status in a target tier (FR-007).
 *
 * Changes status from "candidate" to "active", optionally applies edits,
 * writes the standard to the target tier directory, and removes the candidate file.
 *
 * @param candidateId — the `id` of the candidate to promote
 * @param targetTier — which tier to place the promoted standard in
 * @param projectRoot — repository root
 * @param edits — optional modifications to apply before promotion
 */
export async function promoteCandidate(
  candidateId: string,
  targetTier: TierName,
  projectRoot: string,
  edits?: EditCandidateOptions,
): Promise<ReviewActionResult> {
  const diagnostics: StandardDiagnostic[] = [];

  // Find the candidate
  const listResult = await listCandidates(projectRoot);
  diagnostics.push(...listResult.diagnostics);

  const entry = listResult.candidates.find((c) => c.standard.id === candidateId);
  if (!entry) {
    diagnostics.push(
      diag(
        "CS_CANDIDATE_NOT_FOUND",
        `No candidate with id "${candidateId}" found in ${CANDIDATES_DIR}/.`,
        join(projectRoot, CANDIDATES_DIR),
      ),
    );
    return { success: false, diagnostics };
  }

  // Apply edits if provided
  const promoted: CodingStandard = { ...entry.standard, status: "active" };
  if (edits) {
    if (edits.priority !== undefined) promoted.priority = edits.priority;
    if (edits.context !== undefined) promoted.context = edits.context;
    if (edits.tags !== undefined) promoted.tags = edits.tags;
    if (edits.rules !== undefined) promoted.rules = edits.rules;
    if (edits.anti_patterns !== undefined) promoted.anti_patterns = edits.anti_patterns;
    if (edits.examples !== undefined) promoted.examples = edits.examples;
  }

  // Serialize to YAML
  const yaml = stringify(promoted, { lineWidth: 100 });

  // Ensure target tier directory exists
  const tierDir = join(projectRoot, TIER_DIRS[targetTier]);
  await mkdir(tierDir, { recursive: true });

  // Write to target tier
  const outputPath = join(tierDir, entry.fileName);
  try {
    await writeFile(outputPath, yaml, "utf-8");
  } catch (err) {
    diagnostics.push(
      diag(
        "CS_WRITE_ERROR",
        `Failed to write promoted standard: ${err instanceof Error ? err.message : String(err)}`,
        outputPath,
      ),
    );
    return { success: false, diagnostics };
  }

  // Remove original candidate file
  try {
    await unlink(entry.filePath);
  } catch (err) {
    diagnostics.push({
      code: "CS_DELETE_WARNING",
      severity: "warning",
      message: `Promoted successfully but failed to remove candidate file: ${err instanceof Error ? err.message : String(err)}`,
      filePath: entry.filePath,
    });
  }

  return { success: true, diagnostics, outputPath };
}

/**
 * Reject a candidate standard (Phase 5).
 *
 * Marks the candidate's status as "rejected" and rewrites the file in place.
 * The rejected file remains in `standards/candidates/` for audit trail.
 *
 * @param candidateId — the `id` of the candidate to reject
 * @param projectRoot — repository root
 */
export async function rejectCandidate(
  candidateId: string,
  projectRoot: string,
): Promise<ReviewActionResult> {
  const diagnostics: StandardDiagnostic[] = [];

  // Find the candidate
  const listResult = await listCandidates(projectRoot);
  diagnostics.push(...listResult.diagnostics);

  const entry = listResult.candidates.find((c) => c.standard.id === candidateId);
  if (!entry) {
    diagnostics.push(
      diag(
        "CS_CANDIDATE_NOT_FOUND",
        `No candidate with id "${candidateId}" found in ${CANDIDATES_DIR}/.`,
        join(projectRoot, CANDIDATES_DIR),
      ),
    );
    return { success: false, diagnostics };
  }

  // Mark as rejected and rewrite
  const rejected: CodingStandard = { ...entry.standard, status: "rejected" };
  const yaml = stringify(rejected, { lineWidth: 100 });

  try {
    await writeFile(entry.filePath, yaml, "utf-8");
  } catch (err) {
    diagnostics.push(
      diag(
        "CS_WRITE_ERROR",
        `Failed to write rejected status: ${err instanceof Error ? err.message : String(err)}`,
        entry.filePath,
      ),
    );
    return { success: false, diagnostics };
  }

  return { success: true, diagnostics, outputPath: entry.filePath };
}
