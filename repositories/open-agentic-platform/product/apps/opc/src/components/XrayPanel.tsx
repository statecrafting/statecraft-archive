import React from 'react';
import { InspectSurface } from '@/features/inspect/InspectSurface';

/** Xray tab body — Feature 032 T003 inspect shell (typed states + real xray invoke). */
export const XrayPanel: React.FC<{ projectPath?: string }> = ({ projectPath }) => {
  return <InspectSurface projectPath={projectPath} />;
};
