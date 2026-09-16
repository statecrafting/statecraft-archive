import type { ContentRenderer, ContentRendererProps } from "../types.js";
import { createElement } from "react";

export function tryParseJson(content: string): unknown | undefined {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function JsonRenderer(props: ContentRendererProps) {
  const { content, maxCollapsedLines } = props;
  const parsed = tryParseJson(content);

  if (parsed === undefined) {
    // Fall back to plain text for invalid JSON
    return createElement("pre", {
      className: "tool-renderer-json tool-renderer-json-invalid",
    }, content);
  }

  const formatted = JSON.stringify(parsed, null, 2);
  const lines = formatted.split("\n");
  const truncated = maxCollapsedLines && lines.length > maxCollapsedLines;
  const displayContent = truncated
    ? lines.slice(0, maxCollapsedLines).join("\n")
    : formatted;

  return createElement("pre", {
    className: "tool-renderer-json",
    "data-truncated": truncated ? "true" : undefined,
    "data-total-lines": String(lines.length),
  },
    createElement("code", { className: "language-json" }, displayContent),
  );
}

export const jsonRenderer: ContentRenderer = {
  id: "json",
  render: (props) => createElement(JsonRenderer, props),
};
