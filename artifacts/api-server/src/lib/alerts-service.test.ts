import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import { inArray, sql } from "drizzle-orm";
import {
  db,
  deviceSiteAssignmentsTable,
  notificationSettingsTable,
} from "@workspace/db";
import {
  clearSiteDeviceAssignments,
  deleteSiteThreshold,
  isValidDeviceId,
  isValidSiteId,
  listDeviceSiteAssignments,
  listSiteThresholds,
  replaceSiteDeviceAssignments,
  upsertSiteThreshold,
} from "./alerts-service";
import { logger } from "./logger";

const SITE_PREFIX = "site:";

const uniqueSiteId = (label: string) =>
  `test-${label}-${randomBytes(4).toString("hex")}`;

const seededSiteIds = new Set<string>();

const trackSite = (siteId: string) => {
  seededSiteIds.add(siteId);
  return siteId;
};

const cleanupSites = async () => {
  if (seededSiteIds.size === 0) return;
  const scopes = Array.from(seededSiteIds).map((id) => `${SITE_PREFIX}${id}`);
  await db
    .delete(notificationSettingsTable)
    .where(sql`${notificationSettingsTable.scope} in (${sql.join(
      scopes.map((s) => sql`${s}`),
      sql`, `,
    )})`);
  seededSiteIds.clear();
};

describe("isValidSiteId", () => {
  it("accepts allowed characters", () => {
    for (const id of ["a", "Site_1", "north-east.42", "x".repeat(128)]) {
      assert.equal(isValidSiteId(id), true, `expected ${id} to be valid`);
    }
  });

  it("rejects empty, too-long, or disallowed-character ids", () => {
    for (const id of [
      "",
      "x".repeat(129),
      "has space",
      "comma,bad",
      "slash/bad",
      "colon:bad",
      "unicode-✓",
    ]) {
      assert.equal(isValidSiteId(id), false, `expected ${id} to be invalid`);
    }
  });
});

describe("upsertSiteThreshold", () => {
  afterEach(cleanupSites);

  it("rejects an invalid siteId before touching the database", async () => {
    await assert.rejects(
      () => upsertSiteThreshold("bad id!", 30),
      /Invalid siteId/,
    );
  });

  it("inserts a new row, updates threshold on conflict, and preserves the prior cooldown when omitted", async () => {
    const siteId = trackSite(uniqueSiteId("upsert"));

    const inserted = await upsertSiteThreshold(siteId, 15, 45);
    assert.equal(inserted.siteId, siteId);
    assert.equal(inserted.thresholdMinutes, 15);
    assert.equal(inserted.cooldownMinutes, 45);
    assert.ok(inserted.updatedAt instanceof Date);

    // Repeated update without cooldown must keep the previously stored
    // cooldown rather than resetting it to the global default.
    const updatedThresholdOnly = await upsertSiteThreshold(siteId, 22);
    assert.equal(updatedThresholdOnly.thresholdMinutes, 22);
    assert.equal(updatedThresholdOnly.cooldownMinutes, 45);

    // Repeated update with both fields should overwrite both.
    const updatedBoth = await upsertSiteThreshold(siteId, 9, 12);
    assert.equal(updatedBoth.thresholdMinutes, 9);
    assert.equal(updatedBoth.cooldownMinutes, 12);

    // Only one row should exist for this site (atomic upsert, no duplicates).
    const rows = await db
      .select()
      .from(notificationSettingsTable)
      .where(
        sql`${notificationSettingsTable.scope} = ${SITE_PREFIX + siteId}`,
      );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.thresholdMinutes, 9);
    assert.equal(rows[0]?.cooldownMinutes, 12);
  });
});

