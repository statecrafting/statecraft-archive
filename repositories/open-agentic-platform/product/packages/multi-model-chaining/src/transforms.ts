import type { ChainPhase, OutputTransform, ChainMessage } from "./types.js";

/**
 * Apply the output transform for a phase (FR-002, FR-003, FR-004).
 * Returns the transformed string to be injected into the next phase.
 */
export function applyTransform(
  output: string,
  transform: OutputTransform,
  phaseIndex: number,
): string {
  if (typeof transform === "function") {
    return transform(output, phaseIndex);
  }

  switch (transform) {
    case "thinking_tags":
      return `<thinking>\n${output}\n</thinking>`;
    case "system_prompt":
      return output;
    case "raw":
      return output;
  }
}

/**
 * Build the message history for a given phase by injecting prior phase outputs.
 * - "thinking_tags": inject as assistant message prefix (FR-002, FR-003)
 * - "system_prompt": prepend to system prompt
 * - "raw": inject as assistant message
 * - TransformFn: inject as assistant message
 */
export function buildPhaseMessages(
  originalMessages: ChainMessage[],
  priorOutputs: Array<{ output: string; phase: ChainPhase }>,
  currentPhase: ChainPhase,
): { messages: ChainMessage[]; systemPrompt?: string } {
  const messages: ChainMessage[] = [...originalMessages];
  let systemPrompt = currentPhase.systemPrompt;

  for (const { output, phase } of priorOutputs) {
    const transformed = applyTransform(output, phase.outputTransform, phase.phaseIndex);

    if (phase.outputTransform === "system_prompt") {
      systemPrompt = systemPrompt
        ? `${transformed}\n\n${systemPrompt}`
        : transformed;
    } else {
      // thinking_tags, raw, and custom TransformFn inject as assistant message
      messages.push({ role: "assistant", content: transformed });
    }
  }

  return { messages, systemPrompt };
}
