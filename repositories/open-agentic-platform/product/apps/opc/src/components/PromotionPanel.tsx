import React from 'react';
import { PromotionSurface } from '@/features/promotion/PromotionSurface';

export const PromotionPanel: React.FC<{ projectPath?: string }> = ({ projectPath }) => {
  return <PromotionSurface projectPath={projectPath} />;
};
