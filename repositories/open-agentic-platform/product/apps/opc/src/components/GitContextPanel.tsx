import React from 'react';
import { GitContextSurface } from '@/features/git/GitContextSurface';

/** Git Context tab — native git is source-of-truth; optional GitHub enrichment via axiomregent GitHub tools. */
export const GitContextPanel: React.FC<{ projectPath?: string }> = ({ projectPath }) => {
  return <GitContextSurface projectPath={projectPath} />;
};
