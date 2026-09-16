import React from 'react';
import { GovernanceSurface } from '@/features/governance/GovernanceSurface';

export const GovernancePanel: React.FC<{ projectPath?: string }> = ({ projectPath }) => {
  return <GovernanceSurface projectPath={projectPath} />;
};
