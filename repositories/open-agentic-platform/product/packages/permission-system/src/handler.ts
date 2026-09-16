import { createPermissionEvaluator } from "./evaluator";
import type { PermissionEvaluator, PermissionEvaluatorOptions } from "./evaluator";
import type { PermissionEvaluationResult } from "./types";

export interface PermissionBlockedDecision {
  toolName: string;
  argument: string;
  evaluation: PermissionEvaluationResult;
}

export interface PermissionHandlerOptions {
  evaluator?: PermissionEvaluator;
  evaluatorOptions?: PermissionEvaluatorOptions;
  isInteractive?: boolean;
  nowIso?: string;
  resolveArgument?: (toolName: string, toolInput: Record<string, unknown>) => string;
  onBlocked?: (blocked: PermissionBlockedDecision) => void | Promise<void>;
}

function defaultResolveArgument(
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  if (toolName === "Bash" && typeof toolInput.command === "string") {
    return toolInput.command.trim().split(/\s+/).filter(Boolean).join(":");
  }

  if (typeof toolInput.file_path === "string") {
    return toolInput.file_path;
  }
  if (typeof toolInput.path === "string") {
    return toolInput.path;
  }

  if (typeof toolInput.server === "string" && typeof toolInput.tool === "string") {
    return `${toolInput.server}:${toolInput.tool}`;
  }

  const compact = JSON.stringify(toolInput);
  return compact && compact !== "{}" ? compact : "*";
}

function resolveEvaluator(options: PermissionHandlerOptions): PermissionEvaluator {
  if (options.evaluator) {
    return options.evaluator;
  }
  if (options.evaluatorOptions) {
    return createPermissionEvaluator(options.evaluatorOptions);
  }
  throw new Error("PERMISSION_HANDLER_MISSING_EVALUATOR");
}

export function createPermissionHandler(options: PermissionHandlerOptions) {
  const evaluator = resolveEvaluator(options);
  const resolveArgument = options.resolveArgument ?? defaultResolveArgument;
  const isInteractive = options.isInteractive ?? true;

  return async function canUseTool(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): Promise<boolean> {
    const argument = resolveArgument(toolName, toolInput);
    const evaluation = await evaluator.evaluate({
      toolName,
      argument,
      isInteractive,
      nowIso: options.nowIso,
    });

    if (evaluation.decision === "allow") {
      return true;
    }

    if (options.onBlocked) {
      await options.onBlocked({ toolName, argument, evaluation });
    }
    return false;
  };
}

