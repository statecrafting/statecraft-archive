export interface PatternDiagnostic {
  code:
    | "PERM_PATTERN_EMPTY"
    | "PERM_PATTERN_INVALID_FORMAT"
    | "PERM_PATTERN_EMPTY_TOOL"
    | "PERM_PATTERN_EMPTY_ARGUMENT";
  message: string;
}

export interface ParsedPermissionPattern {
  toolPattern: string;
  argumentPattern: string;
  normalized: string;
}

export type PatternParseResult =
  | { ok: true; value: ParsedPermissionPattern }
  | { ok: false; diagnostic: PatternDiagnostic };

export interface ToolInvocationPatternTarget {
  toolName: string;
  argument: string;
}

export function normalizePermissionPattern(rawPattern: string): string {
  const parsed = parsePermissionPattern(rawPattern);
  return parsed.ok ? parsed.value.normalized : rawPattern.trim();
}

export function parsePermissionPattern(rawPattern: string): PatternParseResult {
  const candidate = rawPattern.trim();
  if (candidate.length === 0) {
    return {
      ok: false,
      diagnostic: {
        code: "PERM_PATTERN_EMPTY",
        message: "Permission pattern cannot be empty",
      },
    };
  }

  const openParen = candidate.indexOf("(");
  const closeParen = candidate.lastIndexOf(")");
  const hasSinglePair =
    openParen >= 0 &&
    closeParen > openParen &&
    closeParen === candidate.length - 1 &&
    candidate.indexOf("(", openParen + 1) === -1;

  if (!hasSinglePair) {
    return {
      ok: false,
      diagnostic: {
        code: "PERM_PATTERN_INVALID_FORMAT",
        message: 'Pattern must use "Tool(argumentPattern)" format',
      },
    };
  }

  const toolPattern = candidate.slice(0, openParen).trim();
  const argumentPattern = candidate.slice(openParen + 1, closeParen).trim();

  if (toolPattern.length === 0) {
    return {
      ok: false,
      diagnostic: {
        code: "PERM_PATTERN_EMPTY_TOOL",
        message: "Tool pattern cannot be empty",
      },
    };
  }

  if (argumentPattern.length === 0) {
    return {
      ok: false,
      diagnostic: {
        code: "PERM_PATTERN_EMPTY_ARGUMENT",
        message: "Argument pattern cannot be empty",
      },
    };
  }

  return {
    ok: true,
    value: {
      toolPattern,
      argumentPattern,
      normalized: `${toolPattern}(${argumentPattern})`,
    },
  };
}

export function canonicalizeArgumentSegments(argument: string): string {
  return argument
    .trim()
    .split(/\s+/)
    .filter((segment) => segment.length > 0)
    .join(":");
}

export function matchesPermissionPattern(
  pattern: string,
  target: ToolInvocationPatternTarget,
): boolean {
  const parsed = parsePermissionPattern(pattern);
  if (!parsed.ok) {
    return false;
  }

  const toolMatcher = globToRegExp(parsed.value.toolPattern);
  const argumentMatcher = globToRegExp(parsed.value.argumentPattern);
  return toolMatcher.test(target.toolName) && argumentMatcher.test(target.argument);
}

function globToRegExp(globPattern: string): RegExp {
  let source = "";
  for (let index = 0; index < globPattern.length; index += 1) {
    const char = globPattern[index];
    if (char === "*") {
      const isRecursive = globPattern[index + 1] === "*";
      if (isRecursive) {
        source += ".*";
        index += 1;
      } else {
        source += "[^:/]*";
      }
      continue;
    }
    source += escapeRegExpChar(char);
  }

  return new RegExp(`^${source}$`);
}

function escapeRegExpChar(char: string): string {
  return /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char;
}
