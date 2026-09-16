import React from 'react';
import { Globe, FolderOpen, GitBranch, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OpenProject } from '@/hooks/useOpenProjects';

export type SettingsScope =
  | { type: 'user' }
  | { type: 'project'; projectPath: string }
  | { type: 'local'; projectPath: string };

interface ScopeSelectorProps {
  openProjects: OpenProject[];
  selectedScope: SettingsScope;
  onScopeChange: (scope: SettingsScope) => void;
}

/** Returns a stable string key for comparing scopes. */
export function scopeKey(s: SettingsScope): string {
  if (s.type === 'user') return 'user';
  return `${s.type}:${s.projectPath}`;
}

/** Human-readable file path label for the active scope. */
export function scopeLabel(s: SettingsScope): string {
  if (s.type === 'user') return '~/.claude/settings.json';
  if (s.type === 'project') return `${s.projectPath}/.claude/settings.json`;
  return `${s.projectPath}/.claude/settings.local.json`;
}

const pill =
  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer select-none';
const pillActive = 'bg-background shadow-sm';
const pillInactive = 'hover:bg-background/50';

export const ScopeSelector: React.FC<ScopeSelectorProps> = ({
  openProjects,
  selectedScope,
  onScopeChange,
}) => {
  const activeKey = scopeKey(selectedScope);
  const isProjectSelected = selectedScope.type !== 'user';
  const selectedProjectPath =
    selectedScope.type !== 'user' ? selectedScope.projectPath : null;

  return (
    <div className="space-y-2">
      {/* Row 1: Global vs. projects */}
      <div className="flex items-center gap-1 p-1 bg-muted/30 rounded-lg flex-wrap">
        <button
          className={cn(pill, activeKey === 'user' ? pillActive : pillInactive)}
          onClick={() => onScopeChange({ type: 'user' })}
        >
          <Globe className="h-3.5 w-3.5" />
          Global
        </button>
        {openProjects.map((proj) => {
          const isActive =
            isProjectSelected && selectedProjectPath === proj.path;
          return (
            <button
              key={proj.path}
              className={cn(pill, isActive ? pillActive : pillInactive)}
              onClick={() =>
                onScopeChange({ type: 'project', projectPath: proj.path })
              }
              title={proj.path}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {proj.displayName}
            </button>
          );
        })}
        {openProjects.length === 0 && (
          <span className="text-xs text-muted-foreground px-2">
            Open a project tab to edit project-scoped settings
          </span>
        )}
      </div>

      {/* Row 2: Project (shared) vs Personal (local) sub-toggle */}
      {isProjectSelected && selectedProjectPath && (
        <div className="flex items-center gap-1 p-1 bg-muted/20 rounded-lg ml-4">
          <button
            className={cn(
              pill,
              selectedScope.type === 'project' ? pillActive : pillInactive
            )}
            onClick={() =>
              onScopeChange({
                type: 'project',
                projectPath: selectedProjectPath,
              })
            }
          >
            <GitBranch className="h-3.5 w-3.5" />
            Project (shared)
          </button>
          <button
            className={cn(
              pill,
              selectedScope.type === 'local' ? pillActive : pillInactive
            )}
            onClick={() =>
              onScopeChange({
                type: 'local',
                projectPath: selectedProjectPath,
              })
            }
          >
            <User className="h-3.5 w-3.5" />
            Personal (local)
          </button>
        </div>
      )}

      {/* Scope file label */}
      <p className="text-xs font-mono text-muted-foreground ml-1">
        Editing: {scopeLabel(selectedScope)}
      </p>
    </div>
  );
};
