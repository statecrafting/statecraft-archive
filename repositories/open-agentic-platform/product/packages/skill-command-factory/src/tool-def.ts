// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 071-skill-command-factory

/**
 * SkillToolDef — wraps a ParsedSkill as an invocable tool for the ToolRegistry.
 *
 * FR-004: Prompt-type renders body as system prompt with $ARGS replacement.
 * FR-005: Agent-type spawns sub-agent via dispatch.
 * FR-006: Headless-type returns task ID immediately.
 * FR-007: Skills are invocable both as slash commands and tool calls.
 */

import { computeEffectiveTools } from "./filter.js";
import type {
  HeadlessSpawnFn,
  ParsedSkill,
  SkillDispatchFn,
  SkillExecutionContext,
  SkillToolResult,
} from "./types.js";

export interface SkillToolDefOptions {
  /** All tools currently registered in the ToolRegistry. */
  readonly allTools: readonly string[];
  /** Tools denied by the permission runtime. */
  readonly deniedTools?: readonly string[];
  /** Dispatch function for prompt/agent execution. */
  readonly dispatch?: SkillDispatchFn;
  /** Spawn function for headless execution. */
  readonly headlessSpawn?: HeadlessSpawnFn;
}

/**
 * A skill wrapped as a tool definition.
 *
 * The `name`, `description`, and `inputSchema` properties match the ToolDef
 * contract from Feature 067 so this object can be registered in the ToolRegistry.
 */
export class SkillToolDef {
  readonly skill: ParsedSkill;
  private readonly options: SkillToolDefOptions;

  constructor(skill: ParsedSkill, options: SkillToolDefOptions) {
    this.skill = skill;
    this.options = options;
  }

  /** Unique tool name — prefixed "skill:" to avoid collisions with native tools. */
  get name(): string {
    return `skill:${this.skill.name}`;
  }

  /** Human-readable description (NF-002). */
  get description(): string {
    return this.skill.description;
  }

  /** JSON Schema for tool input — accepts an `args` string (FR-007). */
  get inputSchema(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        args: {
          type: "string",
          description: "Arguments to pass to the skill",
        },
      },
    };
  }

  /** Render the prompt body with $ARGS substitution (FR-004). */
  renderPrompt(args: string): string {
    return this.skill.body.replaceAll("$ARGS", args);
  }

  /** Compute the effective tools for this skill's execution context. */
  effectiveTools(): readonly string[] {
    return computeEffectiveTools(
      this.skill.allowedTools,
      this.options.allTools,
      this.options.deniedTools,
    );
  }

  /** Execute the skill (FR-004/FR-005/FR-006). */
  async execute(args: string): Promise<SkillToolResult> {
    const prompt = this.renderPrompt(args);
    const tools = this.effectiveTools();

    const ctx: SkillExecutionContext = {
      args,
      availableTools: tools,
      model: this.skill.model,
    };

    switch (this.skill.skillType) {
      case "prompt": {
        if (!this.options.dispatch) {
          return {
            content: "No dispatch function configured for prompt skill execution",
            isError: true,
          };
        }
        return this.options.dispatch(ctx, prompt, "prompt");
      }
      case "agent": {
        if (!this.options.dispatch) {
          return {
            content: "No dispatch function configured for agent skill execution",
            isError: true,
          };
        }
        return this.options.dispatch(ctx, prompt, "agent");
      }
      case "headless": {
        if (!this.options.headlessSpawn) {
          return {
            content: "No headless spawn function configured",
            isError: true,
          };
        }
        const taskId = await this.options.headlessSpawn(ctx, prompt);
        return {
          content: taskId,
          isError: false,
          metadata: { taskId, skillType: "headless" },
        };
      }
    }
  }
}
