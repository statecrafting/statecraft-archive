/**
 * Feature 032 — T003: typed inspect shell flow (xray scan path).
 * Types mirror the Rust XrayIndex schema v1.2.0 (crates/xray/src/schema.rs).
 */

/** Normalized outcome of an `xray_scan_project` invoke + payload classification. */
export type InspectFlowState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; payload: unknown }
  | { status: 'error'; message: string }
  | { status: 'degraded'; payload: unknown; reason: string };

// ── v1.2.0 schema types ──────────────────────────────────────────────

export interface XrayFileNode {
  path: string;
  size: number;
  hash: string;
  lang: string;
  loc: number;
  complexity: number;
  functions?: number;
  maxDepth?: number;
}

export interface CallGraphSummary {
  totalFunctions: number;
  totalEdges: number;
  entryPoints: string[];
}

export interface Dependency {
  name: string;
  version?: string;
  devOnly: boolean;
  sourceFile: string;
}

export interface DependencyInventory {
  ecosystems: Record<string, Dependency[]>;
  totalDirect: number;
  totalDev: number;
}

export interface Fingerprint {
  hash: string;
  classification: string;
  primaryLanguage: string;
  sizeBucket: string;
  ecosystemCount: number;
}

export interface XrayViewModel {
  schemaVersion: string;
  digest: string;
  root: string;
  target: string;
  fileCount: number;
  totalSize: number;
  files: XrayFileNode[];
  languages: Record<string, number>;
  topDirs: Record<string, number>;
  moduleFiles: string[];
  prevDigest?: string;
  changedFiles?: string[];
  callGraphSummary?: CallGraphSummary;
  dependencies?: DependencyInventory;
  fingerprint?: Fingerprint;
}
