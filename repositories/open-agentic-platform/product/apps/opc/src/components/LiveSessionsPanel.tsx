import React from 'react';
import { LiveSessionsSurface } from '@/features/live-sessions/LiveSessionsSurface';

/**
 * Spec 172 — Live Sessions panel wrapper. Thin shim around the surface that
 * matches the GovernancePanel / CheckpointPanel convention used by
 * TabContent's lazy-loaded case branches.
 */
export const LiveSessionsPanel: React.FC<{ projectPath?: string }> = ({ projectPath }) => {
  return <LiveSessionsSurface projectPath={projectPath} />;
};
