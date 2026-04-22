import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import { db, notificationSettingsTable } from "@workspace/db";
import app from "../app";

const SITE_PREFIX = "site:";

const uniqueSiteId = (label: string) =>
  `route-${label}-${randomBytes(4).toString("hex")}`;

const seededSiteIds = new Set<string>();

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

let server: Server;
let baseUrl = "";

const url = (path: string) => `${baseUrl}${path}`;

before(async () => {
  // Make sure NODE_ENV is "test" so requireAdminAuth lets us through unless
  // a test explicitly sets ADMIN_API_TOKEN. The main app reads NODE_ENV at
  // request time per check, so toggling it later is supported.
  process.env.NODE_ENV = "test";
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/api`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  const { pool } = await import("@workspace/db");
  await pool.end();
});

describe("PUT /alerts/site-thresholds — payload validation", () => {
  afterEach(cleanupSites);

  const putThreshold = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(url("/alerts/site-thresholds"), {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("rejects an invalid siteId with 400", async () => {
    const res = await putThreshold({ siteId: "bad id!", thresholdMinutes: 30 });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /siteId/);
  });

  it("rejects a non-integer thresholdMinutes with 400", async () => {
    const siteId = uniqueSiteId("nonint");
    seededSiteIds.add(siteId);
    const res = await putThreshold({ siteId, thresholdMinutes: 12.5 });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /thresholdMinutes/);
  });

  it("rejects a thresholdMinutes below 1 with 400", async () => {
    const siteId = uniqueSiteId("low");
    seededSiteIds.add(siteId);
    const res = await putThreshold({ siteId, thresholdMinutes: 0 });
    assert.equal(res.status, 400);
  });

  it("rejects a thresholdMinutes above 1440 with 400", async () => {
    const siteId = uniqueSiteId("high");
    seededSiteIds.add(siteId);
    const res = await putThreshold({ siteId, thresholdMinutes: 1441 });
    assert.equal(res.status, 400);
  });

  it("rejects an out-of-range cooldownMinutes with 400", async () => {
    const siteId = uniqueSiteId("cool");
    seededSiteIds.add(siteId);
    const tooLow = await putThreshold({
      siteId,
      thresholdMinutes: 30,
      cooldownMinutes: 0,
    });
    assert.equal(tooLow.status, 400);
    const tooHigh = await putThreshold({
      siteId,
      thresholdMinutes: 30,
      cooldownMinutes: 1441,
    });
    assert.equal(tooHigh.status, 400);
    const nonInt = await putThreshold({
      siteId,
      thresholdMinutes: 30,
      cooldownMinutes: 7.5,
    });
    assert.equal(nonInt.status, 400);
  });

  it("accepts edge values 1 and 1440 for both fields", async () => {
    const siteId = uniqueSiteId("edges");
    seededSiteIds.add(siteId);
    const low = await putThreshold({
      siteId,
      thresholdMinutes: 1,
      cooldownMinutes: 1,
    });
    assert.equal(low.status, 200);
    const high = await putThreshold({
      siteId,
      thresholdMinutes: 1440,
      cooldownMinutes: 1440,
    });
    assert.equal(high.status, 200);
    const body = (await high.json()) as {
      threshold: { thresholdMinutes: number; cooldownMinutes: number };
    };
    assert.equal(body.threshold.thresholdMinutes, 1440);
    assert.equal(body.threshold.cooldownMinutes, 1440);
  });
});

describe("Site-threshold lifecycle (PUT then GET then DELETE)", () => {
  afterEach(cleanupSites);

  it("returns the new row from GET after a successful PUT, and removes it on DELETE", async () => {
    const siteId = uniqueSiteId("lifecycle");
    seededSiteIds.add(siteId);

    const putRes = await fetch(url("/alerts/site-thresholds"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        siteId,
        thresholdMinutes: 17,
        cooldownMinutes: 23,
      }),
    });
    assert.equal(putRes.status, 200);
    const putBody = (await putRes.json()) as {
      threshold: {
        siteId: string;
        thresholdMinutes: number;
        cooldownMinutes: number;
      };
    };
    assert.equal(putBody.threshold.siteId, siteId);
    assert.equal(putBody.threshold.thresholdMinutes, 17);
    assert.equal(putBody.threshold.cooldownMinutes, 23);

    const listRes = await fetch(url("/alerts/site-thresholds"));
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as {
      thresholds: { siteId: string; thresholdMinutes: number }[];
    };
    const ours = listBody.thresholds.find((t) => t.siteId === siteId);
    assert.ok(ours);
    assert.equal(ours?.thresholdMinutes, 17);

    const delRes = await fetch(
      url(`/alerts/site-thresholds/${encodeURIComponent(siteId)}`),
      { method: "DELETE" },
    );
    assert.equal(delRes.status, 204);

    const listAfter = await fetch(url("/alerts/site-thresholds"));
    const listAfterBody = (await listAfter.json()) as {
      thresholds: { siteId: string }[];
    };
    assert.equal(
      listAfterBody.thresholds.some((t) => t.siteId === siteId),
      false,
    );

    // Idempotent delete returns 204 again.
    const delAgain = await fetch(
      url(`/alerts/site-thresholds/${encodeURIComponent(siteId)}`),
      { method: "DELETE" },
    );
    assert.equal(delAgain.status, 204);
  });

  it("DELETE rejects an invalid siteId with 400", async () => {
    const res = await fetch(
      url(`/alerts/site-thresholds/${encodeURIComponent("bad id!")}`),
      { method: "DELETE" },
    );
    assert.equal(res.status, 400);
  });
});

describe("Admin auth on site-threshold mutations", () => {
  const ADMIN_TOKEN = "test-admin-token-" + randomBytes(4).toString("hex");
  const originalToken = process.env.ADMIN_API_TOKEN;

  before(() => {
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
  });

  after(() => {
    if (originalToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = originalToken;
  });

  afterEach(cleanupSites);

  it("rejects PUT without a token", async () => {
    const res = await fetch(url("/alerts/site-thresholds"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        siteId: uniqueSiteId("noauth"),
        thresholdMinutes: 30,
      }),
    });
    assert.equal(res.status, 401);
  });

  it("rejects DELETE without a token", async () => {
    const res = await fetch(
      url(`/alerts/site-thresholds/${encodeURIComponent("anything")}`),
      { method: "DELETE" },
    );
    assert.equal(res.status, 401);
  });

  it("accepts PUT with the correct admin token", async () => {
    const siteId = uniqueSiteId("authok");
    seededSiteIds.add(siteId);
    const res = await fetch(url("/alerts/site-thresholds"), {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-admin-token": ADMIN_TOKEN,
      },
      body: JSON.stringify({ siteId, thresholdMinutes: 25 }),
    });
    assert.equal(res.status, 200);
  });

  it("still allows GET without a token (read-only endpoint)", async () => {
    const res = await fetch(url("/alerts/site-thresholds"));
    assert.equal(res.status, 200);
  });
});
