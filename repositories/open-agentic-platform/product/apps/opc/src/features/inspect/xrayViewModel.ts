/**
 * Pure mapper: unknown xray JSON payload → typed XrayViewModel.
 * Handles both camelCase (Rust serde default) and snake_case field names defensively.
 */

import type { XrayViewModel, XrayFileNode, CallGraphSummary, DependencyInventory, Fingerprint } from './types';

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

function pick<T>(record: Record<string, unknown>, camel: string, snake: string): T | undefined {
  return (record[camel] ?? record[snake]) as T | undefined;
}

function parseFileNode(raw: unknown): XrayFileNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    path: str(r.path) ?? '',
    size: num(r.size) ?? 0,
    hash: str(r.hash) ?? '',
    lang: str(r.lang) ?? 'Unknown',
    loc: num(r.loc) ?? 0,
    complexity: num(r.complexity) ?? 0,
    functions: num(r.functions),
    maxDepth: num(pick(r, 'maxDepth', 'max_depth')),
  };
}

function parseCallGraphSummary(raw: unknown): CallGraphSummary | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  return {
    totalFunctions: num(pick(r, 'totalFunctions', 'total_functions')) ?? 0,
    totalEdges: num(pick(r, 'totalEdges', 'total_edges')) ?? 0,
    entryPoints: Array.isArray(pick(r, 'entryPoints', 'entry_points'))
      ? (pick(r, 'entryPoints', 'entry_points') as string[])
      : [],
  };
}

function parseDependencies(raw: unknown): DependencyInventory | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const ecosystems = r.ecosystems;
  if (!ecosystems || typeof ecosystems !== 'object') return undefined;
  return {
    ecosystems: ecosystems as Record<string, Array<{ name: string; version?: string; devOnly: boolean; sourceFile: string }>>,
    totalDirect: num(pick(r, 'totalDirect', 'total_direct')) ?? 0,
    totalDev: num(pick(r, 'totalDev', 'total_dev')) ?? 0,
  };
}

function parseFingerprint(raw: unknown): Fingerprint | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const classification = str(r.classification);
  if (!classification) return undefined;
  return {
    hash: str(r.hash) ?? '',
    classification,
    primaryLanguage: str(pick(r, 'primaryLanguage', 'primary_language')) ?? '',
    sizeBucket: str(pick(r, 'sizeBucket', 'size_bucket')) ?? '',
    ecosystemCount: num(pick(r, 'ecosystemCount', 'ecosystem_count')) ?? 0,
  };
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

export function toXrayViewModel(payload: unknown): XrayViewModel | null {
  if (!payload || typeof payload !== 'object') return null;
  const r = payload as Record<string, unknown>;

  const stats = asRecord(r.stats);
  const rawFiles = Array.isArray(r.files) ? r.files : [];
  const files = rawFiles.map(parseFileNode).filter((f): f is XrayFileNode => f !== null);

  return {
    schemaVersion: str(pick(r, 'schemaVersion', 'schema_version')) ?? '',
    digest: str(r.digest) ?? '',
    root: str(r.root) ?? '',
    target: str(r.target) ?? '',
    fileCount:
      num(stats?.fileCount) ?? num(stats?.file_count) ?? files.length,
    totalSize:
      num(stats?.totalSize) ?? num(stats?.total_size) ?? 0,
    files,
    languages: (asRecord(r.languages) ?? {}) as Record<string, number>,
    topDirs: (asRecord(pick(r, 'topDirs', 'top_dirs')) ?? {}) as Record<string, number>,
    moduleFiles: Array.isArray(pick(r, 'moduleFiles', 'module_files'))
      ? (pick(r, 'moduleFiles', 'module_files') as string[])
      : [],
    prevDigest: str(pick(r, 'prevDigest', 'prev_digest')),
    changedFiles: Array.isArray(pick(r, 'changedFiles', 'changed_files'))
      ? (pick(r, 'changedFiles', 'changed_files') as string[])
      : undefined,
    callGraphSummary: parseCallGraphSummary(pick(r, 'callGraphSummary', 'call_graph_summary')),
    dependencies: parseDependencies(r.dependencies),
    fingerprint: parseFingerprint(r.fingerprint),
  };
}
