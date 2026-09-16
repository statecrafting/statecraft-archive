/**
 * Spec 202 FR-004 pure tests: the approval-velocity windowing + classification
 * and the env-knob readers. No Encore runtime, no DB; runs under bare vitest
 * (the DB half's integration coverage lives in `approvalVelocity.test.ts`,
 * gated to the encore lane).
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  approvalVelocityThreshold,
  approvalVelocityWindowSecs,
  computeApprovalVelocity,
} from "./approvalVelocity-pure";

const NOW = "2026-07-02T00:01:00.000Z";

/** ISO string `secsAgo` seconds before NOW (negative = after NOW). */
function ago(secsAgo: number): string {
  return new Date(Date.parse(NOW) - secsAgo * 1000).toISOString();
}

describe("computeApprovalVelocity (FR-004)", () => {
  it("flags anomalous when the in-window count reaches the threshold", () => {
    // 10 approvals inside a 60s window, threshold 10: the bulk-rubber-stamp
    // shape the counter exists to surface.
    const stamps = Array.from({ length: 10 }, (_, i) => ago(i * 5)); // 0..45s
    const v = computeApprovalVelocity(stamps, NOW, 60, 10);
    expect(v.count).toBe(10);
    expect(v.anomalous).toBe(true);
    expect(v.windowSecs).toBe(60);
    expect(v.threshold).toBe(10);
  });

  it("is not anomalous below the threshold", () => {
    const stamps = Array.from({ length: 9 }, (_, i) => ago(i * 5));
    const v = computeApprovalVelocity(stamps, NOW, 60, 10);
    expect(v.count).toBe(9);
    expect(v.anomalous).toBe(false);
  });

  it("treats count === threshold as anomalous (>= boundary)", () => {
    const stamps = [ago(1), ago(2), ago(3)];
    const v = computeApprovalVelocity(stamps, NOW, 60, 3);
    expect(v.count).toBe(3);
    expect(v.anomalous).toBe(true);
  });

  it("excludes approvals older than the window", () => {
    const stamps = [ago(10), ago(30), ago(61), ago(120)]; // last two out
    const v = computeApprovalVelocity(stamps, NOW, 60, 3);
    expect(v.count).toBe(2);
    expect(v.anomalous).toBe(false);
  });

  it("counts the window-start boundary but excludes future timestamps", () => {
    const stamps = [ago(60), ago(0), ago(-5)]; // start(in), now(in), future(out)
    const v = computeApprovalVelocity(stamps, NOW, 60, 2);
    expect(v.count).toBe(2);
    expect(v.anomalous).toBe(true);
  });

  it("skips unparseable timestamps", () => {
    const stamps = [ago(5), "not-a-date", "", ago(10)];
    const v = computeApprovalVelocity(stamps, NOW, 60, 5);
    expect(v.count).toBe(2);
    expect(v.anomalous).toBe(false);
  });

  it("returns count 0 for an empty set", () => {
    const v = computeApprovalVelocity([], NOW, 60, 1);
    expect(v.count).toBe(0);
    expect(v.anomalous).toBe(false);
  });
});

describe("approval-velocity env knobs", () => {
  const savedWindow = process.env.statecraft_FACTORY_APPROVAL_VELOCITY_WINDOW_SEC;
  const savedThreshold =
    process.env.statecraft_FACTORY_APPROVAL_VELOCITY_THRESHOLD;

  afterEach(() => {
    restore("STATECRAFT_FACTORY_APPROVAL_VELOCITY_WINDOW_SEC", savedWindow);
    restore("STATECRAFT_FACTORY_APPROVAL_VELOCITY_THRESHOLD", savedThreshold);
  });

  function restore(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  it("defaults to 60s / 10 approvals when unset", () => {
    delete process.env.statecraft_FACTORY_APPROVAL_VELOCITY_WINDOW_SEC;
    delete process.env.statecraft_FACTORY_APPROVAL_VELOCITY_THRESHOLD;
    expect(approvalVelocityWindowSecs()).toBe(60);
    expect(approvalVelocityThreshold()).toBe(10);
  });

  it("honours a valid positive override", () => {
    process.env.statecraft_FACTORY_APPROVAL_VELOCITY_WINDOW_SEC = "120";
    process.env.statecraft_FACTORY_APPROVAL_VELOCITY_THRESHOLD = "5";
    expect(approvalVelocityWindowSecs()).toBe(120);
    expect(approvalVelocityThreshold()).toBe(5);
  });

  it("falls back on a non-positive or non-numeric override", () => {
    process.env.statecraft_FACTORY_APPROVAL_VELOCITY_WINDOW_SEC = "0";
    process.env.statecraft_FACTORY_APPROVAL_VELOCITY_THRESHOLD = "nope";
    expect(approvalVelocityWindowSecs()).toBe(60);
    expect(approvalVelocityThreshold()).toBe(10);
  });
});
