import { describe, it, expect } from "vitest";
import { resolveChannels } from "./preference-engine.js";
import type { NotificationPreferences } from "../types.js";

describe("resolveChannels", () => {
  it("returns defaultChannels when no rules exist", () => {
    const prefs: NotificationPreferences = {
      rules: [],
      defaultChannels: ["native", "toast"],
    };
    expect(resolveChannels("task_complete", "info", prefs)).toEqual([
      "native",
      "toast",
    ]);
  });

  it("returns defaultChannels when no rule matches", () => {
    const prefs: NotificationPreferences = {
      rules: [{ kind: "task_error", channels: ["native"] }],
      defaultChannels: ["toast"],
    };
    expect(resolveChannels("task_complete", "info", prefs)).toEqual(["toast"]);
  });

  it("first matching rule wins", () => {
    const prefs: NotificationPreferences = {
      rules: [
        { kind: "task_complete", channels: ["native"] },
        { kind: "task_complete", channels: ["toast"] },
      ],
      defaultChannels: [],
    };
    expect(resolveChannels("task_complete", "info", prefs)).toEqual([
      "native",
    ]);
  });

  it("matches by kind only (severity wildcard)", () => {
    const prefs: NotificationPreferences = {
      rules: [{ kind: "task_error", channels: ["native", "toast"] }],
      defaultChannels: [],
    };
    expect(resolveChannels("task_error", "critical", prefs)).toEqual([
      "native",
      "toast",
    ]);
    expect(resolveChannels("task_error", "info", prefs)).toEqual([
      "native",
      "toast",
    ]);
  });

  it("matches by severity only (kind wildcard)", () => {
    const prefs: NotificationPreferences = {
      rules: [{ severity: "critical", channels: ["native"] }],
      defaultChannels: ["toast"],
    };
    expect(resolveChannels("task_complete", "critical", prefs)).toEqual([
      "native",
    ]);
    expect(resolveChannels("system_alert", "critical", prefs)).toEqual([
      "native",
    ]);
    // non-critical falls through to default
    expect(resolveChannels("task_complete", "info", prefs)).toEqual(["toast"]);
  });

  it("matches by both kind and severity", () => {
    const prefs: NotificationPreferences = {
      rules: [
        { kind: "progress_update", severity: "info", channels: [] },
        { severity: "error", channels: ["native"] },
      ],
      defaultChannels: ["toast"],
    };
    // exact match on first rule
    expect(resolveChannels("progress_update", "info", prefs)).toEqual([]);
    // progress_update + error does NOT match first rule (severity mismatch)
    expect(resolveChannels("progress_update", "error", prefs)).toEqual([
      "native",
    ]);
  });

  it("empty channels array suppresses delivery (SC-003)", () => {
    const prefs: NotificationPreferences = {
      rules: [{ kind: "progress_update", severity: "info", channels: [] }],
      defaultChannels: ["native", "toast"],
    };
    expect(resolveChannels("progress_update", "info", prefs)).toEqual([]);
  });

  it("wildcard rule (no kind, no severity) matches everything", () => {
    const prefs: NotificationPreferences = {
      rules: [{ channels: ["toast"] }],
      defaultChannels: ["native"],
    };
    expect(resolveChannels("task_complete", "info", prefs)).toEqual(["toast"]);
    expect(resolveChannels("system_alert", "critical", prefs)).toEqual([
      "toast",
    ]);
  });

  it("more specific rules should be placed before wildcards", () => {
    const prefs: NotificationPreferences = {
      rules: [
        { kind: "task_error", severity: "critical", channels: ["native"] },
        { channels: ["toast"] }, // wildcard catch-all
      ],
      defaultChannels: [],
    };
    expect(resolveChannels("task_error", "critical", prefs)).toEqual([
      "native",
    ]);
    expect(resolveChannels("task_complete", "info", prefs)).toEqual(["toast"]);
  });
});
