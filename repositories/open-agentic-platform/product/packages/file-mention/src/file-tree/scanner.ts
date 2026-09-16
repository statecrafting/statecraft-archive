/**
 * File tree scanner with gitignore filtering (058 Phase 1).
 *
 * Walks the project directory, respects .gitignore rules, and produces
 * a flat list of relative file paths suitable for the mention index.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, basename } from "node:path";
import type { ScannerOptions, FileCandidate } from "../types.js";

/** Directories always excluded regardless of .gitignore (FR-010, SC-006). */
const ALWAYS_EXCLUDED = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  "__pycache__",
  ".cache",
  "target",
]);

const DEFAULT_MAX_FILES = 100_000;

/**
 * Minimal gitignore pattern matcher.
 *
 * Supports the subset of .gitignore syntax that covers ~95% of real-world
 * patterns: plain names, globs with `*`, directory markers `/`, negation `!`,
 * and `**` for recursive matching.
 */
export function parseGitignorePatterns(content: string): ((path: string) => boolean)[] {
  const matchers: ((path: string) => boolean)[] = [];

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    // Negation patterns are not commonly needed for exclusion scanning
    if (line.startsWith("!")) continue;

    const isDir = line.endsWith("/");
    const pattern = line.replace(/\/$/, "");

    const regex = patternToRegex(pattern, isDir);
    matchers.push((p: string) => regex.test(p));
  }

  return matchers;
}

function patternToRegex(pattern: string, dirOnly: boolean): RegExp {
  // Strip leading / — it means "anchored to root" but shouldn't appear in the regex source
  const anchored = pattern.startsWith("/");
  const cleaned = anchored ? pattern.slice(1) : pattern;

  // Check if this is a "rooted" pattern (has / outside of ** globs).
  // Strip all ** and surrounding slashes, then see if a / remains.
  const withoutGlobs = cleaned.replace(/\*\*/g, "").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
  const hasSlash = anchored || withoutGlobs.includes("/");

  // Escape special regex chars except * and ?
  let re = cleaned.replace(/([.+^${}()|[\]\\])/g, "\\$1");

  // Replace **/ at the start with a special marker (matches "" or "any/path/")
  re = re.replace(/^\*\*\//, "§LEADSTAR§");
  // Replace /**/ in the middle (matches "/any/path/")
  re = re.replace(/\/\*\*\//g, "/§MIDSTAR§/");
  // Replace /** at the end (matches anything after)
  re = re.replace(/\/\*\*$/, "/§TAILSTAR§");
  // Remaining standalone ** (treat as *)
  re = re.replace(/\*\*/g, "§STAR§");

  // Handle * (match within a single segment)
  re = re.replace(/\*/g, "[^/]*");

  // Expand markers
  re = re.replace(/§LEADSTAR§/g, "(|.*/)")
  re = re.replace(/§MIDSTAR§/g, "(.*/)?");
  re = re.replace(/§TAILSTAR§/g, ".*");
  re = re.replace(/§STAR§/g, ".*");

  // Handle ?
  re = re.replace(/\?/g, "[^/]");

  // Anchored or slash-containing patterns match from root; others float
  if (hasSlash) {
    re = "^" + re;
  } else {
    re = "(^|/)" + re;
  }

  re += "(/|$)";

  return new RegExp(re);
}

/**
 * Load .gitignore patterns from a project root.
 * Returns an empty array if no .gitignore exists.
 */
export async function loadGitignore(projectRoot: string): Promise<((path: string) => boolean)[]> {
  try {
    const content = await readFile(join(projectRoot, ".gitignore"), "utf-8");
    return parseGitignorePatterns(content);
  } catch {
    return [];
  }
}

function isIgnored(
  relativePath: string,
  ignoreMatchers: ((path: string) => boolean)[],
): boolean {
  return ignoreMatchers.some((m) => m(relativePath));
}

/**
 * Scan the project file tree and return a flat list of relative file paths.
 *
 * - Excludes ALWAYS_EXCLUDED directories (node_modules, .git, etc.)
 * - Respects .gitignore patterns
 * - Respects optional extraIgnore patterns
 * - Caps output at maxFiles (default 100k)
 */
export async function scanFileTree(options: ScannerOptions): Promise<string[]> {
  const { projectRoot, extraIgnore = [], maxFiles = DEFAULT_MAX_FILES } = options;

  const gitignoreMatchers = await loadGitignore(projectRoot);

  // Parse extra ignore patterns
  const extraMatchers = extraIgnore.length > 0
    ? parseGitignorePatterns(extraIgnore.join("\n"))
    : [];

  const allMatchers = [...gitignoreMatchers, ...extraMatchers];
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (results.length >= maxFiles) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // Permission denied or similar — skip
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) return;

      const name = entry.name;

      // Always-excluded directories
      if (entry.isDirectory() && ALWAYS_EXCLUDED.has(name)) continue;

      const fullPath = join(dir, name);
      const relPath = relative(projectRoot, fullPath);

      // Check gitignore
      if (isIgnored(relPath, allMatchers)) continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        results.push(relPath);
      }
    }
  }

  await walk(projectRoot);
  return results;
}

/**
 * Convert a list of relative paths into FileCandidate objects.
 */
export function filesToCandidates(relativePaths: string[]): FileCandidate[] {
  return relativePaths.map((relativePath) => ({
    type: "file" as const,
    relativePath,
    basename: basename(relativePath),
    icon: iconForFile(relativePath),
  }));
}

/**
 * Simple file icon resolver based on extension.
 */
function iconForFile(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "📄",
    tsx: "⚛️",
    js: "📄",
    jsx: "⚛️",
    json: "📋",
    md: "📝",
    yaml: "📋",
    yml: "📋",
    toml: "📋",
    rs: "🦀",
    py: "🐍",
    go: "🔵",
    css: "🎨",
    html: "🌐",
    svg: "🖼️",
    png: "🖼️",
    jpg: "🖼️",
    sh: "🐚",
    lock: "🔒",
  };
  return map[ext] ?? "📄";
}
