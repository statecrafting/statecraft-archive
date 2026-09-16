import type { ToolDisplayConfig } from "../types.js";

export const bashConfig: ToolDisplayConfig = {
  toolId: "Bash",
  label: "Bash",
  icon: "terminal",
  accentColor: "#22c55e",
  inputDisplay: {
    fields: ["command"],
    format: "inline",
    syntaxHighlight: "bash",
  },
  resultDisplay: {
    contentRenderer: "code",
    maxCollapsedLines: 30,
    syntaxHighlight: "bash",
  },
  collapse: {
    defaultState: "expanded",
    collapseThreshold: 80,
  },
};

export const readConfig: ToolDisplayConfig = {
  toolId: "Read",
  label: "Read",
  icon: "file-text",
  accentColor: "#3b82f6",
  inputDisplay: {
    fields: ["file_path", "offset", "limit"],
    format: "inline",
  },
  resultDisplay: {
    contentRenderer: "code",
    maxCollapsedLines: 40,
  },
  collapse: {
    defaultState: "expanded",
    collapseThreshold: 100,
  },
};

export const editConfig: ToolDisplayConfig = {
  toolId: "Edit",
  label: "Edit",
  icon: "pencil",
  accentColor: "#f59e0b",
  inputDisplay: {
    fields: ["file_path"],
    format: "inline",
  },
  resultDisplay: {
    contentRenderer: "diff",
    maxCollapsedLines: 30,
  },
  collapse: {
    defaultState: "expanded",
    collapseThreshold: 60,
  },
};

export const writeConfig: ToolDisplayConfig = {
  toolId: "Write",
  label: "Write",
  icon: "file-plus",
  accentColor: "#8b5cf6",
  inputDisplay: {
    fields: ["file_path"],
    format: "inline",
  },
  resultDisplay: {
    contentRenderer: "code",
    maxCollapsedLines: 30,
  },
  collapse: {
    defaultState: "collapsed",
    collapseThreshold: 40,
  },
};

export const globConfig: ToolDisplayConfig = {
  toolId: "Glob",
  label: "Glob",
  icon: "search",
  accentColor: "#06b6d4",
  inputDisplay: {
    fields: ["pattern", "path"],
    format: "inline",
  },
  resultDisplay: {
    contentRenderer: "text",
    maxCollapsedLines: 30,
  },
  collapse: {
    defaultState: "expanded",
    collapseThreshold: 50,
  },
};

export const grepConfig: ToolDisplayConfig = {
  toolId: "Grep",
  label: "Grep",
  icon: "search-code",
  accentColor: "#ec4899",
  inputDisplay: {
    fields: ["pattern", "path", "glob"],
    format: "inline",
  },
  resultDisplay: {
    contentRenderer: "code",
    maxCollapsedLines: 30,
  },
  collapse: {
    defaultState: "expanded",
    collapseThreshold: 60,
  },
};

export const mcpConfig: ToolDisplayConfig = {
  toolId: "MCP",
  label: "MCP Tool",
  icon: "plug",
  accentColor: "#6366f1",
  inputDisplay: {
    fields: [],
    format: "block",
  },
  resultDisplay: {
    contentRenderer: "json",
    maxCollapsedLines: 20,
  },
  collapse: {
    defaultState: "expanded",
    collapseThreshold: 40,
  },
};

/** All default tool display configs for standard Claude Code tools. */
export const defaultToolConfigs: ToolDisplayConfig[] = [
  bashConfig,
  readConfig,
  editConfig,
  writeConfig,
  globConfig,
  grepConfig,
  mcpConfig,
];
