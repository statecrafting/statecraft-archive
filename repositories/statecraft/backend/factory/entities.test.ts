/**
 * StampJob persistence round-trips (spec 005 §4). libSQL arm always runs; the
 * Postgres arm runs under TEST_POSTGRES_URL (CI sets it), mirroring the tenants
 * and core/ledger skip pattern.
 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Ledger, LibsqlDriver, PostgresDriver } from "../core/ledger";

import { StampJob } from "./entities";

const PG_URL = process.env.TEST_POSTGRES_URL;

interface Arm {
  name: string;
  skip: boolean;
  make: () => Ledger;
}

const arms: Arm[] = [
  {
    name: "libsql",
    skip: false,
    make: () =>
      new Ledger(new LibsqlDriver({ url: `file:${join(tmpdir(), `factory-${randomUUID()}.db`)}` })),
  },
  {
    name: "postgres",
    skip: !PG_URL,
    make: () => new Ledger(new PostgresDriver({ url: PG_URL! })),
  },
];

for (const arm of arms) {
  const suite = arm.skip ? describe.skip : describe;
  suite(`StampJob on ${arm.name}`, () => {
    let ledger: Ledger;

    beforeAll(async () => {
      ledger = arm.make();
      await ledger.init([StampJob]);
    });

    afterAll(async () => {
      await ledger?.close();
    });

    it("round-trips a job with nullable fields and status transitions", async () => {
      const repo = ledger.repo(StampJob);
      const job = Object.assign(new StampJob(), {
        tenantId: `t-${randomUUID()}`,
        installationId: "125344051",
        appName: "smoke-app",
        org: "statecrafting",
        frontend: "react-rr7",
        pages: true,
        templateRef: "34134f9a48ddff75cca1df4f9a15e06140357bdd",
        mode: "adopt" as const,
        contractVersion: "0.5.0",
        posture: "assisted" as const,
        status: "queued" as const,
      });
      await repo.insert(job);

      const back = await repo.findById(job.id);
      expect(back?.appName).toBe("smoke-app");
      expect(back?.frontend).toBe("react-rr7");
      expect(back?.pages).toBe(true);
      expect(back?.mode).toBe("adopt");
      expect(back?.posture).toBe("assisted");
      expect(back?.status).toBe("queued");
      expect(back?.certHash).toBeNull();
      expect(back?.prUrl).toBeNull();
      expect(back?.error).toBeNull();

      await repo.updateById(job.id, {
        status: "green",
        certHash: "ad33056e",
        checksRunId: "999",
        prUrl: "https://github.com/statecrafting/smoke-app/pull/1",
        updatedAt: new Date(),
      });
      const done = await repo.findById(job.id);
      expect(done?.status).toBe("green");
      expect(done?.certHash).toBe("ad33056e");
      expect(done?.checksRunId).toBe("999");
      expect(done?.prUrl).toBe("https://github.com/statecrafting/smoke-app/pull/1");
    });
  });
}
