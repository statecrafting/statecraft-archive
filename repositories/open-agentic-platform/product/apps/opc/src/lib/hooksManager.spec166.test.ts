// Spec: 166-opc-stop-hook-gate-chain
//
// Tests for the four-tier mergeWithPlatform surface and the
// ${OPC_HOOKS_DIR} path resolver. The legacy mergeConfigs surface is
// covered elsewhere; this suite only exercises the platform tier and the
// platform-mandatory floor (FR-006).

import { describe, expect, it } from "vitest";
import { HooksManager } from "./hooksManager";
import type { HooksConfiguration } from "@/types/hooks";

const cmd = (
  id: string,
  command: string,
  extra: Partial<{
    platform_mandatory: boolean;
    disabled: boolean;
    disable_reason: string;
    timeout: number;
  }> = {},
) => ({ type: "command" as const, id, command, ...extra });

const platformChain: HooksConfiguration = {
  PostToolUse: [
    {
      matcher: "Edit|Write",
      hooks: [
        cmd("post-edit-index", "${OPC_HOOKS_DIR}/post-edit-index.sh", { timeout: 5 }),
        cmd("post-edit-spec-lint", "${OPC_HOOKS_DIR}/post-edit-spec-lint.sh", { timeout: 5 }),
      ],
    },
  ],
  Stop: [
    cmd("stop-index", "${OPC_HOOKS_DIR}/stop-index.sh", {
      timeout: 60,
      platform_mandatory: true,
    }),
    cmd("stop-spec-lint", "${OPC_HOOKS_DIR}/stop-spec-lint.sh", { timeout: 60 }),
    cmd("stop-coupling", "${OPC_HOOKS_DIR}/stop-coupling.sh", {
      timeout: 60,
      platform_mandatory: true,
    }),
    cmd("stop-workflow-pins", "${OPC_HOOKS_DIR}/stop-workflow-pins.sh", { timeout: 60 }),
  ],
};

