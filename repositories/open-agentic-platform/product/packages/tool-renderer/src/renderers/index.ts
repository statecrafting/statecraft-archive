export { textRenderer } from "./text.js";
export { codeRenderer } from "./code.js";
export { diffRenderer, parseDiffLines } from "./diff.js";
export type { DiffLine } from "./diff.js";
export { imageRenderer } from "./image.js";
export { jsonRenderer, tryParseJson } from "./json.js";
export { markdownRenderer } from "./markdown.js";
export { errorRenderer } from "./error.js";

import type { ContentRenderer } from "../types.js";
import { textRenderer } from "./text.js";
import { codeRenderer } from "./code.js";
import { diffRenderer } from "./diff.js";
import { imageRenderer } from "./image.js";
import { jsonRenderer } from "./json.js";
import { markdownRenderer } from "./markdown.js";
import { errorRenderer } from "./error.js";

/** All built-in content renderers. */
export const builtinRenderers: ContentRenderer[] = [
  textRenderer,
  codeRenderer,
  diffRenderer,
  imageRenderer,
  jsonRenderer,
  markdownRenderer,
  errorRenderer,
];
