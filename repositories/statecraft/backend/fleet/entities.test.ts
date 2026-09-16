/**
 * FleetApp / FleetOp persistence round-trips (spec 006 §4). libSQL arm always
 * runs; the Postgres arm runs under TEST_POSTGRES_URL (CI sets it), mirroring the
 * factory/tenants/core-ledger skip pattern.
 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Ledger, LibsqlDriver, PostgresDriver } from "../core/ledger";

import { FleetApp, FleetOp } from "./entities";

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
      new Ledger(new LibsqlDriver({ url: `file:${join(tmpdir(), `fleet-${randomUUID()}.db`)}` })),
  },
  {
    name: "postgres",
    skip: !PG_URL,
    make: () => new Ledger(new PostgresDriver({ url: PG_URL! })),
  },
];

for (const arm of arms) {
  const suite = arm.skip ? describe.skip : describe;
  suite(`fleet entities on ${arm.name}`, () => {
    let ledger: Ledger;

    beforeAll(async () => {
      ledger = arm.make();
      await ledger.init([FleetApp, FleetOp]);
    });

    afterAll(async () => {
      await ledger?.close();
    });

    it("round-trips a FleetApp with a nullable stampJobId and integer volumeSize", async () => {
      const repo = ledger.repo(FleetApp);
      const app = Object.assign(new FleetApp(), {
        tenantId: `t-${randomUUID()}`,
        name: `acme-${randomUUID().slice(0, 8)}`,
        namespace: `t-${randomUUID()}`,
        image: "ghcr.io/acme/app:v1",
        volumeSize: 3,
        port: 8080,
        host: "acme.deployd.xyz",
        status: "placing" as const,
      });
      await repo.insert(app);

      const back = await repo.findById(app.id);
      expect(back?.image).toBe("ghcr.io/acme/app:v1");
      expect(back?.volumeSize).toBe(3);
      expect(back?.port).toBe(8080);
      expect(back?.status).toBe("placing");
      expect(back?.stampJobId).toBeNull();

      await repo.updateById(app.id, {
        status: "running",
        image: "ghcr.io/acme/app:v2",
        updatedAt: new Date(),
      });
      const done = await repo.findById(app.id);
      expect(done?.status).toBe("running");
      expect(done?.image).toBe("ghcr.io/acme/app:v2");
    });

    it("re-places a removed app's name (the name column is not database-unique)", async () => {
      // The 2026-07-24 E2E defect: `name` was UNIQUE, rows outlive `remove`, so
      // re-placing a removed name died on fleet_app_name_key as an untyped 500.
      const repo = ledger.repo(FleetApp);
      const name = `echo-${randomUUID().slice(0, 8)}`;
      const place = (status: "running" | "removed") =>
        Object.assign(new FleetApp(), {
          tenantId: "t-acme",
          name,
          namespace: "t-acme",
          image: "ealen/echo-server:latest",
          port: 4000,
          host: `${name}.deployd.xyz`,
          status,
        });

      const first = await repo.insert(place("running"));
      await repo.updateById(first.id, { status: "removed", updatedAt: new Date() });
      const second = await repo.insert(place("running"));

      const carrying = await repo.findWhere({ name });
      expect(carrying.map((a) => a.id).sort()).toEqual([first.id, second.id].sort());
      expect(carrying.filter((a) => a.status !== "removed")).toHaveLength(1);
      expect(second.id).not.toBe(first.id);
    });

    it("round-trips a FleetOp intent-journal row", async () => {
      const repo = ledger.repo(FleetOp);
      const op = Object.assign(new FleetOp(), {
        appId: randomUUID(),
        kind: "backup" as const,
        status: "running" as const,
      });
      await repo.insert(op);

      const back = await repo.findById(op.id);
      expect(back?.kind).toBe("backup");
      expect(back?.status).toBe("running");
      expect(back?.log).toBeNull();

      await repo.updateById(op.id, {
        status: "succeeded",
        log: "restic s3:.../t-x/acme tag acme-1",
      });
      const done = await repo.findById(op.id);
      expect(done?.status).toBe("succeeded");
      expect(done?.log).toContain("restic");
    });
  });
}