describe("deleteSiteThreshold", () => {
  afterEach(cleanupSites);

  it("rejects an invalid siteId", async () => {
    await assert.rejects(
      () => deleteSiteThreshold("bad id!"),
      /Invalid siteId/,
    );
  });

  it("removes an existing row and is idempotent on repeat calls", async () => {
    const siteId = trackSite(uniqueSiteId("delete"));
    await upsertSiteThreshold(siteId, 20, 30);

    await deleteSiteThreshold(siteId);
    const afterFirst = await db
      .select()
      .from(notificationSettingsTable)
      .where(
        sql`${notificationSettingsTable.scope} = ${SITE_PREFIX + siteId}`,
      );
    assert.equal(afterFirst.length, 0);

    // Calling delete again on a missing row must not throw.
    await deleteSiteThreshold(siteId);
  });

  it("does not throw when called on a site that never had a threshold", async () => {
    const siteId = trackSite(uniqueSiteId("never"));
    await deleteSiteThreshold(siteId);
  });
});

describe("listSiteThresholds", () => {
  let originalWarn: typeof logger.warn;
  type WarnCall = { context: unknown; message: unknown };
  let warnCalls: WarnCall[] = [];
  const malformedScope = `${SITE_PREFIX}bad scope!!`;

  before(() => {
    originalWarn = logger.warn.bind(logger);
  });

  afterEach(async () => {
    logger.warn = originalWarn;
    warnCalls = [];
    await cleanupSites();
    await db
      .delete(notificationSettingsTable)
      .where(sql`${notificationSettingsTable.scope} = ${malformedScope}`);
  });

  after(() => {
    logger.warn = originalWarn;
  });

  it("returns only well-formed site rows and warns on malformed scopes", async () => {
    const goodSiteId = trackSite(uniqueSiteId("list"));
    await upsertSiteThreshold(goodSiteId, 11, 22);

    // Insert a malformed site-scoped row directly so we can exercise the
    // warn-and-skip branch in listSiteThresholds.
    await db.insert(notificationSettingsTable).values({
      scope: malformedScope,
      enabled: true,
      thresholdMinutes: 5,
      cooldownMinutes: 5,
      channels: { inApp: { enabled: true }, webhook: { enabled: false, url: "" }, email: { enabled: false, to: "" } },
    });

    logger.warn = ((...args: unknown[]) => {
      warnCalls.push({ context: args[0], message: args[1] });
      return undefined as unknown as ReturnType<typeof logger.warn>;
    }) as typeof logger.warn;

    const result = await listSiteThresholds();
    const ours = result.find((row) => row.siteId === goodSiteId);
    assert.ok(ours, "expected the well-formed site row to be returned");
    assert.equal(ours?.thresholdMinutes, 11);
    assert.equal(ours?.cooldownMinutes, 22);

    // The malformed scope must be filtered out.
    assert.equal(
      result.some((row) => row.siteId.includes("bad scope")),
      false,
    );

    // And we should have warned about the malformed row at least once.
    const warnedAboutMalformed = warnCalls.some(
      (call) =>
        typeof call.context === "object" &&
        call.context !== null &&
        (call.context as { scope?: string }).scope === malformedScope,
    );
    assert.equal(warnedAboutMalformed, true);
  });
});

const uniqueDeviceId = (label: string) =>
  `dev-${label}-${randomBytes(4).toString("hex")}`;

const seededDeviceIds = new Set<string>();

const trackDevice = (deviceId: string) => {
  seededDeviceIds.add(deviceId);
  return deviceId;
};

const cleanupAssignments = async () => {
  if (seededDeviceIds.size === 0) return;
  const ids = Array.from(seededDeviceIds);
  await db
    .delete(deviceSiteAssignmentsTable)
    .where(inArray(deviceSiteAssignmentsTable.deviceId, ids));
  seededDeviceIds.clear();
};

const listAssignmentsForSite = async (siteId: string) => {
  const rows = await listDeviceSiteAssignments();
  return rows.filter((row) => row.siteId === siteId);
};

