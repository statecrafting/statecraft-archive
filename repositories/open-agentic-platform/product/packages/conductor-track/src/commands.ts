/**
 * CLI command implementations for track management.
 *
 * FR-008: track list — shows all tracks with state, creation date, last activity.
 * FR-009: track inspect — shows full metadata including plan progress and checkpoints.
 * Plus: track archive and track revert commands.
 */

import type { TrackMetadata, TddPhase } from "./types.js";
import { TDD_PHASES } from "./types.js";
import { readMetadata, listTracks } from "./storage.js";
import { getPlanProgress } from "./plan-implementer.js";

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    pending: "PENDING",
    in_progress: "IN PROGRESS",
    complete: "COMPLETE",
    archived: "ARCHIVED",
    reverted: "REVERTED",
  };
  return labels[state] ?? state.toUpperCase();
}

function shortDate(iso: string): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

// ---------------------------------------------------------------------------
// track list (FR-008)
// ---------------------------------------------------------------------------

export interface TrackListEntry {
  id: string;
  title: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  progress: string;
}

export async function trackList(
  tracksRoot: string,
): Promise<TrackListEntry[]> {
  const tracks = await listTracks(tracksRoot);
  return tracks.map((t) => {
    const prog = getPlanProgress(t);
    const progressStr =
      prog.total > 0
        ? `${prog.completed + prog.skipped}/${prog.total} (${prog.percentComplete}%)`
        : "—";

    return {
      id: t.id,
      title: t.title,
      state: stateLabel(t.state),
      createdAt: shortDate(t.createdAt),
      updatedAt: shortDate(t.updatedAt),
      progress: progressStr,
    };
  });
}

/**
 * Format track list as a text table (FR-008).
 */
export function formatTrackList(entries: TrackListEntry[]): string {
  if (entries.length === 0) return "No tracks found.";

  const header = "ID | Title | State | Created | Updated | Progress";
  const sep = "---|-------|-------|---------|---------|--------";
  const rows = entries.map(
    (e) =>
      `${e.id} | ${e.title} | ${e.state} | ${e.createdAt} | ${e.updatedAt} | ${e.progress}`,
  );

  return [header, sep, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// track inspect (FR-009)
// ---------------------------------------------------------------------------

export interface TrackInspection {
  metadata: TrackMetadata;
  progress: ReturnType<typeof getPlanProgress>;
  tddSummary: Record<TddPhase, string>;
}

export async function trackInspect(
  tracksRoot: string,
  trackId: string,
): Promise<TrackInspection> {
  const metadata = await readMetadata(tracksRoot, trackId);
  const progress = getPlanProgress(metadata);

  const tddSummary: Record<TddPhase, string> = {} as Record<TddPhase, string>;
  for (const phase of TDD_PHASES) {
    const cp = metadata.tdd[phase];
    if (cp) {
      const results = cp.testResults
        ? ` (${cp.testResults.passed}P/${cp.testResults.failed}F/${cp.testResults.skipped}S)`
        : "";
      tddSummary[phase] = `PASSED @ ${cp.commitSha.slice(0, 7)}${results}`;
    } else {
      tddSummary[phase] = "NOT PASSED";
    }
  }

  return { metadata, progress, tddSummary };
}

/**
 * Format track inspection as text (FR-009).
 */
export function formatTrackInspection(inspection: TrackInspection): string {
  const { metadata: m, progress: p, tddSummary } = inspection;
  const lines: string[] = [
    `# Track: ${m.id}`,
    `Title: ${m.title}`,
    `State: ${stateLabel(m.state)}`,
    `Created: ${m.createdAt}`,
    `Updated: ${m.updatedAt}`,
    "",
    "## Git",
    `Branch: ${m.git.branch}`,
    `Start commit: ${m.git.startCommit}`,
    m.git.endCommit ? `End commit: ${m.git.endCommit}` : "End commit: —",
    "",
    "## Plan Progress",
    `Steps: ${p.completed + p.skipped}/${p.total} complete (${p.percentComplete}%)`,
    `In progress: ${p.inProgress} | Pending: ${p.pending} | Skipped: ${p.skipped}`,
  ];

  if (m.plan.steps.length > 0) {
    lines.push("");
    for (const step of m.plan.steps) {
      const icon =
        step.status === "done"
          ? "[x]"
          : step.status === "in_progress"
            ? "[>]"
            : step.status === "skipped"
              ? "[-]"
              : "[ ]";
      lines.push(`  ${icon} ${step.index}. ${step.description}`);
    }
  }

  lines.push("", "## TDD Phases");
  for (const phase of TDD_PHASES) {
    lines.push(`  ${phase}: ${tddSummary[phase]}`);
  }

  return lines.join("\n");
}
