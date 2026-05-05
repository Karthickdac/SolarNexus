import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inArray, sql } from "drizzle-orm";
import {
  db,
  deviceSiteAssignmentsTable,
  notificationSettingsTable,
} from "@workspace/db";
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

const uniqueDeviceId = (label: string) =>
  `route-dev-${label}-${randomBytes(4).toString("hex")}`;

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

const putSiteDevices = (
  siteId: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  fetch(url(`/alerts/site-devices/${encodeURIComponent(siteId)}`), {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const deleteSiteDevices = (
  siteId: string,
  headers: Record<string, string> = {},
) =>
  fetch(url(`/alerts/site-devices/${encodeURIComponent(siteId)}`), {
    method: "DELETE",
    headers,
  });

describe("PUT /alerts/site-devices/:siteId — payload validation", () => {
  afterEach(cleanupAssignments);

  it("rejects an invalid siteId in the URL with 400", async () => {
    const device = trackDevice(uniqueDeviceId("ok"));
    const res = await putSiteDevices("bad id!", { deviceIds: [device] });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /siteId/i);
  });

  it("rejects when deviceIds is missing or not an array", async () => {
    const siteId = uniqueSiteId("nonarr");
    const missing = await putSiteDevices(siteId, {});
    assert.equal(missing.status, 400);
    const missingBody = (await missing.json()) as { error: string };
    assert.match(missingBody.error, /deviceIds/);

    for (const bad of [
      { deviceIds: "device-a" },
      { deviceIds: 42 },
      { deviceIds: null },
      { deviceIds: { 0: "a" } },
    ]) {
      const res = await putSiteDevices(siteId, bad);
      assert.equal(
        res.status,
        400,
        `expected 400 for payload ${JSON.stringify(bad)}`,
      );
    }
  });

  it("rejects an array containing non-string entries", async () => {
    const siteId = uniqueSiteId("mixed");
    const device = trackDevice(uniqueDeviceId("ok"));
    for (const mixed of [
      [device, 123],
      [device, null],
      [device, { id: "x" }],
      [device, ["nested"]],
    ]) {
      const res = await putSiteDevices(siteId, { deviceIds: mixed });
      assert.equal(
        res.status,
        400,
        `expected 400 for mixed payload ${JSON.stringify(mixed)}`,
      );
      const body = (await res.json()) as { error: string };
      assert.match(body.error, /deviceIds/);
    }
  });

  it("rejects an array with an invalid deviceId string with 400", async () => {
    const siteId = uniqueSiteId("baddev");
    const res = await putSiteDevices(siteId, {
      deviceIds: ["bad device id!"],
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /deviceId/);
  });
});

describe("Site-device assignment lifecycle (PUT then GET then DELETE)", () => {
  afterEach(cleanupAssignments);

  it("returns the new rows from GET after a successful PUT, supports moves and removals, and clears on DELETE", async () => {
    const siteA = uniqueSiteId("lifeA");
    const siteB = uniqueSiteId("lifeB");
    const a = trackDevice(uniqueDeviceId("a"));
    const b = trackDevice(uniqueDeviceId("b"));
    const c = trackDevice(uniqueDeviceId("c"));

    const putRes = await putSiteDevices(siteA, { deviceIds: [a, b] });
    assert.equal(putRes.status, 200);
    const putBody = (await putRes.json()) as {
      assignments: { deviceId: string; siteId: string }[];
    };
    assert.equal(putBody.assignments.length, 2);
    for (const row of putBody.assignments) assert.equal(row.siteId, siteA);

    const listRes = await fetch(url("/alerts/site-devices"));
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as {
      assignments: { deviceId: string; siteId: string }[];
    };
    const ourInA = listBody.assignments.filter((row) => row.siteId === siteA);
    assert.equal(ourInA.length >= 2, true);
    const inAIds = new Set(ourInA.map((r) => r.deviceId));
    assert.ok(inAIds.has(a) && inAIds.has(b));

    // Move device `a` to siteB and add new device `c`. Device `a` should
    // disappear from siteA (moved) and device `b` should remain on siteA
    // (untouched by a different site's PUT).
    const moveRes = await putSiteDevices(siteB, { deviceIds: [a, c] });
    assert.equal(moveRes.status, 200);

    const after = await fetch(url("/alerts/site-devices"));
    const afterBody = (await after.json()) as {
      assignments: { deviceId: string; siteId: string }[];
    };
    const siteForA = afterBody.assignments.find((r) => r.deviceId === a)?.siteId;
    const siteForB = afterBody.assignments.find((r) => r.deviceId === b)?.siteId;
    const siteForC = afterBody.assignments.find((r) => r.deviceId === c)?.siteId;
    assert.equal(siteForA, siteB, "device a should be moved to siteB");
    assert.equal(siteForB, siteA, "device b should remain on siteA");
    assert.equal(siteForC, siteB, "device c should be on siteB");

    // Replace siteA with just [b] - should be a no-op for b.
    // Then replace siteA with [] to drop all assignments for the site.
    const clearViaPut = await putSiteDevices(siteA, { deviceIds: [] });
    assert.equal(clearViaPut.status, 200);
    const clearedBody = (await clearViaPut.json()) as {
      assignments: unknown[];
    };
    assert.equal(clearedBody.assignments.length, 0);

    // siteB should still have a and c.
    const stillB = await fetch(url("/alerts/site-devices"));
    const stillBody = (await stillB.json()) as {
      assignments: { deviceId: string; siteId: string }[];
    };
    const inBIds = new Set(
      stillBody.assignments
        .filter((r) => r.siteId === siteB)
        .map((r) => r.deviceId),
    );
    assert.ok(inBIds.has(a) && inBIds.has(c));

    // DELETE clears siteB and is idempotent on a second call.
    const delRes = await deleteSiteDevices(siteB);
    assert.equal(delRes.status, 204);
    const delAgain = await deleteSiteDevices(siteB);
    assert.equal(delAgain.status, 204);

    const finalList = await fetch(url("/alerts/site-devices"));
    const finalBody = (await finalList.json()) as {
      assignments: { deviceId: string }[];
    };
    const ourFinal = finalBody.assignments.filter((row) =>
      seededDeviceIds.has(row.deviceId),
    );
    assert.equal(ourFinal.length, 0);
  });

  it("DELETE rejects an invalid siteId with 400", async () => {
    const res = await deleteSiteDevices("bad id!");
    assert.equal(res.status, 400);
  });
});

describe("Admin auth on site-device mutations", () => {
  const ADMIN_TOKEN = "test-admin-token-" + randomBytes(4).toString("hex");
  const originalToken = process.env.ADMIN_API_TOKEN;

  before(() => {
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
  });

  after(() => {
    if (originalToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = originalToken;
  });

  afterEach(cleanupAssignments);

  it("rejects PUT without a token", async () => {
    const siteId = uniqueSiteId("noauth-dev");
    const res = await putSiteDevices(siteId, { deviceIds: [] });
    assert.equal(res.status, 401);
  });

  it("rejects DELETE without a token", async () => {
    const res = await deleteSiteDevices(uniqueSiteId("noauth-del"));
    assert.equal(res.status, 401);
  });

  it("accepts PUT with the correct admin token", async () => {
    const siteId = uniqueSiteId("authok-dev");
    const device = trackDevice(uniqueDeviceId("authok"));
    const res = await putSiteDevices(
      siteId,
      { deviceIds: [device] },
      { "x-admin-token": ADMIN_TOKEN },
    );
    assert.equal(res.status, 200);
  });

  it("still allows GET without a token (read-only endpoint)", async () => {
    const res = await fetch(url("/alerts/site-devices"));
    assert.equal(res.status, 200);
  });
});
