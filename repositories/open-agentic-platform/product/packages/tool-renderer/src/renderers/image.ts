import type { ContentRenderer, ContentRendererProps } from "../types.js";
import { createElement } from "react";

function ImageRenderer(props: ContentRendererProps) {
  const { content } = props;
  // content is expected to be a URL or base64 data URI
  const isDataUri = content.startsWith("data:");
  const isUrl = content.startsWith("http://") || content.startsWith("https://") || content.startsWith("/");

  if (!isDataUri && !isUrl) {
    return createElement("div", { className: "tool-renderer-image-error" },
      "Unable to render image: unsupported content format",
    );
  }

  return createElement("div", { className: "tool-renderer-image" },
    createElement("img", {
      src: content,
      alt: "Tool output",
      loading: "lazy",
      style: { maxWidth: "100%", maxHeight: "400px" },
    }),
  );
}

export const imageRenderer: ContentRenderer = {
  id: "image",
  render: (props) => createElement(ImageRenderer, props),
};
