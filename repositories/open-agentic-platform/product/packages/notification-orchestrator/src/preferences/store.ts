import type { NotificationPreferences, PreferenceRule } from "../types.js";

/**
 * Default preferences: no rules, deliver to all channels.
 * An empty `defaultChannels` array means "all registered adapters"
 * (the orchestrator interprets an empty resolved list as "all available").
 */
const DEFAULT_PREFERENCES: NotificationPreferences = {
  rules: [],
  defaultChannels: [],
};

/**
 * In-memory preference store with get / set / update semantics.
 *
 * Stores a single {@link NotificationPreferences} instance.
 * A `null` return from `get()` means no preferences have been set —
 * callers should fall back to delivering on all channels.
 */
export class PreferenceStore {
  private prefs: NotificationPreferences | null = null;

  /**
   * Return current preferences, or `null` if none have been set.
   */
  get(): NotificationPreferences | null {
    return this.prefs;
  }

  /**
   * Replace the entire preference set.
   */
  set(preferences: NotificationPreferences): void {
    this.prefs = { ...preferences, rules: [...preferences.rules] };
  }

  /**
   * Add a rule to the end of the rules list.
   * Initializes preferences with empty defaults if none exist.
   */
  addRule(rule: PreferenceRule): void {
    if (this.prefs === null) {
      this.prefs = { ...DEFAULT_PREFERENCES, rules: [] };
    }
    this.prefs.rules.push({ ...rule });
  }

  /**
   * Remove all rules that match a given kind and severity combination.
   * Returns the number of rules removed.
   */
  removeRules(kind?: string, severity?: string): number {
    if (this.prefs === null) return 0;
    const before = this.prefs.rules.length;
    this.prefs.rules = this.prefs.rules.filter(
      (r) => r.kind !== kind || r.severity !== severity,
    );
    return before - this.prefs.rules.length;
  }

  /**
   * Set the default channels (fallback when no rule matches).
   * Initializes preferences with empty rules if none exist.
   */
  setDefaultChannels(channels: string[]): void {
    if (this.prefs === null) {
      this.prefs = { rules: [], defaultChannels: [...channels] };
    } else {
      this.prefs.defaultChannels = [...channels];
    }
  }

  /**
   * Clear all stored preferences.
   */
  clear(): void {
    this.prefs = null;
  }
}
