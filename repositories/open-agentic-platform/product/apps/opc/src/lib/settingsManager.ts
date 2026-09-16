/**
 * Settings configuration manager for Claude Code scoped settings
 * Mirrors the HooksManager pattern for three-tier config merging.
 */

export interface ScopedSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
    defaultMode?: string;
  };
  env?: Record<string, string>;
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

export class SettingsManager {
  /**
   * Merge settings from all three scopes with proper priority.
   * Priority: local > project > user (highest wins for scalars, union for arrays)
   */
  static mergeSettings(
    user: ScopedSettings,
    project: ScopedSettings,
    local: ScopedSettings
  ): ScopedSettings {
    const merged: ScopedSettings = {};

    // Permissions: union + dedup for allow/deny, last-writer-wins for defaultMode
    const allAllow = [
      ...(user.permissions?.allow ?? []),
      ...(project.permissions?.allow ?? []),
      ...(local.permissions?.allow ?? []),
    ];
    const allDeny = [
      ...(user.permissions?.deny ?? []),
      ...(project.permissions?.deny ?? []),
      ...(local.permissions?.deny ?? []),
    ];

    merged.permissions = {
      allow: [...new Set(allAllow)],
      deny: [...new Set(allDeny)],
      defaultMode:
        local.permissions?.defaultMode ??
        project.permissions?.defaultMode ??
        user.permissions?.defaultMode,
    };

    // Env: object spread (local wins per-key)
    merged.env = {
      ...(user.env ?? {}),
      ...(project.env ?? {}),
      ...(local.env ?? {}),
    };

    // Scalar settings: last-writer-wins (local > project > user)
    const scalarKeys = ['model', 'verbose', 'includeCoAuthoredBy', 'effortLevel'] as const;
    for (const key of scalarKeys) {
      const value = local[key] ?? project[key] ?? user[key];
      if (value !== undefined) {
        merged[key] = value;
      }
    }

    return merged;
  }
}
