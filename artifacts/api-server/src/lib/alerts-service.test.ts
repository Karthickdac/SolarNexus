import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { db, notificationSettingsTable } from "@workspace/db";
import {
  deleteSiteThreshold,
  isValidSiteId,
  listSiteThresholds,
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

after(async () => {
  // Drop the pg pool so the test process exits cleanly. Imported lazily to
  // avoid coupling the test surface to the db module's internals beyond what
  // is needed for cleanup.
  const { pool } = await import("@workspace/db");
  await pool.end();
});
