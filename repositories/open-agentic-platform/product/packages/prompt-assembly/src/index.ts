// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 070-prompt-assembly-cache

export type {
  CacheLifetime,
  PromptSection,
  AssemblyContext,
  AssembledPrompt,
  AssemblyMetadata,
  SectionMetadata,
  Message,
  CompactionResult,
  AssemblerOptions,
  CompactionOptions,
} from "./types.js";

export {
  PromptAssembler,
  CACHE_BOUNDARY_MARKER,
  truncateToBytes,
} from "./assembler.js";

export { CompactionService } from "./compaction.js";

export {
  createDefaultAssembler,
  preloadCodingStandards,
  DEFAULT_SECTIONS,
  identitySection,
  behavioralRulesSection,
  codingStandardsSection,
  toolRegistrySchemasSection,
  claudeMdSection,
  orchestratorRulesSection,
  baseHookDefsSection,
  workflowStateSection,
  sessionMemorySection,
  mcpServerContextSection,
  conversationSummarySection,
  activeHooksSummarySection,
  environmentContextSection,
} from "./defaults.js";
