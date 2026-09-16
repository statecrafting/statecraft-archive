/**
 * TenantMembership persistence round-trips (spec 011 §5.2). The libSQL arm
 * always runs; the Postgres arm runs when TEST_POSTGRES_URL is set (the same
 * skip pattern as tenants/entities.test.ts).
 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Ledger, LibsqlDriver, PostgresDriver } from "../../core/ledger";

import { TenantMembership } from "./entities";

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
      new Ledger(
        new LibsqlDriver({ url: `file:${join(tmpdir(), `membership-${randomUUID()}.db`)}` }),
      ),
  },
  {
    name: "postgres",
    skip: !PG_URL,
    make: () => new Ledger(new PostgresDriver({ url: PG_URL! })),
  },
];

for (const arm of arms) {
  const suite = arm.skip ? describe.skip : describe;
  suite(`TenantMembership on ${arm.name}`, () => {
    let ledger: Ledger;

    beforeAll(async () => {
      ledger = arm.make();
      await ledger.init([TenantMembership]);
    });

    afterAll(async () => {
      await ledger?.close();
    });

    it("round-trips a fully-populated membership", async () => {
      const now = new Date();
      const row = Object.assign(new TenantMembership(), {
        tenantId: randomUUID(),
        githubUserId: "12345",
        userAccountId: randomUUID(),
        role: "admin",
        source: "reconcile",
        createdAt: now,
        updatedAt: now,
        lastReconciledAt: now,
      });
      await ledger.repo(TenantMembership).insert(row);

      const back = await ledger.repo(TenantMembership).findById(row.id);
      expect(back).not.toBeNull();
      expect(back!.role).toBe("admin");
      expect(back!.source).toBe("reconcile");
      expect(back!.githubUserId).toBe("12345");
      expect(back!.lastReconciledAt).toBeInstanceOf(Date);
    });

    it("round-trips the nullable identity sides", async () => {
      // A pending install grant: known app user, GitHub id not yet learned.
      const pending = Object.assign(new TenantMembership(), {
        tenantId: randomUUID(),
        githubUserId: null,
        userAccountId: randomUUID(),
        role: "admin",
        source: "install",
      });
      await ledger.repo(TenantMembership).insert(pending);

      const back = await ledger.repo(TenantMembership).findById(pending.id);
      expect(back!.githubUserId).toBeNull();
      expect(back!.lastReconciledAt).toBeNull();
      expect(back!.userAccountId).toBe(pending.userAccountId);
    });
  });
}
