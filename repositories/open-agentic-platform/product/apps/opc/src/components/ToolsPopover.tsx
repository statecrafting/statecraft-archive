import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  FileText,
  Scan,
  Shield,
  Search,
  Share2,
  GitBranch,
  History,
  LayoutGrid,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { Button } from '@opc/ui/button';
import { Popover } from '@opc/ui/popover';
import { TooltipSimple } from '@opc/ui/tooltip-modern';
import { cn } from '@/lib/utils';
import { useTabState } from '@/hooks/useTabState';
import { api } from '@/lib/api';

interface ToolsPopoverProps {
  projectPath: string;
}

export const ToolsPopover: React.FC<ToolsPopoverProps> = ({ projectPath }) => {
  const [open, setOpen] = useState(false);
  const {
    createClaudeMdTab,
    createSpecMarkdownTab,
    createGitContextTab,
    createXrayTab,
    createGovernanceTab,
    createSemanticSearchTab,
    createCallGraphTab,
    createCheckpointTab,
    createLiveSessionsTab,
    createPortfolioTab,
    createPromotionTab,
  } = useTabState();

  if (!projectPath) return null;

  // Preserves c33c2f2e: when a project is active, prefer the project-root
  // CLAUDE.md over the global ~/.claude/CLAUDE.md system prompt.
  const handleClaudeMd = async () => {
    try {
      const files = await api.findClaudeMdFiles(projectPath);
      const rootCandidates = files
        .filter((f) => f.relative_path === 'CLAUDE.md')
        .sort((a, b) => a.absolute_path.length - b.absolute_path.length);
      if (rootCandidates.length > 0) {
        createSpecMarkdownTab(rootCandidates[0].absolute_path, 'CLAUDE.md');
        return;
      }
    } catch {
      // fall through to the global system-prompt tab
    }
    createClaudeMdTab();
  };

  const tools = [
    { key: 'claude-md', icon: FileText, label: 'CLAUDE.md', run: () => { void handleClaudeMd(); } },
    { key: 'git-context', icon: GitBranch, label: 'Git Context', run: () => createGitContextTab(projectPath) },
    { key: 'xray', icon: Scan, label: 'Xray', run: () => createXrayTab(projectPath) },
    { key: 'governance', icon: Shield, label: 'Governance', run: () => createGovernanceTab(projectPath) },
    { key: 'semantic-search', icon: Search, label: 'Search', run: () => createSemanticSearchTab(projectPath) },
    { key: 'call-graph', icon: Share2, label: 'Call Graph', run: () => createCallGraphTab(projectPath) },
    { key: 'checkpoint', icon: History, label: 'Repo Snapshots', run: () => createCheckpointTab(projectPath) },
    { key: 'live-sessions', icon: Activity, label: 'Live', run: () => createLiveSessionsTab(projectPath) },
    { key: 'portfolio', icon: LayoutGrid, label: 'Portfolio', run: () => createPortfolioTab(projectPath) },
    { key: 'promotion', icon: ShieldCheck, label: 'Promotion', run: () => createPromotionTab(projectPath) },
  ];

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="end"
      className="p-2"
      trigger={
        <TooltipSimple content="Tools" side="top">
          <motion.div
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.15 }}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <Wrench className={cn('h-3.5 w-3.5', open && 'text-primary')} />
            </Button>
          </motion.div>
        </TooltipSimple>
      }
      content={
        <div className="grid grid-cols-3 gap-1 w-[260px]">
          {tools.map(({ key, icon: Icon, label, run }) => (
            <button
              key={key}
              onClick={() => {
                run();
                setOpen(false);
              }}
              className="flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors text-muted-foreground"
            >
              <Icon size={16} />
              <span className="text-[10px] font-medium leading-tight">{label}</span>
            </button>
          ))}
        </div>
      }
    />
  );
};
