/**
 * Entity persistence round-trips (spec 004 §4). The libSQL arm always runs; the
 * Postgres arm runs when TEST_POSTGRES_URL is set (CI sets it against a service
 * container, the same skip pattern as backend/core/ledger/postgres.test.ts).
 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Ledger, LibsqlDriver, PostgresDriver } from "../core/ledger";

import { Installation, Tenant } from "./entities";

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
      new Ledger(new LibsqlDriver({ url: `file:${join(tmpdir(), `tenants-${randomUUID()}.db`)}` })),
  },
  {
    name: "postgres",
    skip: !PG_URL,
    make: () => new Ledger(new PostgresDriver({ url: PG_URL! })),
  },
];

for (const arm of arms) {
  const suite = arm.skip ? describe.skip : describe;
  suite(`Tenant + Installation on ${arm.name}`, () => {
    let ledger: Ledger;

    beforeAll(async () => {
      ledger = arm.make();
      await ledger.init([Tenant, Installation]);
    });

    afterAll(async () => {
      await ledger?.close();
    });

    it("round-trips a tenant", async () => {
      const tenant = Object.assign(new Tenant(), {
        name: "Acme Agency",
        ownerUserId: `u-${randomUUID()}`,
      });
      await ledger.repo(Tenant).insert(tenant);

      const back = await ledger.repo(Tenant).findById(tenant.id);
      expect(back).not.toBeNull();
      expect(back?.name).toBe("Acme Agency");
      expect(back?.ownerUserId).toBe(tenant.ownerUserId);
      expect(back?.createdAt).toBeInstanceOf(Date);
    });

    it("persists an installation and updates its status in place", async () => {
      const repo = ledger.repo(Installation);
      const installationId = randomUUID();
      const row = Object.assign(new Installation(), {
        tenantId: `t-${randomUUID()}`,
        githubOrg: "acme-org",
        installationId,
        status: "active" as const,
      });
      await repo.insert(row);

      const found = await repo.findOne({ installationId } as Partial<Installation>);
      expect(found?.githubOrg).toBe("acme-org");
      expect(found?.status).toBe("active");

      await repo.updateById(found!.id, { status: "suspended", updatedAt: new Date() });
      const updated = await repo.findById(found!.id);
      expect(updated?.status).toBe("suspended");
    });
  });
}