describe("isValidDeviceId", () => {
  it("accepts allowed characters", () => {
    for (const id of [
      "a",
      "Device_1",
      "rack.42",
      "inv-01",
      "ns:dev:1",
      "x".repeat(128),
    ]) {
      assert.equal(isValidDeviceId(id), true, `expected ${id} to be valid`);
    }
  });

  it("rejects empty, too-long, or disallowed-character ids", () => {
    for (const id of [
      "",
      "x".repeat(129),
      "has space",
      "comma,bad",
      "slash/bad",
      "unicode-✓",
    ]) {
      assert.equal(isValidDeviceId(id), false, `expected ${id} to be invalid`);
    }
  });
});

describe("replaceSiteDeviceAssignments", () => {
  afterEach(cleanupAssignments);

  it("rejects an invalid siteId before touching the database", async () => {
    await assert.rejects(
      () => replaceSiteDeviceAssignments("bad id!", []),
      /Invalid siteId/,
    );
  });

  it("rejects an invalid deviceId in the payload", async () => {
    const siteId = uniqueSiteId("invdev");
    const goodDevice = trackDevice(uniqueDeviceId("good"));
    await assert.rejects(
      () =>
        replaceSiteDeviceAssignments(siteId, [goodDevice, "bad device id!"]),
      /Invalid deviceId/,
    );
    // Atomic guarantee: the bad entry must abort the whole operation, so the
    // good device should *not* have been written. The validation runs before
    // the transaction opens, but lock that contract in with a check.
    const after = await listAssignmentsForSite(siteId);
    assert.equal(after.length, 0);
  });

  it("inserts new assignments and returns the resulting rows", async () => {
    const siteId = uniqueSiteId("insert");
    const a = trackDevice(uniqueDeviceId("a"));
    const b = trackDevice(uniqueDeviceId("b"));
    const result = await replaceSiteDeviceAssignments(siteId, [a, b]);
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((r) => r.deviceId).sort(),
      [a, b].sort(),
    );
    for (const row of result) {
      assert.equal(row.siteId, siteId);
      assert.ok(row.updatedAt instanceof Date);
    }
  });

  it("deduplicates and trims deviceIds in the input", async () => {
    const siteId = uniqueSiteId("dedupe");
    const a = trackDevice(uniqueDeviceId("a"));
    const result = await replaceSiteDeviceAssignments(siteId, [
      a,
      `  ${a}  `,
      "",
      "   ",
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.deviceId, a);
  });

  it("moves a device from one site to another on a subsequent PUT", async () => {
    const siteA = uniqueSiteId("from");
    const siteB = uniqueSiteId("to");
    const device = trackDevice(uniqueDeviceId("mover"));

    await replaceSiteDeviceAssignments(siteA, [device]);
    const inA = await listAssignmentsForSite(siteA);
    assert.equal(inA.length, 1);
    assert.equal(inA[0]?.deviceId, device);

    // PUTting the same device under a different site reassigns it because
    // deviceId is the primary key of the assignments table.
    await replaceSiteDeviceAssignments(siteB, [device]);
    const inAAfter = await listAssignmentsForSite(siteA);
    const inBAfter = await listAssignmentsForSite(siteB);
    assert.equal(inAAfter.length, 0, "device should no longer be on siteA");
    assert.equal(inBAfter.length, 1);
    assert.equal(inBAfter[0]?.deviceId, device);
    assert.equal(inBAfter[0]?.siteId, siteB);
  });

  it("removes devices that are no longer in the payload", async () => {
    const siteId = uniqueSiteId("drop");
    const keep = trackDevice(uniqueDeviceId("keep"));
    const drop = trackDevice(uniqueDeviceId("drop"));

    await replaceSiteDeviceAssignments(siteId, [keep, drop]);
    const before = await listAssignmentsForSite(siteId);
    assert.equal(before.length, 2);

    await replaceSiteDeviceAssignments(siteId, [keep]);
    const after = await listAssignmentsForSite(siteId);
    assert.equal(after.length, 1);
    assert.equal(after[0]?.deviceId, keep);
  });

  it("clears all assignments for the site when given an empty array", async () => {
    const siteId = uniqueSiteId("empty");
    const a = trackDevice(uniqueDeviceId("a"));
    const b = trackDevice(uniqueDeviceId("b"));
    await replaceSiteDeviceAssignments(siteId, [a, b]);

    const cleared = await replaceSiteDeviceAssignments(siteId, []);
    assert.equal(cleared.length, 0);

    const remaining = await listAssignmentsForSite(siteId);
    assert.equal(remaining.length, 0);
  });

  it("does not touch other sites' assignments when replacing one site", async () => {
    const siteA = uniqueSiteId("isoA");
    const siteB = uniqueSiteId("isoB");
    const aDevice = trackDevice(uniqueDeviceId("a"));
    const bDevice = trackDevice(uniqueDeviceId("b"));

    await replaceSiteDeviceAssignments(siteA, [aDevice]);
    await replaceSiteDeviceAssignments(siteB, [bDevice]);

    // Replacing siteA with an empty array must leave siteB untouched.
    await replaceSiteDeviceAssignments(siteA, []);
    const inB = await listAssignmentsForSite(siteB);
    assert.equal(inB.length, 1);
    assert.equal(inB[0]?.deviceId, bDevice);
  });
});

