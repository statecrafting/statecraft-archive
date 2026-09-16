// ── Proof Chain (spec 063, Phase 4) ──────────────────────────────────

import { createHash } from "node:crypto";
import type { ProofEventType, ProofRecord } from "./types.js";

/** Compute SHA-256 hex digest of a string. */
function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Compute the payload hash: SHA-256 of JSON.stringify(payload). */
export function computePayloadHash(payload: unknown): string {
  return sha256(JSON.stringify(payload));
}

/** Compute the record hash: SHA-256 of (sequence + timestamp + eventType + payloadHash + previousHash). */
export function computeRecordHash(
  sequence: number,
  timestamp: string,
  eventType: ProofEventType,
  payloadHash: string,
  previousHash: string,
): string {
  return sha256(`${sequence}${timestamp}${eventType}${payloadHash}${previousHash}`);
}

export interface ProofChainVerifyResult {
  valid: boolean;
  brokenAtSequence?: number;
}

export interface ProofChainOptions {
  /** Maximum chain length before compaction (R-002). 0 = unlimited. */
  maxLength?: number;
  /** Injectable clock for deterministic testing. */
  now?: () => string;
}

/**
 * Hash-chained proof trail for coherence scoring events (FR-009, FR-010).
 * Each record links to the previous via SHA-256, forming a tamper-evident log.
 */
export class ProofChain {
  private readonly chain: ProofRecord[] = [];
  private readonly maxLength: number;
  private readonly now: () => string;

  constructor(options?: ProofChainOptions) {
    this.maxLength = options?.maxLength ?? 0;
    this.now = options?.now ?? (() => new Date().toISOString());
  }

  /** Number of records in the chain. */
  get length(): number {
    return this.chain.length;
  }

  /** Append a new record to the proof chain. Returns the created record. */
  append(eventType: ProofEventType, payload: unknown): ProofRecord {
    const sequence = this.chain.length;
    const timestamp = this.now();
    const payloadHash = computePayloadHash(payload);
    const previousHash = sequence > 0 ? this.chain[sequence - 1].recordHash : "";
    const recordHash = computeRecordHash(sequence, timestamp, eventType, payloadHash, previousHash);

    const record: ProofRecord = {
      sequence,
      timestamp,
      eventType,
      payload,
      payloadHash,
      previousHash,
      recordHash,
    };

    this.chain.push(record);

    // Compaction: if maxLength is set and exceeded, compact oldest records
    if (this.maxLength > 0 && this.chain.length > this.maxLength) {
      this.compact();
    }

    return record;
  }

  /**
   * Verify the integrity of the entire chain (FR-010).
   * Returns { valid: true } if intact, or { valid: false, brokenAtSequence }
   * indicating the first tampered record.
   */
  verify(): ProofChainVerifyResult {
    for (let i = 0; i < this.chain.length; i++) {
      const record = this.chain[i];

      // Verify payload hash
      const expectedPayloadHash = computePayloadHash(record.payload);
      if (record.payloadHash !== expectedPayloadHash) {
        return { valid: false, brokenAtSequence: record.sequence };
      }

      // Verify previous hash linkage
      const expectedPrevious = i > 0 ? this.chain[i - 1].recordHash : "";
      if (record.previousHash !== expectedPrevious) {
        return { valid: false, brokenAtSequence: record.sequence };
      }

      // Verify record hash
      const expectedRecordHash = computeRecordHash(
        record.sequence,
        record.timestamp,
        record.eventType,
        record.payloadHash,
        record.previousHash,
      );
      if (record.recordHash !== expectedRecordHash) {
        return { valid: false, brokenAtSequence: record.sequence };
      }
    }

    return { valid: true };
  }

  /** Retrieve records by range (inclusive). */
  records(from?: number, to?: number): ProofRecord[] {
    const start = from ?? 0;
    const end = to ?? this.chain.length - 1;
    return this.chain.slice(start, end + 1);
  }

  /** Get a single record by sequence number. */
  get(sequence: number): ProofRecord | undefined {
    return this.chain.find((r) => r.sequence === sequence);
  }

  /** Compact the chain: keep only the most recent half, with a checkpoint record. */
  private compact(): void {
    const keepFrom = Math.floor(this.chain.length / 2);
    const removed = this.chain.splice(0, keepFrom);
    // Re-sequence remaining records
    for (let i = 0; i < this.chain.length; i++) {
      this.chain[i] = { ...this.chain[i], sequence: i };
    }
    // Fix linkage after compaction
    if (this.chain.length > 0) {
      this.chain[0] = { ...this.chain[0], previousHash: "" };
      this.chain[0] = {
        ...this.chain[0],
        recordHash: computeRecordHash(
          0,
          this.chain[0].timestamp,
          this.chain[0].eventType,
          this.chain[0].payloadHash,
          "",
        ),
      };
      for (let i = 1; i < this.chain.length; i++) {
        const prev = this.chain[i - 1];
        this.chain[i] = { ...this.chain[i], previousHash: prev.recordHash };
        this.chain[i] = {
          ...this.chain[i],
          recordHash: computeRecordHash(
            i,
            this.chain[i].timestamp,
            this.chain[i].eventType,
            this.chain[i].payloadHash,
            prev.recordHash,
          ),
        };
      }
    }
  }
}
