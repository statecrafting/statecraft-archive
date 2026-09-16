import type { ContentRenderer, ContentRendererProps } from "../types.js";
import { createElement } from "react";

export interface DiffLine {
  type: "added" | "removed" | "context" | "header";
  content: string;
}

export function parseDiffLines(content: string): DiffLine[] {
  return content.split("\n").map((line) => {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
      return { type: "header" as const, content: line };
    }
    if (line.startsWith("+")) {
      return { type: "added" as const, content: line };
    }
    if (line.startsWith("-")) {
      return { type: "removed" as const, content: line };
    }
    return { type: "context" as const, content: line };
  });
}

function DiffRenderer(props: ContentRendererProps) {
  const { content, maxCollapsedLines } = props;
  const allLines = parseDiffLines(content);
  const truncated = maxCollapsedLines && allLines.length > maxCollapsedLines;
  const lines = truncated ? allLines.slice(0, maxCollapsedLines) : allLines;

  return createElement("div", {
    className: "tool-renderer-diff",
    "data-truncated": truncated ? "true" : undefined,
    "data-total-lines": String(allLines.length),
  },
    lines.map((line, i) =>
      createElement("div", {
        key: i,
        className: `diff-line diff-line-${line.type}`,
        "data-diff-type": line.type,
      }, line.content),
    ),
  );
}

export const diffRenderer: ContentRenderer = {
  id: "diff",
  render: (props) => createElement(DiffRenderer, props),
};
