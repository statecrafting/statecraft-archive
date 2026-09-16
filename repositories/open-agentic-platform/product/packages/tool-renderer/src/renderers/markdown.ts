import type { ContentRenderer, ContentRendererProps } from "../types.js";
import { createElement } from "react";

function MarkdownRenderer(props: ContentRendererProps) {
  const { content } = props;
  // Renders markdown as a container. Actual markdown-to-HTML transformation
  // is expected to be handled by the host application's markdown pipeline.
  // This renderer provides the structural wrapper.
  return createElement("div", {
    className: "tool-renderer-markdown",
    "data-content-type": "markdown",
  }, content);
}

export const markdownRenderer: ContentRenderer = {
  id: "markdown",
  render: (props) => createElement(MarkdownRenderer, props),
};
