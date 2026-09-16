import { describe, expect, test } from "vitest";

import {
  canonicalizeArgumentSegments,
  matchesPermissionPattern,
  normalizePermissionPattern,
  parsePermissionPattern,
} from "./pattern";

describe("parsePermissionPattern", () => {
  test("normalizes explicit Tool(argumentPattern) shape", () => {
    const parsed = parsePermissionPattern("  Read( /Users/me/** )  ");
    expect(parsed).toEqual({
      ok: true,
      value: {
        toolPattern: "Read",
        argumentPattern: "/Users/me/**",
        normalized: "Read(/Users/me/**)",
      },
    });
  });

  test("returns diagnostics for invalid patterns", () => {
    expect(parsePermissionPattern("")).toMatchObject({
      ok: false,
      diagnostic: { code: "PERM_PATTERN_EMPTY" },
    });
    expect(parsePermissionPattern("Read")).toMatchObject({
      ok: false,
      diagnostic: { code: "PERM_PATTERN_INVALID_FORMAT" },
    });
    expect(parsePermissionPattern("(foo)")).toMatchObject({
      ok: false,
      diagnostic: { code: "PERM_PATTERN_EMPTY_TOOL" },
    });
    expect(parsePermissionPattern("Read()")).toMatchObject({
      ok: false,
      diagnostic: { code: "PERM_PATTERN_EMPTY_ARGUMENT" },
    });
  });
});

describe("matchesPermissionPattern", () => {
  test("* matches a single segment while ** matches recursive segments", () => {
    expect(
      matchesPermissionPattern("Read(/Users/*/projects/**)", {
        toolName: "Read",
        argument: "/Users/me/projects/foo/bar.ts",
      }),
    ).toBe(true);

    expect(
      matchesPermissionPattern("Read(/Users/*/projects/*)", {
        toolName: "Read",
        argument: "/Users/me/projects/foo/bar.ts",
      }),
    ).toBe(false);
  });

  test("is deterministic across repeated calls", () => {
    const target = {
      toolName: "Bash",
      argument: "git:commit:--amend",
    };

    const first = matchesPermissionPattern("Bash(git:commit:*)", target);
    const second = matchesPermissionPattern("Bash(git:commit:*)", target);
    const third = matchesPermissionPattern("Bash(git:commit:*)", target);

    expect(first).toBe(true);
    expect(second).toBe(first);
    expect(third).toBe(second);
  });

  test("SC-004 fixture: Read(/Users/me/**) include/exclude", () => {
    expect(
      matchesPermissionPattern("Read(/Users/me/**)", {
        toolName: "Read",
        argument: "/Users/me/projects/foo/bar.ts",
      }),
    ).toBe(true);

    expect(
      matchesPermissionPattern("Read(/Users/me/**)", {
        toolName: "Read",
        argument: "/Users/other/file.ts",
      }),
    ).toBe(false);
  });

  test("documents colon-segment mapping for command-like inputs", () => {
    // F-002: command tokens map to colon-delimited segments before matching.
    const commandArg = canonicalizeArgumentSegments("git commit --amend");
    expect(commandArg).toBe("git:commit:--amend");
    expect(
      matchesPermissionPattern("Bash(git:commit:*)", {
        toolName: "Bash",
        argument: commandArg,
      }),
    ).toBe(true);
  });

  test("normalizePermissionPattern keeps deterministic serialized form", () => {
    expect(normalizePermissionPattern("  Bash( git:commit:* ) ")).toBe(
      "Bash(git:commit:*)",
    );
  });
});
