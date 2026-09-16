// Spec 112 §6.3 — Project context overview.
//
// Renders the OAP bundle (adapter + contracts + processes + agents)
// resolved by statecraft after Open-in-OPC handoff. Surfaced in the
// Factory cockpit's right pane before the user picks a stage to
// inspect, so the cockpit lands on bundle context rather than an
// empty placeholder.

import React from 'react';
import { Workflow, FileText, Settings2, Bot } from 'lucide-react';
import { GithubIcon } from '@/components/icons/GithubIcon';
import { Badge } from '@opc/ui/badge';
import type { OpcBundle } from '@/types/factoryBundle';

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  count: number;
  emptyLabel?: string;
  children?: React.ReactNode;
}

function Section({
  icon,
  title,
  count,
  emptyLabel,
  children,
}: SectionProps): React.ReactElement {
  return (
    <section className="space-y-1.5">
      <header className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="shrink-0">{icon}</span>
        <span>{title}</span>
        <Badge variant="outline" className="ml-auto text-[10px] font-mono">
          {count}
        </Badge>
      </header>
      {count === 0 ? (
        <div className="text-xs text-muted-foreground italic pl-6">
          {emptyLabel ?? 'none'}
        </div>
      ) : (
        <ul className="space-y-0.5 pl-6">{children}</ul>
      )}
    </section>
  );
}

interface ListItemProps {
  name: string;
  version: string | number;
}

function ListItem({ name, version }: ListItemProps): React.ReactElement {
  return (
    <li className="text-xs flex items-center gap-2 min-w-0">
      <span className="truncate font-medium text-foreground">{name}</span>
      <span className="font-mono text-[10px] text-muted-foreground shrink-0">
        v{version}
      </span>
    </li>
  );
}

export interface ProjectContextOverviewProps {
  bundle: OpcBundle;
}

export const ProjectContextOverview: React.FC<ProjectContextOverviewProps> = ({
  bundle,
}) => {
  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Project header */}
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{bundle.project.name}</h2>
            <Badge variant="secondary" className="text-[10px] font-mono">
              {bundle.project.slug}
            </Badge>
          </div>
          {bundle.repo && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
              <GithubIcon className="h-3 w-3" />
              <span className="truncate">
                {bundle.repo.githubOrg}/{bundle.repo.repoName}
              </span>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{bundle.repo.defaultBranch}</span>
            </div>
          )}
        </header>

        {/* Adapter */}
        <section className="space-y-1.5">
          <header className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Workflow className="h-3.5 w-3.5" />
            <span>Adapter</span>
          </header>
          {bundle.adapter ? (
            <div className="pl-6 text-sm">
              <span className="font-medium">{bundle.adapter.name}</span>
              <span className="font-mono text-xs text-muted-foreground ml-2">
                v{bundle.adapter.version}
              </span>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic pl-6">
              none bound
            </div>
          )}
        </section>

        <Section
          icon={<FileText className="h-3.5 w-3.5" />}
          title="Contracts"
          count={bundle.contracts.length}
        >
          {bundle.contracts.map((c) => (
            <ListItem key={`${c.name}@${c.version}`} name={c.name} version={c.version} />
          ))}
        </Section>

        <Section
          icon={<Settings2 className="h-3.5 w-3.5" />}
          title="Processes"
          count={bundle.processes.length}
        >
          {bundle.processes.map((p) => (
            <ListItem key={`${p.name}@${p.version}`} name={p.name} version={p.version} />
          ))}
        </Section>

        <Section
          icon={<Bot className="h-3.5 w-3.5" />}
          title="Agents"
          count={bundle.agents.length}
          emptyLabel="No agents published in this workspace yet — sync the org agent catalog (spec 111) to populate."
        >
          {bundle.agents.map((a) => (
            <ListItem key={a.id} name={a.name} version={a.version} />
          ))}
        </Section>
      </div>
    </div>
  );
};

export default ProjectContextOverview;
