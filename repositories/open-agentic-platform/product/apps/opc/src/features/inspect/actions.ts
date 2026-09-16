import type { GovernanceOverview } from '@/features/governance/useGovernanceStatus';

/**
 * Join repository root with a registry `specPath` (POSIX, e.g. `specs/032-.../spec.md`) for Tauri file IO.
 */
export function resolveSpecAbsolutePath(repoRoot: string, specPath: string): string {
  const root = repoRoot.trim().replace(/[/\\]+$/, '');
  const rel = specPath.trim().replace(/^[/\\]+/, '');
  if (!root || !rel) return '';
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root}${sep}${rel.replace(/\//g, sep)}`;
}

export interface SpecActionItem {
  id: string;
  title: string;
  specPath: string;
}

/**
 * Features that expose a `specPath` in the compiled registry (for "View spec" actions).
 */
export function getSpecActionsFromRegistry(
  registry: GovernanceOverview['registry']
): SpecActionItem[] {
  if (registry.status !== 'ok') return [];
  const list = registry.summary?.featureSummaries;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (f): f is SpecActionItem =>
      typeof f?.id === 'string' &&
      typeof f?.specPath === 'string' &&
      f.specPath.length > 0
  );
}
