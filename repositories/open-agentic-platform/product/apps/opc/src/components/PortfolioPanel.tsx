import React from 'react';
import { PortfolioSurface } from '@/features/portfolio/PortfolioSurface';

export const PortfolioPanel: React.FC<{ projectPath?: string }> = ({ projectPath }) => {
  return <PortfolioSurface projectPath={projectPath} />;
};
