import React from 'react';
import { Button } from '@opc/ui/button';
import type { GovernanceOverview } from '@/features/governance/useGovernanceStatus';
import { getSpecActionsFromRegistry, resolveSpecAbsolutePath } from './actions';

export interface RegistrySpecFollowUpProps {
  repoRoot: string;
  registry: GovernanceOverview['registry'];
  onViewSpec: (absolutePath: string, title: string) => void;
}

/**
 * Renders "View spec" actions when the compiled registry includes `featureSummaries` (Feature 032 T010).
 */
export const RegistrySpecFollowUp: React.FC<RegistrySpecFollowUpProps> = ({
  repoRoot,
  registry,
  onViewSpec,
}) => {
  const actions = getSpecActionsFromRegistry(registry);
  if (actions.length === 0) return null;

  return (
    <div className="border rounded-md p-3 space-y-2 bg-muted/30" data-testid="registry-spec-follow-up">
      <div className="text-sm font-medium">Follow-up</div>
      <p className="text-xs text-muted-foreground">
        Open a feature spec from the compiled registry in the markdown editor tab.
      </p>
      <div className="flex flex-wrap gap-2">
        {actions.slice(0, 24).map((f) => (
          <Button
            key={f.id}
            variant="secondary"
            size="sm"
            type="button"
            onClick={() =>
              onViewSpec(resolveSpecAbsolutePath(repoRoot, f.specPath), f.title || f.id)
            }
          >
            View spec: {f.title || f.id}
          </Button>
        ))}
      </div>
    </div>
  );
};
