import { describe, it, expect } from "vitest";
import { PreferenceStore } from "./store.js";
import type { NotificationPreferences } from "../types.js";

describe("PreferenceStore", () => {
  it("returns null when no preferences set", () => {
    const store = new PreferenceStore();
    expect(store.get()).toBeNull();
  });

  it("stores and returns preferences via set()", () => {
    const store = new PreferenceStore();
    const prefs: NotificationPreferences = {
      rules: [{ kind: "task_error", channels: ["native"] }],
      defaultChannels: ["toast"],
    };
    store.set(prefs);
    expect(store.get()).toEqual(prefs);
  });

  it("set() creates a defensive copy", () => {
    const store = new PreferenceStore();
    const prefs: NotificationPreferences = {
      rules: [{ kind: "task_error", channels: ["native"] }],
      defaultChannels: ["toast"],
    };
    store.set(prefs);
    // mutate the original
    prefs.rules.push({ channels: ["web-push"] });
    // stored copy is unaffected
    expect(store.get()!.rules).toHaveLength(1);
  });

  it("addRule() initializes preferences if null", () => {
    const store = new PreferenceStore();
    store.addRule({ kind: "task_complete", channels: ["toast"] });
    const prefs = store.get();
    expect(prefs).not.toBeNull();
    expect(prefs!.rules).toHaveLength(1);
    expect(prefs!.rules[0].kind).toBe("task_complete");
    expect(prefs!.defaultChannels).toEqual([]);
  });

  it("addRule() appends to existing rules", () => {
    const store = new PreferenceStore();
    store.set({ rules: [{ channels: ["toast"] }], defaultChannels: [] });
    store.addRule({ kind: "task_error", channels: ["native"] });
    expect(store.get()!.rules).toHaveLength(2);
  });

  it("removeRules() removes matching rules and returns count", () => {
    const store = new PreferenceStore();
    store.set({
      rules: [
        { kind: "task_error", severity: "critical", channels: ["native"] },
        { kind: "task_error", severity: "critical", channels: ["toast"] },
        { kind: "task_complete", channels: ["toast"] },
      ],
      defaultChannels: [],
    });
    const removed = store.removeRules("task_error", "critical");
    expect(removed).toBe(2);
    expect(store.get()!.rules).toHaveLength(1);
    expect(store.get()!.rules[0].kind).toBe("task_complete");
  });

  it("removeRules() returns 0 when no match", () => {
    const store = new PreferenceStore();
    store.set({ rules: [{ channels: ["toast"] }], defaultChannels: [] });
    expect(store.removeRules("task_error", "info")).toBe(0);
  });

  it("removeRules() returns 0 when store is null", () => {
    const store = new PreferenceStore();
    expect(store.removeRules("task_error")).toBe(0);
  });

  it("setDefaultChannels() initializes preferences if null", () => {
    const store = new PreferenceStore();
    store.setDefaultChannels(["native", "toast"]);
    const prefs = store.get();
    expect(prefs).not.toBeNull();
    expect(prefs!.defaultChannels).toEqual(["native", "toast"]);
    expect(prefs!.rules).toEqual([]);
  });

  it("setDefaultChannels() updates existing preferences", () => {
    const store = new PreferenceStore();
    store.set({
      rules: [{ channels: ["toast"] }],
      defaultChannels: ["toast"],
    });
    store.setDefaultChannels(["native"]);
    expect(store.get()!.defaultChannels).toEqual(["native"]);
    // rules unchanged
    expect(store.get()!.rules).toHaveLength(1);
  });

  it("clear() removes all preferences", () => {
    const store = new PreferenceStore();
    store.set({
      rules: [{ channels: ["toast"] }],
      defaultChannels: ["toast"],
    });
    store.clear();
    expect(store.get()).toBeNull();
  });
});
