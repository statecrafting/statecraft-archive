import { useMemo } from 'react';
import { useTabContext } from '@/contexts/TabContext';

export interface OpenProject {
  path: string;
  displayName: string;
}

/**
 * Derives the set of unique open project paths from all tabs.
 * Collects initialProjectPath (chat tabs) and projectPath (tool tabs).
 */
export const useOpenProjects = (): OpenProject[] => {
  const { tabs } = useTabContext();

  return useMemo(() => {
    const paths = new Set<string>();
    for (const tab of tabs) {
      const p = tab.initialProjectPath ?? tab.projectPath;
      if (p) paths.add(p);
    }

    return Array.from(paths)
      .sort()
      .map(path => ({
        path,
        displayName: path.split('/').filter(Boolean).pop() ?? path,
      }));
  }, [tabs]);
};
