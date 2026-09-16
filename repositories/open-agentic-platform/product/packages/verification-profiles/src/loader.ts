import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { VerificationSkill, VerificationDiagnostic } from "./types.js";
import { parseSkillFile } from "./parser.js";
import { getDefaultSkills } from "./defaults.js";

/** Directory within a project root where local skills are stored. */
const SKILLS_DIR = ".verification/skills";

/** A loaded skill library: name → skill, plus any diagnostics from loading. */
export interface SkillLibrary {
  /** All resolved skills keyed by name. Local skills override platform defaults (R-004). */
  skills: Map<string, VerificationSkill>;
  /** Diagnostics emitted while loading skill files. */
  diagnostics: VerificationDiagnostic[];
}

/**
 * Discover and parse all `.yaml` / `.yml` skill files from
 * `<projectRoot>/.verification/skills/`, merge with platform defaults,
 * and return the combined library.
 *
 * Local project skills override platform defaults when names collide (R-004).
 */
export async function loadSkillLibrary(projectRoot: string): Promise<SkillLibrary> {
  const defaults = getDefaultSkills();
  const diagnostics: VerificationDiagnostic[] = [];
  const localSkills = new Map<string, VerificationSkill>();

  const skillsDir = join(projectRoot, SKILLS_DIR);

  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    // No .verification/skills/ directory — return defaults only.
    return { skills: defaults, diagnostics };
  }

  const yamlFiles = entries
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();

  for (const file of yamlFiles) {
    const filePath = join(skillsDir, file);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (err) {
      diagnostics.push({
        code: "VP_SKILL_READ_ERROR",
        severity: "error",
        message: `Failed to read skill file: ${err instanceof Error ? err.message : String(err)}`,
        filePath,
      });
      continue;
    }

    const result = parseSkillFile(content, filePath);
    diagnostics.push(...result.diagnostics);

    if (result.skill) {
      if (localSkills.has(result.skill.name)) {
        diagnostics.push({
          code: "VP_SKILL_DUPLICATE_NAME",
          severity: "warning",
          message: `Duplicate local skill name "${result.skill.name}" in ${basename(file)}; earlier definition from this directory was overwritten.`,
          filePath,
        });
      }
      localSkills.set(result.skill.name, result.skill);
    }
  }

  // Merge: start with defaults, overlay local skills (R-004: local overrides platform defaults).
  const merged = new Map(defaults);
  for (const [name, skill] of localSkills) {
    merged.set(name, skill);
  }

  return { skills: merged, diagnostics };
}

/**
 * Resolve a skill reference (name) from a loaded library.
 * Returns the skill or `null` with a diagnostic if not found.
 */
export function resolveSkillRef(
  name: string,
  library: SkillLibrary,
): { skill: VerificationSkill | null; diagnostic: VerificationDiagnostic | null } {
  const skill = library.skills.get(name) ?? null;
  if (skill) {
    return { skill, diagnostic: null };
  }
  return {
    skill: null,
    diagnostic: {
      code: "VP_SKILL_NOT_FOUND",
      severity: "error",
      message: `Skill "${name}" not found in library. Available: ${[...library.skills.keys()].join(", ") || "(none)"}.`,
      filePath: "",
    },
  };
}
