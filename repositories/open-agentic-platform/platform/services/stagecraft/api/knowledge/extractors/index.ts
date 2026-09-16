// Spec 115 — extractor registry assembly.
//
// Importing this module registers every deterministic extractor (and, in
// Phase 2, every policy-gated agent extractor) into the dispatcher in
// cost-ascending order. The worker imports this once at startup so the
// registry is populated before any message can arrive.

import { registerExtractor } from "./dispatch";
import { deterministicTextExtractor } from "./deterministic-text";
import { deterministicPdfEmbeddedExtractor } from "./deterministic-pdf-embedded";
import { deterministicDocxExtractor } from "./deterministic-docx";
import { agentPdfVisionExtractor } from "./agent-pdf-vision";
import { agentImageVisionExtractor } from "./agent-image-vision";

let registered = false;

export function registerExtractors(): void {
  if (registered) return;
  // Register cheapest → most expensive. Order matters: the dispatcher
  // returns the first match.
  // 1. Deterministic always-on extractors (no policy gate, no agent).
  registerExtractor(deterministicTextExtractor);
  registerExtractor(deterministicPdfEmbeddedExtractor);
  registerExtractor(deterministicDocxExtractor);
  // 2. Agent extractors. Their `canHandle` predicate self-gates on
  //    `policy.visionAllowed` / `policy.audioAllowed`, so when the
  //    workspace policy is the deterministic-only fallback they never
  //    match. Audio is intentionally not registered yet (T046 marked
  //    unimplemented because Anthropic does not expose a transcription
  //    endpoint at this writing).
  registerExtractor(agentPdfVisionExtractor);
  registerExtractor(agentImageVisionExtractor);
  registered = true;
}

// Side-effect registration on first import — the worker module imports
// this file once, which is enough to populate the registry for all
// subsequent dispatches in the process.
registerExtractors();
