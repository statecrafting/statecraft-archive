import { createElement } from "react";

export interface ElapsedTimeProps {
  startedAt: number;
  completedAt?: number;
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(0);
  return `${minutes}m ${remainingSeconds}s`;
}

export function ElapsedTime({ startedAt, completedAt }: ElapsedTimeProps) {
  const elapsed = (completedAt ?? Date.now()) - startedAt;
  const isRunning = completedAt === undefined;

  return createElement("span", {
    className: "tool-renderer-elapsed-time",
    "data-running": isRunning ? "true" : undefined,
  }, formatElapsed(elapsed));
}
