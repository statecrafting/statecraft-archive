import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./parser.js";
import type {
  FrontmatterDiagnostic,
  ParsedFrontmatter,
} from "./types.js";

export interface Tier1MetadataEntry {
  /** Absolute path to the markdown file. */
  filePath: string;
  /**
   * Raw frontmatter metadata object when parsing succeeded, or `null` when
   * frontmatter was missing or invalid.
   */
  metadata: Record<string, unknown> | null;
  /** Diagnostics emitted while parsing this file (may be empty). */
  diagnostics: FrontmatterDiagnostic[];
}

export interface Tier2InstructionsEntry extends Tier1MetadataEntry {
  /**
   * Markdown body below the closing `---` delimiter when parsing succeeded,
   * or `null` when parsing failed.
   */
  body: string | null;
}

/**
 * Reference to an external resource declared in frontmatter.
 *
 * For Phase 3 we only support simple file-path resources referenced via a
 * `resources` field on the frontmatter object (string or string[]). This is
 * intentionally conservative; callers can layer richer conventions later.
 */
export interface ResourceRef {
  kind: "file";
  /** Absolute path to the referenced resource. */
  path: string;
}

/**
 * Recursively list `*.md` files under a directory, sorted for deterministic
 * catalogs (FR-004 Tier 1).
 */
export function discoverMarkdownDefinitionFiles(rootDir: string): string[] {
  const result: string[] = [];
  if (!fs.existsSync(rootDir)) {
    return result;
  }
  const st = fs.statSync(rootDir);
  if (!st.isDirectory()) {
    return result;
  }

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // Directory may have been removed between list and read — skip subtree.
      return;
    }

    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p);
      } else if (ent.isFile() && ent.name.endsWith(".md")) {
        result.push(p);
      }
    }
  }

  walk(rootDir);
  result.sort((a, b) => a.localeCompare(b));
  return result;
}

function parseFrontmatterFromFile(filePath: string): {
  parsed: ParsedFrontmatter | null;
  diagnostics: FrontmatterDiagnostic[];
} {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return {
      parsed: null,
      diagnostics: [
        {
          code: "AFS_READ_ERROR",
          severity: "error",
          message: `Failed to read frontmatter file: ${filePath}`,
          filePath,
        },
      ],
    };
  }

  return parseFrontmatter(content, filePath);
}

/**
 * Tier 1: metadata-only scan of a directory tree. Frontmatter metadata is
 * parsed for each markdown file, but callers receive only the metadata object,
 * diagnostics, and file path — the markdown body is intentionally omitted so
 * catalogs can be built without holding instruction text in memory.
 */
export function loadTier1MetadataFromDir(rootDir: string): Tier1MetadataEntry[] {
  const mdFiles = discoverMarkdownDefinitionFiles(rootDir);
  const out: Tier1MetadataEntry[] = [];

  for (const filePath of mdFiles) {
    const abs = path.resolve(filePath);
    const { parsed, diagnostics } = parseFrontmatterFromFile(abs);
    out.push({
      filePath: abs,
      metadata: parsed ? parsed.metadata : null,
      diagnostics,
    });
  }

  return out;
}

/**
 * Tier 2: load full markdown body for a single definition file on demand.
 *
 * This is intended for activation paths (when an agent/skill is actually
 * invoked). Callers typically look up a file from a Tier 1 catalog entry,
 * then call this function to hydrate the body field.
 */
export function loadTier2Instructions(filePath: string): Tier2InstructionsEntry {
  const abs = path.resolve(filePath);
  const { parsed, diagnostics } = parseFrontmatterFromFile(abs);
  return {
    filePath: abs,
    metadata: parsed ? parsed.metadata : null,
    diagnostics,
    body: parsed ? parsed.body : null,
  };
}

/**
 * Tier 3 hook: derive absolute file resource references from a frontmatter
 * `resources` field. This does not read the resources; it only resolves the
 * paths so callers can load them on demand.
 *
+ * Supported shapes:
 * - `resources: "relative/path.txt"`
 * - `resources: ["rel/a.md", "rel/b.json"]`
 */
export function listResourceRefsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
  definitionFilePath: string,
): ResourceRef[] {
  if (!metadata) return [];
  const raw = metadata.resources;
  if (raw === undefined || raw === null) return [];

  const baseDir = path.dirname(definitionFilePath);
  const makeRef = (p: string): ResourceRef => ({
    kind: "file",
    path: path.resolve(baseDir, p),
  });

  if (typeof raw === "string" && raw.trim().length > 0) {
    return [makeRef(raw.trim())];
  }

  if (Array.isArray(raw)) {
    const refs: ResourceRef[] = [];
    for (const item of raw) {
      if (typeof item !== "string") continue;
      const t = item.trim();
      if (t.length === 0) continue;
      refs.push(makeRef(t));
    }
    return refs;
  }

  return [];
}

/**
 * Convenience helper for Tier 3: read the contents of a single file resource
 * reference. Callers can choose their own caching or streaming strategy.
 */
export function loadResourceFile(ref: ResourceRef): string {
  return fs.readFileSync(ref.path, "utf8");
}

