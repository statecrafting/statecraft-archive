/**
 * Mention index — fuzzy search across files and agents (058 Phase 2).
 *
 * Implements the MentionIndex interface from types.ts.
 * Maintains an in-memory index of file candidates and agent candidates.
 */

import { basename } from "node:path";
import type {
  MentionIndex,
  MentionCandidate,
  FuzzyMatch,
  AgentInfo,
  FileCandidate,
  AgentCandidate,
} from "../types.js";
import { scoreFilePath, scoreAgent } from "./scoring.js";

const DEFAULT_LIMIT = 20;

export class MentionSearchIndex implements MentionIndex {
  private fileCandidates: FileCandidate[] = [];
  private agentCandidates: AgentCandidate[] = [];

  /**
   * Rebuild the entire index from scratch.
   */
  rebuild(files: string[], agents: AgentInfo[]): void {
    this.fileCandidates = files.map((relativePath) => ({
      type: "file" as const,
      relativePath,
      basename: basename(relativePath),
      icon: "📄",
    }));

    this.agentCandidates = agents.map((a) => ({
      type: "agent" as const,
      agentId: a.agentId,
      displayName: a.displayName,
      avatar: a.avatar,
    }));
  }

  /**
   * Add a single file to the index (for incremental updates).
   */
  addFile(relativePath: string): void {
    // Avoid duplicates
    if (this.fileCandidates.some((f) => f.relativePath === relativePath)) return;
    this.fileCandidates.push({
      type: "file",
      relativePath,
      basename: basename(relativePath),
      icon: "📄",
    });
  }

  /**
   * Remove a file from the index (for incremental updates).
   */
  removeFile(relativePath: string): void {
    this.fileCandidates = this.fileCandidates.filter(
      (f) => f.relativePath !== relativePath,
    );
  }

  /**
   * Search for candidates matching the query (FR-002).
   * Returns up to `limit` results sorted by score descending.
   */
  search(query: string, limit: number = DEFAULT_LIMIT): FuzzyMatch[] {
    if (query.length === 0) {
      // No query — return first N files then agents (recently-used ordering could go here)
      const results: FuzzyMatch[] = [];
      for (const c of this.fileCandidates.slice(0, limit)) {
        results.push({ candidate: c, score: 0, matchedRanges: [] });
      }
      const remaining = limit - results.length;
      if (remaining > 0) {
        for (const a of this.agentCandidates.slice(0, remaining)) {
          results.push({ candidate: a, score: 0, matchedRanges: [] });
        }
      }
      return results;
    }

    const matches: FuzzyMatch[] = [];

    // Score files
    for (const file of this.fileCandidates) {
      const result = scoreFilePath(query, file.relativePath);
      if (result) {
        matches.push({
          candidate: file,
          score: result.score,
          matchedRanges: result.matchedRanges,
        });
      }
    }

    // Score agents
    for (const agent of this.agentCandidates) {
      const result = scoreAgent(query, agent.displayName);
      if (result) {
        matches.push({
          candidate: agent,
          score: result.score,
          matchedRanges: result.matchedRanges,
        });
      }
    }

    // Sort by score descending, then alphabetically for ties
    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aText = a.candidate.type === "file" ? a.candidate.relativePath : a.candidate.displayName;
      const bText = b.candidate.type === "file" ? b.candidate.relativePath : b.candidate.displayName;
      return aText.localeCompare(bText);
    });

    return matches.slice(0, limit);
  }

  /** Number of indexed files. */
  get fileCount(): number {
    return this.fileCandidates.length;
  }

  /** Number of indexed agents. */
  get agentCount(): number {
    return this.agentCandidates.length;
  }
}
