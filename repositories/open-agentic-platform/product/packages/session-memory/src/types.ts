/**
 * Session Memory types — FR-002 memory entry schema.
 */

/** The kind of knowledge captured in a memory entry. */
export type MemoryKind = "decision" | "correction" | "pattern" | "note" | "preference";

/** Importance tiers with ascending durability. */
export type ImportanceLevel = "ephemeral" | "short-term" | "medium-term" | "long-term" | "permanent";

/**
 * Who authored a memory write (FR-002 provenance). `harvester` is the
 * post-turn harvesting engine; `agent` is a model turn; `human` is an explicit
 * human action. Anything that is not `human` produces machine-harvested trust.
 */
export type ActorKind = "human" | "agent" | "harvester";

/**
 * Trust class governing retention and promotion (FR-003). `machine-harvested`
 * is the default for anything an agent or the harvester wrote; `human-curated`
 * is written or edited by a human; `verified` is explicitly human-verified.
 * Promotion to long-term or permanent retention requires human-curated or
 * verified (enforced in a later slice).
 */
export type TrustClass = "machine-harvested" | "human-curated" | "verified";

/** A single persisted memory entry (FR-002). */
export interface MemoryEntry {
  id: string;
  content: string;
  kind: MemoryKind;
  importance: ImportanceLevel;
  expiresAt: number | null;
  projectScope: string;
  tags: string[];
  /** Origin session id (FR-002): the session whose write created this entry. */
  sourceSessionId: string;
  accessCount: number;
  createdAt: number;
  updatedAt: number;
  // --- Provenance + trust (spec 204 FR-002 / FR-003) ---
  /** Actor kind that authored this revision. */
  actorKind: ActorKind;
  /** Source attribution when harvested from an external input; else null. */
  sourceAttribution: string | null;
  /** SHA-256 hex of `content` at write time (FR-002). */
  contentHash: string;
  /** Trust class governing retention/promotion (FR-003). */
  trustClass: TrustClass;
  /** FR-006: quarantined entries are excluded from all reads pending review. */
  quarantined: boolean;
}

/** Input for creating a new memory entry via memory_store. */
export interface StoreMemoryInput {
  content: string;
  kind: MemoryKind;
  importance?: ImportanceLevel;
  tags?: string[];
  projectScope?: string;
  sourceSessionId?: string;
  /**
   * Actor kind for provenance (FR-002). Defaults to `agent`. The trust class
   * is DERIVED from this, not accepted directly: only a `human` actor yields
   * `human-curated`; `agent`/`harvester` always yield `machine-harvested`
   * (FR-005 no-self-ingestion). `verified` is reachable only through an
   * explicit human verify action, never a store input.
   */
  actorKind?: ActorKind;
  /** Source attribution when the content was harvested from an external input. */
  sourceAttribution?: string;
}

/** Filters for querying memories (FR-005). */
export interface QueryMemoryInput {
  text?: string;
  tags?: string[];
  kind?: MemoryKind;
  importance?: ImportanceLevel;
  projectScope: string;
  limit?: number;
}

/** Input for listing memories with pagination. */
export interface ListMemoryInput {
  projectScope: string;
  kind?: MemoryKind;
  limit?: number;
  offset?: number;
}

/** Default expiry durations in seconds for each importance level. */
export const EXPIRY_DEFAULTS: Record<ImportanceLevel, number | null> = {
  ephemeral: 0,            // expires at session end (caller sets actual timestamp)
  "short-term": 86_400,    // 24 hours
  "medium-term": 604_800,  // 7 days
  "long-term": 7_776_000,  // 90 days
  permanent: null,          // never expires
};

/** Importance promotion order — index determines rank. */
export const IMPORTANCE_ORDER: ImportanceLevel[] = [
  "ephemeral",
  "short-term",
  "medium-term",
  "long-term",
  "permanent",
];

/** Number of accesses required to trigger promotion (FR-007 / SC-005). */
export const PROMOTION_ACCESS_THRESHOLD = 3;

/**
 * Importance tiers whose retention requires human trust (spec 204 FR-003
 * AC-3). A machine-harvested entry can never occupy these: not by promotion,
 * and not by a direct write (the store path clamps it to medium-term).
 */
export const HUMAN_GATED_TIERS: ReadonlySet<ImportanceLevel> = new Set([
  "long-term",
  "permanent",
]);

/** The highest importance a machine-harvested entry may hold (the tier just
 * below the human-gated boundary). */
export const MACHINE_HARVESTED_CEILING: ImportanceLevel = "medium-term";

/** True if reaching `level` requires human-curated or verified trust. */
export function requiresHumanTrust(level: ImportanceLevel): boolean {
  return HUMAN_GATED_TIERS.has(level);
}

/** True for a trust class a human established: human-curated or verified. */
export function isHumanTrusted(trustClass: TrustClass): boolean {
  return trustClass === "human-curated" || trustClass === "verified";
}
