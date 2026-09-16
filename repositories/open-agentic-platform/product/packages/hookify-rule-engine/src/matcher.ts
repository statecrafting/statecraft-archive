import type { HookEvent, Matcher } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepSubsetMatch(expected: Record<string, unknown>, actual: unknown): boolean {
  if (!isRecord(actual)) {
    return false;
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    if (!(key in actual)) {
      return false;
    }
    const actualValue = actual[key];
    if (isRecord(expectedValue)) {
      if (!deepSubsetMatch(expectedValue, actualValue)) {
        return false;
      }
      continue;
    }
    if (expectedValue !== actualValue) {
      return false;
    }
  }
  return true;
}

function resolveToolName(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.tool === "string") {
    return payload.tool;
  }
  if (isRecord(payload.tool) && typeof payload.tool.name === "string") {
    return payload.tool.name;
  }
  if (typeof payload.toolName === "string") {
    return payload.toolName;
  }
  if (typeof payload.name === "string") {
    return payload.name;
  }
  return undefined;
}

export function matchesRuleEventType(ruleEventType: HookEvent["type"], event: HookEvent): boolean {
  return ruleEventType === event.type;
}

export function matchesRuleMatcher(matcher: Matcher, event: HookEvent): boolean {
  if (matcher.tool) {
    const toolName = resolveToolName(event.payload);
    if (toolName !== matcher.tool) {
      return false;
    }
  }

  if (matcher.input) {
    const input = event.payload.input;
    if (!deepSubsetMatch(matcher.input, input)) {
      return false;
    }
  }

  if (matcher.output) {
    const output = event.payload.output;
    if (!deepSubsetMatch(matcher.output, output)) {
      return false;
    }
  }

  return true;
}
