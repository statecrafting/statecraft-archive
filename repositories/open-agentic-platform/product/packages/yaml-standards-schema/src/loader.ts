import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { CodingStandard, StandardDiagnostic, ParseStandardResult } from "./types.js";
import { parseStandardFile } from "./parser.js";
import { diag } from "./schema.js";

/** Well-known tier subdirectories under `standards/` (FR-005). */
const TIER_DIRS = {
  official: "standards/official",
  community: "standards/community",
  local: "standards/local",
} as const;

/** Tier label for diagnostic messages and resolution ordering. */
export type TierName = "official" | "community" | "local";

/** A single tier's loaded standards plus any diagnostics. */
export interface TierResult {
  tier: TierName;
  standards: Map<string, CodingStandard>;
  diagnostics: StandardDiagnostic[];
}

/** Result of loading all three tiers. */
export interface LoadResult {
  tiers: TierResult[];
  diagnostics: StandardDiagnostic[];
}

/**
 * Discover and parse all `.yaml` / `.yml` standard files from a directory.
 * Returns a Map keyed by standard `id` (later files with the same id overwrite earlier ones).
 * Gracefully returns empty on missing or unreadable directories.
 */
export async function loadStandardsFromDir(
  dirPath: string,
  tier: TierName,
): Promise<TierResult> {
  const standards = new Map<string, CodingStandard>();
  const diagnostics: StandardDiagnostic[] = [];

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    // Directory doesn't exist or isn't readable — return empty tier.
    return { tier, standards, diagnostics };
  }

  const yamlFiles = entries
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();

  for (const file of yamlFiles) {
    const filePath = join(dirPath, file);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (err) {
      diagnostics.push(
        diag(
          "CS_FILE_READ_ERROR",
          `Failed to read standard file: ${err instanceof Error ? err.message : String(err)}`,
          filePath,
        ),
      );
      continue;
    }

    const result: ParseStandardResult = parseStandardFile(content, filePath);
    diagnostics.push(...result.diagnostics);

    if (result.standard) {
      if (standards.has(result.standard.id)) {
        diagnostics.push({
          code: "CS_DUPLICATE_ID",
          severity: "warning",
          message: `Duplicate standard id "${result.standard.id}" in ${tier} tier (${basename(file)}); earlier definition overwritten.`,
          filePath,
        });
      }
      standards.set(result.standard.id, result.standard);
    }
  }

  return { tier, standards, diagnostics };
}

/**
 * Load standards from all three tiers (FR-004, FR-005).
 *
 * @param projectRoot — repository root containing `standards/` directories
 * @param communityPath — optional override for the community tier directory
 *   (defaults to `standards/community/` under projectRoot per R-007)
 */
export async function loadAllTiers(
  projectRoot: string,
  communityPath?: string,
): Promise<LoadResult> {
  const officialDir = join(projectRoot, TIER_DIRS.official);
  const communityDir = communityPath ?? join(projectRoot, TIER_DIRS.community);
  const localDir = join(projectRoot, TIER_DIRS.local);

  // Load all three tiers in parallel for performance.
  const [official, community, local] = await Promise.all([
    loadStandardsFromDir(officialDir, "official"),
    loadStandardsFromDir(communityDir, "community"),
    loadStandardsFromDir(localDir, "local"),
  ]);

  const tiers = [official, community, local];
  const diagnostics = tiers.flatMap((t) => t.diagnostics);

  return { tiers, diagnostics };
}
