// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 071-skill-command-factory

// ---------------------------------------------------------------------------
// Skill types (FR-001)
// ---------------------------------------------------------------------------

/** Skill execution type (FR-001, FR-004/FR-005/FR-006). */
export type SkillType = "prompt" | "agent" | "headless";

/** Hook declaration inside skill frontmatter (FR-008). */
export interface SkillHookDeclaration {
  readonly name: string;
  readonly type: "bash" | "agent" | "prompt";
  readonly if?: string;
  readonly run: string;
}

/** Parsed YAML frontmatter from a skill markdown file (FR-001). */
export interface SkillFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly type: SkillType;
  readonly allowed_tools: readonly string[] | "*";
  readonly model?: string;
  readonly hooks?: Readonly<Record<string, readonly SkillHookDeclaration[]>>;
  readonly trigger?: string | null;
}

/** A fully parsed skill ready for registration. */
export interface ParsedSkill {
  /** Unique skill name (from frontmatter or derived from filename). */
  readonly name: string;
  /** Human-readable description (NF-002). */
  readonly description: string;
  /** Execution type. */
  readonly skillType: SkillType;
  /** Tools this skill may use, or "*" for all (FR-003). */
  readonly allowedTools: readonly string[] | "*";
  /** Optional model override hint. */
  readonly model?: string;
  /** Hook declarations to register in HookRegistry (FR-008). */
  readonly hooks: Readonly<Record<string, readonly SkillHookDeclaration[]>>;
  /** Auto-trigger condition, if any. */
  readonly trigger: string | null;
  /** The raw markdown body (prompt template). */
  readonly body: string;
  /** Source file path. */
  readonly sourcePath: string;
}

// ---------------------------------------------------------------------------
// Load results (FR-009)
// ---------------------------------------------------------------------------

export type SkillLoadStatus = "ok" | "warning" | "error";

export interface SkillLoadResult {
  readonly filePath: string;
  readonly status: SkillLoadStatus;
  readonly skill?: ParsedSkill;
  readonly message?: string;
}

// ---------------------------------------------------------------------------
// Tool integration types
// ---------------------------------------------------------------------------

/** Minimal ToolResult compatible with tool-definition-registry. */
export interface SkillToolResult {
  readonly content: string;
  readonly isError: boolean;
  readonly metadata?: Record<string, unknown>;
}

/** Execution context for skill tool invocations. */
export interface SkillExecutionContext {
  readonly args: string;
  readonly availableTools: readonly string[];
  readonly model?: string;
}

/** Dispatch function for agent-type and prompt-type skill execution. */
export type SkillDispatchFn = (
  ctx: SkillExecutionContext,
  prompt: string,
  skillType: SkillType,
) => Promise<SkillToolResult>;

/** Background task spawner for headless skills (FR-006). */
export type HeadlessSpawnFn = (
  ctx: SkillExecutionContext,
  prompt: string,
) => Promise<string>; // returns task ID

// ---------------------------------------------------------------------------
// Tool filtering (FR-003, NF-003)
// ---------------------------------------------------------------------------

/** A filtered view of available tools. */
export interface ToolFilter {
  /** Returns the intersection of allowed tools and permission-granted tools. */
  filter(
    allowedTools: readonly string[] | "*",
    allTools: readonly string[],
  ): readonly string[];
}

// ---------------------------------------------------------------------------
// Factory options
// ---------------------------------------------------------------------------

export interface SkillFactoryOptions {
  /** Dispatch function for executing prompt/agent skills. */
  readonly dispatch?: SkillDispatchFn;
  /** Spawn function for headless skills. */
  readonly headlessSpawn?: HeadlessSpawnFn;
  /** Permission-denied tools to exclude from filtered lists (NF-003). */
  readonly deniedTools?: readonly string[];
}
