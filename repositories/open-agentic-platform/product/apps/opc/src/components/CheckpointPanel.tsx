import React from 'react';
import { CheckpointSurface } from '@/features/checkpoint/CheckpointSurface';

export const CheckpointPanel: React.FC<{ projectPath?: string }> = ({ projectPath }) => {
  return <CheckpointSurface projectPath={projectPath} />;
};
