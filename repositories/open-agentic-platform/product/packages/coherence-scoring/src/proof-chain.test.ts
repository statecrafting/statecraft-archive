import { describe, it, expect } from "vitest";
import { ProofChain, computePayloadHash, computeRecordHash } from "./proof-chain.js";

describe("computePayloadHash", () => {
  it("produces consistent SHA-256 hex", () => {
    const hash1 = computePayloadHash({ foo: "bar" });
    const hash2 = computePayloadHash({ foo: "bar" });
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("different payloads produce different hashes", () => {
    expect(computePayloadHash("a")).not.toBe(computePayloadHash("b"));
  });
});

describe("computeRecordHash", () => {
  it("produces consistent SHA-256 hex", () => {
    const hash = computeRecordHash(0, "2026-01-01T00:00:00Z", "score_computed", "abc", "");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("ProofChain", () => {
  let seq = 0;
  const clock = () => `2026-01-01T00:00:${String(seq++).padStart(2, "0")}.000Z`;

  it("starts empty", () => {
    const chain = new ProofChain();
    expect(chain.length).toBe(0);
  });

  it("appends records with correct sequence", () => {
    const chain = new ProofChain({ now: clock });
    const r0 = chain.append("action_recorded", { outcome: "clean" });
    const r1 = chain.append("score_computed", { score: 1.0 });

    expect(r0.sequence).toBe(0);
    expect(r1.sequence).toBe(1);
    expect(chain.length).toBe(2);
  });

  it("first record has empty previousHash", () => {
    const chain = new ProofChain({ now: clock });
    const r0 = chain.append("action_recorded", { outcome: "clean" });
    expect(r0.previousHash).toBe("");
  });

  it("subsequent records link to previous recordHash", () => {
    const chain = new ProofChain({ now: clock });
    const r0 = chain.append("action_recorded", { x: 1 });
    const r1 = chain.append("score_computed", { x: 2 });
    expect(r1.previousHash).toBe(r0.recordHash);
  });

  it("verifies a valid chain", () => {
    const chain = new ProofChain({ now: clock });
    for (let i = 0; i < 10; i++) {
      chain.append("action_recorded", { i });
    }
    expect(chain.verify()).toEqual({ valid: true });
  });

  it("SC-004: detects payload tampering", () => {
    const chain = new ProofChain({ now: clock });
    for (let i = 0; i < 5; i++) {
      chain.append("action_recorded", { i });
    }

    // Tamper with record at sequence 2
    const records = chain.records();
    (records[2] as any).payload = { i: 999 };

    expect(chain.verify()).toEqual({ valid: false, brokenAtSequence: 2 });
  });

  it("SC-004: 100 records verify, tampering detected at exact position", () => {
    const chain = new ProofChain({ now: clock });
    for (let i = 0; i < 100; i++) {
      chain.append("action_recorded", { i });
    }
    expect(chain.verify().valid).toBe(true);

    // Tamper with record 50
    const records = chain.records();
    (records[50] as any).payload = { tampered: true };
    const result = chain.verify();
    expect(result.valid).toBe(false);
    expect(result.brokenAtSequence).toBe(50);
  });

  it("records() returns range", () => {
    const chain = new ProofChain({ now: clock });
    for (let i = 0; i < 5; i++) chain.append("action_recorded", { i });

    const slice = chain.records(1, 3);
    expect(slice.length).toBe(3);
    expect(slice[0].sequence).toBe(1);
    expect(slice[2].sequence).toBe(3);
  });

  it("get() returns single record", () => {
    const chain = new ProofChain({ now: clock });
    chain.append("action_recorded", { x: 1 });
    chain.append("score_computed", { x: 2 });

    expect(chain.get(0)?.eventType).toBe("action_recorded");
    expect(chain.get(1)?.eventType).toBe("score_computed");
    expect(chain.get(99)).toBeUndefined();
  });

  it("compaction triggers when maxLength exceeded", () => {
    const chain = new ProofChain({ maxLength: 10, now: clock });
    for (let i = 0; i < 15; i++) {
      chain.append("action_recorded", { i });
    }
    // After compaction, length should be less than 15
    expect(chain.length).toBeLessThan(15);
    // Chain should still verify
    expect(chain.verify().valid).toBe(true);
  });
});