describe("HooksManager.mergeWithPlatform (spec 166)", () => {
  it("returns the platform chain when no lower tiers exist", () => {
    const { merged, audit } = HooksManager.mergeWithPlatform(
      platformChain,
      {},
      {},
      {},
    );
    expect(audit).toEqual([]);
    expect(merged.Stop).toHaveLength(4);
    expect(merged.Stop?.map((h) => h.id)).toEqual([
      "stop-index",
      "stop-spec-lint",
      "stop-coupling",
      "stop-workflow-pins",
    ]);
    expect(merged.PostToolUse?.[0].hooks).toHaveLength(2);
  });

  it("appends a project-tier Stop entry without an id", () => {
    const project: HooksConfiguration = {
      Stop: [{ type: "command", command: "./scripts/my-custom-check.sh" }],
    };
    const { merged, audit } = HooksManager.mergeWithPlatform(platformChain, {}, project, {});
    expect(audit).toEqual([]);
    expect(merged.Stop).toHaveLength(5);
    expect(merged.Stop?.[4].command).toBe("./scripts/my-custom-check.sh");
  });

  it("allows a project to disable a non-mandatory Stop entry with a reason", () => {
    const project: HooksConfiguration = {
      Stop: [
        cmd("stop-workflow-pins", "", {
          disabled: true,
          disable_reason: "no workflows in this project",
        }),
      ],
    };
    const { merged, audit } = HooksManager.mergeWithPlatform(platformChain, {}, project, {});
    const target = merged.Stop?.find((h) => h.id === "stop-workflow-pins");
    expect(target?.disabled).toBe(true);
    expect(target?.disable_reason).toBe("no workflows in this project");
    expect(audit).toEqual([
      {
        kind: "disabled",
        event: "Stop",
        hookId: "stop-workflow-pins",
        scope: "project",
        reason: "no workflows in this project",
      },
    ]);
  });

  it("records validation error when a disable lacks a reason", () => {
    const project: HooksConfiguration = {
      Stop: [cmd("stop-spec-lint", "", { disabled: true })],
    };
    const { merged, audit } = HooksManager.mergeWithPlatform(platformChain, {}, project, {});
    const target = merged.Stop?.find((h) => h.id === "stop-spec-lint");
    expect(target?.disabled).toBe(true);
    expect(audit).toHaveLength(1);
    expect(audit[0].kind).toBe("disabled_missing_reason");
  });

  it("refuses to disable a platform-mandatory entry and records the bypass attempt", () => {
    const project: HooksConfiguration = {
      Stop: [
        cmd("stop-index", "", {
          disabled: true,
          disable_reason: "trying to skip the index check",
        }),
        cmd("stop-coupling", "", {
          disabled: true,
          disable_reason: "we'll fix coupling at PR time",
        }),
      ],
    };
    const { merged, audit } = HooksManager.mergeWithPlatform(platformChain, {}, project, {});
    const index = merged.Stop?.find((h) => h.id === "stop-index");
    const coupling = merged.Stop?.find((h) => h.id === "stop-coupling");
    expect(index?.disabled).toBeFalsy();
    expect(coupling?.disabled).toBeFalsy();
    expect(audit).toHaveLength(2);
    expect(audit.map((a) => a.kind)).toEqual([
      "mandatory_bypass_blocked",
      "mandatory_bypass_blocked",
    ]);
    expect(audit[0].hookId).toBe("stop-index");
    expect(audit[1].hookId).toBe("stop-coupling");
  });

  it("merges PostToolUse by matcher and appends within an existing matcher group", () => {
    const project: HooksConfiguration = {
      PostToolUse: [
        {
          matcher: "Edit|Write",
          hooks: [{ type: "command", command: "./scripts/extra-edit-check.sh" }],
        },
      ],
    };
    const { merged, audit } = HooksManager.mergeWithPlatform(platformChain, {}, project, {});
    expect(audit).toEqual([]);
    expect(merged.PostToolUse?.[0].hooks).toHaveLength(3);
    expect(merged.PostToolUse?.[0].hooks?.[2].command).toBe(
      "./scripts/extra-edit-check.sh",
    );
  });

  it("disables a non-mandatory PostToolUse entry by id", () => {
    const project: HooksConfiguration = {
      PostToolUse: [
        {
          matcher: "Edit|Write",
          hooks: [
            cmd("post-edit-spec-lint", "", {
              disabled: true,
              disable_reason: "we run spec-lint in a separate IDE plugin",
            }),
          ],
        },
      ],
    };
    const { merged, audit } = HooksManager.mergeWithPlatform(platformChain, {}, project, {});
    const target = merged.PostToolUse?.[0].hooks?.find(
      (h) => h.id === "post-edit-spec-lint",
    );
    expect(target?.disabled).toBe(true);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      kind: "disabled",
      event: "PostToolUse",
      matcher: "Edit|Write",
      hookId: "post-edit-spec-lint",
      scope: "project",
    });
  });

  it("allows a lower tier to tighten timeout on a platform entry without disabling it", () => {
    const local: HooksConfiguration = {
      Stop: [cmd("stop-spec-lint", "", { timeout: 30 })],
    };
    const { merged, audit } = HooksManager.mergeWithPlatform(platformChain, {}, {}, local);
    const target = merged.Stop?.find((h) => h.id === "stop-spec-lint");
    expect(target?.timeout).toBe(30);
    expect(target?.disabled).toBeFalsy();
    expect(audit).toEqual([]);
  });

  it("local-tier bypass attempt against a mandatory entry is logged with scope=local", () => {
    const local: HooksConfiguration = {
      Stop: [
        cmd("stop-index", "", {
          disabled: true,
          disable_reason: "local override",
        }),
      ],
    };
    const { merged, audit } = HooksManager.mergeWithPlatform(platformChain, {}, {}, local);
    expect(merged.Stop?.find((h) => h.id === "stop-index")?.disabled).toBeFalsy();
    expect(audit[0]).toMatchObject({
      kind: "mandatory_bypass_blocked",
      scope: "local",
      hookId: "stop-index",
    });
  });
});

describe("HooksManager.resolvePlatformPaths (spec 166)", () => {
  it("substitutes ${OPC_HOOKS_DIR} in all command strings", () => {
    const resolved = HooksManager.resolvePlatformPaths(platformChain, "/Apps/opc/hooks");
    expect(resolved.Stop?.[0].command).toBe("/Apps/opc/hooks/stop-index.sh");
    expect(resolved.PostToolUse?.[0].hooks?.[0].command).toBe(
      "/Apps/opc/hooks/post-edit-index.sh",
    );
  });

  it("leaves commands without the placeholder unchanged", () => {
    const cfg: HooksConfiguration = {
      Stop: [{ type: "command", command: "/usr/local/bin/something" }],
    };
    const resolved = HooksManager.resolvePlatformPaths(cfg, "/Apps/opc/hooks");
    expect(resolved.Stop?.[0].command).toBe("/usr/local/bin/something");
  });

  it("does not mutate the input config", () => {
    const before = JSON.stringify(platformChain);
    HooksManager.resolvePlatformPaths(platformChain, "/x");
    expect(JSON.stringify(platformChain)).toBe(before);
  });
});
