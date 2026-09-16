import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ContractError,
  assertSupportedContract,
  hasScaffoldVerb,
  isSupportedContract,
  readContract,
  supportsCert,
  validateSlots,
} from "./contract";

const FIXTURE = readFileSync(
  join(process.cwd(), "backend/factory/fixtures/template.v0_5_0.toml"),
  "utf8",
);

const FIXTURE_0_6 = readFileSync(
  join(process.cwd(), "backend/factory/fixtures/template.v0_6_0.toml"),
  "utf8",
);

describe("readContract (real pinned template, contract 0.5.0)", () => {
  const c = readContract(FIXTURE);

  it("parses the contract + template identity", () => {
    expect(c.contractVersion).toBe("0.5.0");
    expect(c.templateName).toBe("enrahitu");
    expect(c.templateVersion).toBe("0.1.0");
  });

  it("parses slots including the nested allowed array inside an inline table", () => {
    expect(c.slots.app_name?.required).toBe(true);
    expect(c.slots.app_name?.pattern).toBe("^[a-z][a-z0-9-]*$");
    expect(c.slots.org?.required).toBe(true);
    expect(c.slots.frontend?.default).toBe("vue");
    expect(c.slots.frontend?.allowed).toEqual(["vue", "react-rr7"]);
  });

  it("parses verbs and provenance", () => {
    expect(c.verbs.scaffold).toContain("stamp.mjs");
    expect(c.verbs.verify).toContain("typecheck");
    expect(c.provenance).not.toBeNull();
    expect(c.provenance?.postures).toEqual(["none", "assisted", "autonomous"]);
  });

  it("declares a usable scaffold verb and cert support", () => {
    expect(hasScaffoldVerb(c)).toBe(true);
    expect(supportsCert(c)).toBe(true);
  });
});

describe("readContract (real pinned template, contract 0.6.0 with the admin slot)", () => {
  const c = readContract(FIXTURE_0_6);

  it("accepts the 0.6.0 contract within the major-0 range (spec 012)", () => {
    expect(c.contractVersion).toBe("0.6.0");
    expect(isSupportedContract(c.contractVersion)).toBe(true);
    expect(() => assertSupportedContract(c)).not.toThrow();
  });

  it("parses the admin slot the reader predates (enrahitu spec 023 §4.1 tolerance)", () => {
    expect(c.slots.admin?.default).toBe("on");
    expect(c.slots.admin?.allowed).toEqual(["on", "off"]);
  });

  it("stamps with the existing slot API unchanged (admin rides its default)", () => {
    expect(validateSlots(c, { appName: "smoke-app", org: "acme" })).toEqual({
      appName: "smoke-app",
      org: "acme",
      frontend: "vue",
    });
    expect(hasScaffoldVerb(c)).toBe(true);
    expect(supportsCert(c)).toBe(true);
  });
});

describe("contract version range (spec 005 §4)", () => {
  const snippet = (v: string) => `[contract]\nversion = "${v}"\n`;

  it("accepts 0.1.0 / 0.2.0 / 0.3.0", () => {
    for (const v of ["0.1.0", "0.2.0", "0.3.0"]) {
      expect(isSupportedContract(v)).toBe(true);
      expect(() => assertSupportedContract(readContract(snippet(v)))).not.toThrow();
    }
  });

  it("rejects 1.0.0", () => {
    expect(isSupportedContract("1.0.0")).toBe(false);
    expect(() => assertSupportedContract(readContract(snippet("1.0.0")))).toThrow(ContractError);
  });

  it("rejects below 0.1.0", () => {
    expect(isSupportedContract("0.0.9")).toBe(false);
  });
});

describe("validateSlots", () => {
  const c = readContract(FIXTURE);

  it("accepts a valid request and defaults the frontend", () => {
    expect(validateSlots(c, { appName: "smoke-app", org: "acme" })).toEqual({
      appName: "smoke-app",
      org: "acme",
      frontend: "vue",
    });
  });

  it("honors an explicit allowed frontend", () => {
    expect(validateSlots(c, { appName: "smoke-app", org: "acme", frontend: "react-rr7" }).frontend).toBe(
      "react-rr7",
    );
  });

  it("rejects an app name that violates the pattern", () => {
    expect(() => validateSlots(c, { appName: "Bad_Name", org: "acme" })).toThrow(ContractError);
  });

  it("rejects a missing org", () => {
    expect(() => validateSlots(c, { appName: "smoke-app", org: "" })).toThrow(ContractError);
  });

  it("rejects a frontend outside the allowed set", () => {
    expect(() => validateSlots(c, { appName: "smoke-app", org: "acme", frontend: "svelte" })).toThrow(
      ContractError,
    );
  });
});

describe("capability gates on a bare 0.1.0 contract", () => {
  const c = readContract('[contract]\nversion = "0.1.0"\n[template]\nname = "enrahitu"\n');

  it("has no scaffold verb and no cert support", () => {
    expect(hasScaffoldVerb(c)).toBe(false);
    expect(supportsCert(c)).toBe(false);
  });
});
