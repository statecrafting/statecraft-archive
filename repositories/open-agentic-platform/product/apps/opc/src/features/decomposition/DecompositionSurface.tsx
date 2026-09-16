// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/165-opc-decomposition-pipeline/spec.md — FR-001

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSearch, Loader2, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@opc/ui/button';
import {
  api,
  type DecompositionPromotionDto,
  type DecompositionRunDto,
  type DecompositionStageDto,
} from '@/lib/api';

interface DecompositionSurfaceProps {
  projectPath?: string;
}

function degradedLabel(d: DecompositionStageDto['degraded']): string | null {
  if (!d) return null;
  if (typeof d === 'string') return d;
  if (typeof d === 'object' && 'other' in d) return d.other;
  return null;
}

function stageBadgeClass(status: string): string {
  switch (status) {
    case 'complete':
      return 'bg-emerald-500/15 text-emerald-400';
    case 'cached':
      return 'bg-sky-500/15 text-sky-400';
    case 'degraded':
      return 'bg-amber-500/15 text-amber-400';
    case 'failed':
      return 'bg-red-500/15 text-red-400';
    default:
      return 'bg-zinc-500/15 text-zinc-400';
  }
}

/**
 * Spec 165 FR-001 — "Decompose project" action + staging browser + promote.
 *
 * Runs the six-stage pipeline against a project working tree, lists prior
 * runs, shows the staged draft specs a run emitted, and promotes a chosen
 * draft into the project's spec spine. Decomposition is Tauri-only (it needs
 * filesystem access to the working tree).
 */
export const DecompositionSurface: React.FC<DecompositionSurfaceProps> = ({ projectPath }) => {
  const [path, setPath] = useState(projectPath ?? '');
  const [runs, setRuns] = useState<DecompositionRunDto[]>([]);
  const [selected, setSelected] = useState<DecompositionRunDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetSlugs, setTargetSlugs] = useState<Record<string, string>>({});
  const [promoting, setPromoting] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<DecompositionPromotionDto | null>(null);
  const mountedRef = useRef(true);

  const loadRuns = useCallback(async (p: string) => {
    if (!p) return;
    setLoading(true);
    try {
      const list = await api.decompositionListRuns(p);
      if (!mountedRef.current) return;
      setRuns(list);
      setSelected((cur) => cur ?? list[0] ?? null);
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (path) void loadRuns(path);
    return () => {
      mountedRef.current = false;
    };
  }, [loadRuns, path]);

  const runDecomposition = useCallback(async () => {
    if (!path) return;
    setRunning(true);
    setPromotion(null);
    try {
      const run = await api.decompositionRun({ projectPath: path });
      if (!mountedRef.current) return;
      setSelected(run);
      setError(null);
      await loadRuns(path);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setRunning(false);
    }
  }, [path, loadRuns]);

  const promote = useCallback(
    async (stagedSlug: string) => {
      if (!selected) return;
      const targetSlug = (targetSlugs[stagedSlug] ?? '').trim();
      if (!targetSlug) {
        setError('enter a target slug (e.g. 042-my-feature) before promoting');
        return;
      }
      setPromoting(stagedSlug);
      setPromotion(null);
      try {
        const result = await api.decompositionPromote({
          projectPath: path,
          runId: selected.runId,
          stagedSlug,
          targetSlug,
        });
        if (!mountedRef.current) return;
        setPromotion(result);
        setError(null);
      } catch (e) {
        if (!mountedRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mountedRef.current) setPromoting(null);
      }
    },
    [selected, targetSlugs, path],
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4 text-sm">
      <header className="flex items-center gap-2">
        <FileSearch className="h-5 w-5 text-sky-400" />
        <div>
          <h2 className="text-base font-semibold">Decompose project</h2>
          <p className="text-xs text-zinc-400">
            Reverse-engineer draft specs from a project's code + knowledge (spec 165).
          </p>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <input
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs"
          placeholder="/path/to/project"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          aria-label="project path"
        />
        <Button onClick={() => void runDecomposition()} disabled={!path || running}>
          {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
          Run decomposition
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {loading && !runs.length && (
        <div className="flex items-center gap-2 text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading prior runs…
        </div>
      )}

      {runs.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Runs ({runs.length})
          </h3>
          <ul className="space-y-1">
            {runs.map((r) => (
              <li key={r.runId}>
                <button
                  className={`w-full rounded px-2 py-1 text-left font-mono text-xs ${
                    selected?.runId === r.runId ? 'bg-sky-500/20' : 'hover:bg-zinc-800'
                  }`}
                  onClick={() => {
                    setSelected(r);
                    setPromotion(null);
                  }}
                >
                  {r.runId} · {r.emittedSpecs.length} draft(s) · {r.synthesiserIdentity}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {selected && (
        <section className="space-y-3">
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Stages
            </h3>
            <div className="flex flex-wrap gap-1">
              {selected.stages.map((s) => {
                const deg = degradedLabel(s.degraded);
                return (
                  <span
                    key={s.id}
                    className={`rounded px-2 py-0.5 text-xs ${stageBadgeClass(s.status)}`}
                    title={deg ? `degraded: ${deg}` : s.status}
                  >
                    {s.id}: {s.status}
                    {deg ? ' *' : ''}
                  </span>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Staged drafts ({selected.emittedSpecs.length})
            </h3>
            {selected.emittedSpecs.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No drafts emitted (empty or fully-degraded evidence).
              </p>
            ) : (
              <ul className="space-y-2">
                {selected.emittedSpecs.map((spec) => (
                  <li
                    key={spec.slug}
                    className="rounded border border-zinc-800 p-2"
                  >
                    <div className="mb-1 font-mono text-xs">{spec.slug}</div>
                    <div className="flex items-center gap-2">
                      <input
                        className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs"
                        placeholder="target slug, e.g. 042-my-feature"
                        value={targetSlugs[spec.slug] ?? ''}
                        onChange={(e) =>
                          setTargetSlugs((m) => ({ ...m, [spec.slug]: e.target.value }))
                        }
                        aria-label={`target slug for ${spec.slug}`}
                      />
                      <Button
                        variant="outline"
                        onClick={() => void promote(spec.slug)}
                        disabled={promoting !== null}
                      >
                        {promoting === spec.slug ? (
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="mr-1 h-4 w-4" />
                        )}
                        Promote
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {promotion && (
        <div className="flex items-start gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 p-2 text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-0.5">
            <div className="font-mono text-xs">Promoted → {promotion.promotedRelpath}</div>
            <div className="text-xs">
              compile: {promotion.compile.ok ? 'ok' : 'failed'} — {promotion.compile.detail}
            </div>
            <div className="text-xs">
              coupling: {promotion.coupling.ran ? (promotion.coupling.ok ? 'ok' : 'failed') : 'skipped'} —{' '}
              {promotion.coupling.detail}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
