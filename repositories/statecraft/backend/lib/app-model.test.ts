/**
 * The model tells the truth (spec 012 §4, acceptance 4). The platform has no
 * kernel oracle yet, so these tests pin the agreements the chassis would
 * enforce at boot: the committed model is self-consistent and refuses
 * mutation, the operator role it records is the one the tenants service
 * actually gates on, the gate hash it seals is the one the running gate
 * reports, and the service roster matches the backend tree.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { OPERATOR_ROLE } from "../tenants/access/authz";
import { GATE_CONFIG_JSON } from "../governance/config";
import native from "../governance/native";

import { computeIntegrityHash, modelJson, receipt } from "./app-model";
import { operatorRole } from "./roles";

const model = JSON.parse(modelJson) as {
  app: { name: string };
  auth: { operatorRole: string };
  gate: { configHash: string };
  observability: { metricsPath: string; otel: boolean };
  services: { name: string }[];
  integrity: { hash: string };
};

describe("the committed app model (spec 012)", () => {
  it("loads with a verified integrity hash and the platform identity", () => {
    expect(receipt.modelHash).toBe(model.integrity.hash);
    expect(receipt.app).toBe("statecraft");
    expect(receipt.services).toBe(model.services.length);
  });

  it("refuses a mutated model", () => {
    const mutated = JSON.parse(modelJson) as Record<string, unknown> & {
      observability: { otel: boolean };
    };
    mutated.observability.otel = !mutated.observability.otel;
    expect(computeIntegrityHash(mutated)).not.toBe(model.integrity.hash);
  });

  it("records the operator role the tenants service gates on", () => {
    expect(model.auth.operatorRole).toBe(OPERATOR_ROLE);
    expect(operatorRole()).toBe(OPERATOR_ROLE);
  });

  it("seals the gate hash the running governance gate reports", () => {
    const decision = native.gateEvaluate(
      GATE_CONFIG_JSON,
      JSON.stringify({
        action: "model-truth-test",
        payload_summary: "",
        payload_body: null,
        attributes: {},
      }),
    );
    expect(model.gate.configHash).toBe(decision.configHash);
    expect(receipt.gateConfigHash).toBe(decision.configHash);
  });

  it("records the observability posture the wiring provides", () => {
    expect(model.observability.metricsPath).toBe("/metrics");
    expect(model.observability.otel).toBe(true);
  });

  it("lists exactly the services the backend tree defines", () => {
    const backendDir = join(process.cwd(), "backend");
    const onDisk = readdirSync(backendDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => {
        try {
          readFileSync(join(backendDir, name, "encore.service.ts"));
          return true;
        } catch {
          return false;
        }
      })
      .sort();
    expect(model.services.map((svc) => svc.name)).toEqual(onDisk);
  });
});
