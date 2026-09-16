// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 112 §6.3 — Open-in-OPC inbox banner.
//
// Renders a dismissible banner when statecraft hands off a project to OPC
// via an opc:// deep link. "Resolve" calls the bundle endpoint and shows
// what OPC received: project, adapter, contract / process / agent counts.
// The local clone + cockpit activation are separate next-step concerns.

import React, { useEffect, useState } from 'react';
import {
  Inbox,
  X,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  FolderDown,
  CheckCircle2,
  Workflow,
  KeyRound,
} from 'lucide-react';
import { Card } from '@opc/ui/card';
import { Badge } from '@opc/ui/badge';
import { Button } from '@opc/ui/button';
import { api } from '@/lib/api';
import { useProjectOpenInbox } from '@/hooks/useProjectOpenInbox';
import {
  useCloneTokenRefresh,
  patSettingsUrl,
  type CloneTokenStatus,
} from '@/hooks/useCloneTokenRefresh';
import type { OpcBundle } from '@/types/factoryBundle';

const PROJECTS_SUBDIR = 'oap-projects';

function joinPath(parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

export interface ProjectOpenInboxProps {
  /**
   * Called after a successful clone with the local working-tree path
   * and the resolved statecraft bundle (adapter + contracts + processes
   * + agents). App.tsx threads both into `createFactoryTab` so the
   * cockpit can surface the bundle alongside the working tree. Bundle
   * may be null if the user reaches this point without a successful
   * resolve (defensive — UI keeps the Open button disabled until both
   * are present).
   */
  onOpenInFactory?: (path: string, bundle: OpcBundle | null) => void;
}

export const ProjectOpenInbox: React.FC<ProjectOpenInboxProps> = ({
  onOpenInFactory,
}) => {
  const inbox = useProjectOpenInbox();
  const {
    pending,
    bundle,
    bundleLoading,
    bundleError,
    clone,
    fetchBundle,
    cloneProject,
    dismiss,
  } = inbox;

  // Spec 112 §6.4 — token state for the resolved bundle. The hook
  // persists the bundle's clone token to keychain and schedules a
  // pre-expiry refresh. `tokenState.token.value` is what we pass to
  // `cloneProject` so the git subprocess clones with auth.
  const tokenState = useCloneTokenRefresh({
    projectId: bundle?.project.id ?? null,
    initialToken: bundle?.cloneToken ?? null,
  });

  const [homeDir, setHomeDir] = useState<string | null>(null);
  useEffect(() => {
    void api
      .getHomeDirectory()
      .then((p) => setHomeDir(p))
      .catch(() => setHomeDir(null));
  }, []);

  // Statecraft base URL is needed only when we need to deep-link the
  // user at the PAT settings page. Lazily fetched once.
  const [statecraftBaseUrl, setStatecraftBaseUrl] = useState<string>('');
  useEffect(() => {
    void api
      .getStatecraftBaseUrl()
      .then((url) => setStatecraftBaseUrl(url ?? ''))
      .catch(() => setStatecraftBaseUrl(''));
  }, []);

  if (!pending) return null;

  const targetDir = bundle && homeDir
    ? joinPath([homeDir, PROJECTS_SUBDIR, bundle.project.slug])
    : null;

  return (
    <Card className="mx-3 my-2 p-3 border-indigo-500/40 bg-indigo-500/5">
      <div className="flex items-start gap-3">
        <Inbox className="h-4 w-4 text-indigo-500 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">Project handoff from statecraft</span>
            {pending.level && (
              <Badge variant="outline" className="text-xs">
                {pending.level.replace(/_/g, ' ')}
              </Badge>
            )}
          </div>

          <div className="text-xs text-muted-foreground font-mono break-all">
            {pending.cloneUrl}
          </div>

          {bundleError && (
            <div className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="break-words">{bundleError}</span>
            </div>
          )}

          {bundle && (
            <div className="text-xs text-muted-foreground space-y-0.5 pt-1 border-t border-border/40 mt-2">
              <div className="flex items-center gap-2">
                <span>
                  <span className="text-foreground">Project:</span> {bundle.project.name}
                  <span className="font-mono ml-1.5">({bundle.project.slug})</span>
                </span>
                <CloneTokenBadge status={tokenState.status} source={tokenState.token?.source ?? null} />
              </div>
              {bundle.adapter && (
                <div>
                  <span className="text-foreground">Adapter:</span>{' '}
                  <span className="font-mono">
                    {bundle.adapter.name} @ {bundle.adapter.version}
                  </span>
                </div>
              )}
              <div className="flex gap-3 pt-0.5">
                <span>{bundle.contracts.length} contracts</span>
                <span>·</span>
                <span>{bundle.processes.length} processes</span>
                <span>·</span>
                <span>{bundle.agents.length} agents</span>
              </div>
            </div>
          )}

          {bundle && tokenState.status === 'pat_invalid' && (
            <Card className="p-2.5 border-amber-500/40 bg-amber-500/5 text-xs space-y-1 mt-2">
              <div className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                <KeyRound className="h-3.5 w-3.5" />
                GitHub PAT may be invalid
              </div>
              <div className="text-muted-foreground">
                {tokenState.error ?? 'GitHub rejected the project PAT during refresh.'}
              </div>
              <div className="flex items-center gap-2 pt-1">
                {statecraftBaseUrl && (
                  <a
                    href={patSettingsUrl(statecraftBaseUrl, bundle.project.id)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Manage PAT in Statecraft
                  </a>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-amber-600 dark:text-amber-400 hover:text-amber-700"
                  onClick={() => void tokenState.refresh()}
                >
                  Try again
                </Button>
              </div>
            </Card>
          )}

          {bundle && tokenState.status === 'error' && tokenState.error && (
            <div className="flex items-start gap-1.5 text-xs text-destructive mt-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="break-words">
                Token refresh failed: {tokenState.error}
              </span>
            </div>
          )}

          {clone.error && (
            <div className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="break-words">{clone.error}</span>
            </div>
          )}

          {clone.path && (
            <div className="flex items-start gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div className="space-y-0.5 min-w-0 flex-1">
                <div>
                  {clone.alreadyCloned ? 'Already cloned at' : 'Cloned to'}
                </div>
                <div className="font-mono text-muted-foreground break-all">
                  {clone.path}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            {!bundle && (
              <Button
                size="sm"
                variant="default"
                onClick={() => void fetchBundle()}
                disabled={bundleLoading}
              >
                {bundleLoading ? (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                )}
                Resolve bundle
              </Button>
            )}
            {bundle && !clone.path && (
              <Button
                size="sm"
                variant="default"
                onClick={() =>
                  targetDir &&
                  void cloneProject(targetDir, tokenState.token?.value ?? null)
                }
                disabled={
                  !targetDir ||
                  clone.loading ||
                  tokenState.status === 'refreshing' ||
                  tokenState.status === 'pat_invalid'
                }
                title={
                  tokenState.status === 'pat_invalid'
                    ? 'Resolve the PAT issue above before cloning'
                    : (targetDir ?? 'Waiting for home directory…')
                }
              >
                {clone.loading ? (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <FolderDown className="h-3.5 w-3.5 mr-1.5" />
                )}
                Clone locally
              </Button>
            )}
            {clone.path && onOpenInFactory && (
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  if (clone.path) {
                    onOpenInFactory(clone.path, bundle);
                    dismiss();
                  }
                }}
              >
                <Workflow className="h-3.5 w-3.5 mr-1.5" />
                Open in Factory tab
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={dismiss}>
              <X className="h-3.5 w-3.5 mr-1.5" />
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
};

/**
 * Spec 112 §6.4 — compact status indicator for the bundle's clone
 * token. Visible alongside the project name so the user can see at a
 * glance whether the next clone/run will be authed (installation
 * token), authed via PAT, anonymous (public repo), or in a degraded
 * state. The amber/destructive states are also amplified by the
 * banner above; the badge stays small for the happy path.
 */
const CloneTokenBadge: React.FC<{
  status: CloneTokenStatus;
  source: string | null;
}> = ({ status, source }) => {
  switch (status) {
    case 'fresh':
      return (
        <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1">
          <KeyRound className="h-2.5 w-2.5" />
          {source === 'project_github_pat' ? 'PAT' : 'app token'}
        </Badge>
      );
    case 'refreshing':
      return (
        <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1">
          <RefreshCw className="h-2.5 w-2.5 animate-spin" />
          refreshing
        </Badge>
      );
    case 'anonymous':
      return (
        <Badge variant="outline" className="text-[10px] h-5 px-1.5">
          public
        </Badge>
      );
    case 'pat_invalid':
      return (
        <Badge variant="destructive" className="text-[10px] h-5 px-1.5 gap-1">
          <AlertCircle className="h-2.5 w-2.5" />
          PAT invalid
        </Badge>
      );
    case 'error':
      return (
        <Badge variant="destructive" className="text-[10px] h-5 px-1.5 gap-1">
          <AlertCircle className="h-2.5 w-2.5" />
          token error
        </Badge>
      );
    case 'expired':
      return (
        <Badge variant="outline" className="text-[10px] h-5 px-1.5">
          expired
        </Badge>
      );
    case 'uninitialized':
    default:
      return null;
  }
};

export default ProjectOpenInbox;
