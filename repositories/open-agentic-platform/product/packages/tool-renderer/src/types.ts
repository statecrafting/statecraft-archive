import type { ReactNode } from "react";

// --- Core display config (FR-001) ---

export interface ToolDisplayConfig {
  toolId: string;
  label: string;
  icon: string;
  accentColor: string;
  inputDisplay: InputDisplayConfig;
  resultDisplay: ResultDisplayConfig;
  collapse: CollapseConfig;
}

export interface InputDisplayConfig {
  /** Fields to extract from input (e.g., ["command"], ["file_path"]) */
  fields: string[];
  /** Inline for short inputs, block for multi-line */
  format: "inline" | "block";
  /** Language hint for syntax highlighting */
  syntaxHighlight?: string;
}

export interface ResultDisplayConfig {
  /** Content renderer id (e.g., "code", "diff", "json") */
  contentRenderer: string;
  /** Lines shown before "show more" */
  maxCollapsedLines: number;
  /** Language hint for syntax highlighting */
  syntaxHighlight?: string;
}

export interface CollapseConfig {
  defaultState: "expanded" | "collapsed";
  /** Line count above which auto-collapse */
  collapseThreshold: number;
}

// --- Content renderers (FR-005) ---

export interface ContentRendererProps {
  content: string;
  syntaxHighlight?: string;
  maxCollapsedLines?: number;
}

export interface ContentRenderer {
  id: string;
  render(props: ContentRendererProps): ReactNode;
}

// --- Tool invocation data ---

export interface ToolInvocation {
  id: string;
  toolId: string;
  input: Record<string, unknown>;
  result?: ToolResult;
  startedAt: number;
  completedAt?: number;
}

export interface ToolResult {
  content: string;
  contentType?: string;
  isError?: boolean;
}

// --- Subagent container (FR-007) ---

export interface SubagentInfo {
  id: string;
  name: string;
  model?: string;
  toolInvocations: ToolInvocation[];
  startedAt: number;
  completedAt?: number;
}

// --- Thinking traces (FR-008) ---

export interface ThinkingTrace {
  id: string;
  text: string;
  startedAt: number;
  completedAt?: number;
}
