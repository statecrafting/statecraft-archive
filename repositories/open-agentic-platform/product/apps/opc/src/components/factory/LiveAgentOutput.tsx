// Spec 076 — terminal-style live view of factory step output.
//
// Surfaces the per-step `factory:agent_output` event stream as a
// scroll-locked monospace terminal. Lines arrive while the `claude`
// subprocess is mid-flight (the executor pipes its `--output-format
// stream-json` NDJSON output into `StepEvent::AgentOutput` frames), so
// the panel feels like watching the run in a real shell rather than
// staring at an opaque "Processing" badge.

import React, { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentOutputLine } from './types';

export interface LiveAgentOutputProps {
  lines: AgentOutputLine[];
  /** Optional active step id to display alongside the title. */
  activeStepId?: string | null;
  /** When true, the panel sizes to fill its container. Default: fixed 200px
   *  (matches the legacy ScaffoldMonitor placement). */
  fill?: boolean;
  /** Optional title override. Defaults to "Live Agent Output". */
  title?: string;
}

export const LiveAgentOutput: React.FC<LiveAgentOutputProps> = ({
  lines,
  activeStepId,
  fill = false,
  title = 'Live Agent Output',
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines arrive.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <div className={cn('flex flex-col', fill ? 'h-full min-h-0' : 'space-y-1')}>
      <div className="flex items-center gap-1.5 px-1">
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {title}
        </p>
        {activeStepId && (
          <span className="font-mono text-[10px] text-muted-foreground truncate">
            · {activeStepId}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {lines.length} line{lines.length === 1 ? '' : 's'}
        </span>
      </div>
      <div
        className={cn(
          'rounded font-mono text-xs p-2 overflow-y-auto',
          'bg-zinc-950 border border-zinc-800',
          fill ? 'flex-1 min-h-0' : 'h-[200px]',
        )}
      >
        {lines.length === 0 ? (
          <span className="text-zinc-500">Waiting for agent output…</span>
        ) : (
          lines.map((entry, i) => {
            const time = entry.timestamp.slice(11, 19); // HH:MM:SS
            // Lines may carry embedded newlines from multi-block assistant
            // frames; preserve them by splitting and rendering one row per
            // physical line so word-wrap doesn't fold tool-name + args onto
            // a single visually-confusing row.
            const physicalLines = entry.line.split('\n');
            return (
              <React.Fragment key={i}>
                {physicalLines.map((pl, pli) => (
                  <div key={`${i}-${pli}`} className="flex gap-2 leading-5">
                    <span className="text-zinc-600 shrink-0 select-none w-[64px]">
                      {pli === 0 ? time : ''}
                    </span>
                    <span
                      className={cn(
                        'break-all whitespace-pre-wrap',
                        lineClass(pl),
                      )}
                    >
                      {pl}
                    </span>
                  </div>
                ))}
              </React.Fragment>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

/**
 * Tint lines based on a small set of leading markers emitted by the Rust
 * `format_stream_json_line` helper. Keeps the surface readable without
 * adding a real ANSI parser — the executor only emits a handful of
 * stylistic prefixes.
 */
function lineClass(line: string): string {
  if (line.startsWith('✗')) return 'text-red-400';
  if (line.startsWith('→ tool:')) return 'text-cyan-400';
  if (line.startsWith('[init]')) return 'text-zinc-400';
  if (line.startsWith('[thinking')) return 'text-zinc-500 italic';
  return 'text-green-400';
}

export default LiveAgentOutput;
