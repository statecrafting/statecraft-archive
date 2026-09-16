import React from 'react';
import { DecompositionSurface } from '@/features/decomposition/DecompositionSurface';

/**
 * Spec 165 — Decompose-project panel wrapper. Thin shim around the surface,
 * matching the LiveSessionsPanel / GovernancePanel convention used by
 * TabContent's lazy-loaded case branches.
 */
export const DecompositionPanel: React.FC<{ projectPath?: string }> = ({ projectPath }) => {
  return <DecompositionSurface projectPath={projectPath} />;
};