describe("clearSiteDeviceAssignments", () => {
  afterEach(cleanupAssignments);

  it("rejects an invalid siteId", async () => {
    await assert.rejects(
      () => clearSiteDeviceAssignments("bad id!"),
      /Invalid siteId/,
    );
  });

  it("removes all assignments for the given site", async () => {
    const siteId = uniqueSiteId("clear");
    const a = trackDevice(uniqueDeviceId("a"));
    const b = trackDevice(uniqueDeviceId("b"));
    await replaceSiteDeviceAssignments(siteId, [a, b]);

    await clearSiteDeviceAssignments(siteId);
    const remaining = await listAssignmentsForSite(siteId);
    assert.equal(remaining.length, 0);
  });

  it("is idempotent on repeat calls and on sites that never had assignments", async () => {
    const siteId = uniqueSiteId("idemp");
    // Never seeded, must not throw.
    await clearSiteDeviceAssignments(siteId);
    await clearSiteDeviceAssignments(siteId);
  });

  it("does not affect assignments for a different site", async () => {
    const siteA = uniqueSiteId("clrA");
    const siteB = uniqueSiteId("clrB");
    const aDevice = trackDevice(uniqueDeviceId("a"));
    const bDevice = trackDevice(uniqueDeviceId("b"));
    await replaceSiteDeviceAssignments(siteA, [aDevice]);
    await replaceSiteDeviceAssignments(siteB, [bDevice]);

    await clearSiteDeviceAssignments(siteA);
    const inA = await listAssignmentsForSite(siteA);
    const inB = await listAssignmentsForSite(siteB);
    assert.equal(inA.length, 0);
    assert.equal(inB.length, 1);
    assert.equal(inB[0]?.deviceId, bDevice);
  });
});

describe("listDeviceSiteAssignments", () => {
  afterEach(cleanupAssignments);

  it("returns every persisted assignment", async () => {
    const siteA = uniqueSiteId("listA");
    const siteB = uniqueSiteId("listB");
    const a = trackDevice(uniqueDeviceId("a"));
    const b = trackDevice(uniqueDeviceId("b"));
    await replaceSiteDeviceAssignments(siteA, [a]);
    await replaceSiteDeviceAssignments(siteB, [b]);

    const all = await listDeviceSiteAssignments();
    const ours = all.filter(
      (row) => row.deviceId === a || row.deviceId === b,
    );
    assert.equal(ours.length, 2);
    const byDevice = new Map(ours.map((row) => [row.deviceId, row.siteId]));
    assert.equal(byDevice.get(a), siteA);
    assert.equal(byDevice.get(b), siteB);
  });
});

after(async () => {
  // Drop the pg pool so the test process exits cleanly. Imported lazily to
  // avoid coupling the test surface to the db module's internals beyond what
  // is needed for cleanup.
  const { pool } = await import("@workspace/db");
  await pool.end();
});
