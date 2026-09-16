import type {
  NotificationKind,
  Severity,
  NotificationPreferences,
  PreferenceRule,
} from "../types.js";

/**
 * Resolve which channels should receive a notification event based on
 * user preferences (FR-005).
 *
 * Rules are evaluated in order — first match wins.  A rule matches when:
 *   - `rule.kind` is undefined (wildcard) OR equals `kind`
 *   - `rule.severity` is undefined (wildcard) OR equals `severity`
 *
 * If no rule matches, `preferences.defaultChannels` is returned.
 * An empty `channels` array on the matching rule suppresses delivery.
 */
export function resolveChannels(
  kind: NotificationKind,
  severity: Severity,
  preferences: NotificationPreferences,
): string[] {
  for (const rule of preferences.rules) {
    if (ruleMatches(rule, kind, severity)) {
      return rule.channels;
    }
  }
  return preferences.defaultChannels;
}

function ruleMatches(
  rule: PreferenceRule,
  kind: NotificationKind,
  severity: Severity,
): boolean {
  if (rule.kind !== undefined && rule.kind !== kind) return false;
  if (rule.severity !== undefined && rule.severity !== severity) return false;
  return true;
}
