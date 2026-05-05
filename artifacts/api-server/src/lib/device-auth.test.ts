import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authenticateDeviceRequest,
  getAcceptedTokens,
  parseTokenList,
  ROTATION_WARNING_MESSAGE,
  warnIfPreviousTokenSlot,
  type AuthResult,
} from "./device-auth.ts";

// Express's `Request.get` is overloaded so `get("set-cookie")` returns
// `string[] | undefined` while every other header name returns
// `string | undefined`. Match that shape so the mock satisfies
// `Pick<Request, "get">` without `as unknown as` casts.
const makeReq = (headers: Record<string, string | undefined>) => {
  function get(name: "set-cookie"): string[] | undefined;
  function get(name: string): string | undefined;
  function get(name: string): string | string[] | undefined {
    const value = headers[name.toLowerCase()];
    if (name.toLowerCase() === "set-cookie") {
      return value === undefined ? undefined : [value];
    }
    return value;
  }
  return { get };
};

describe("parseTokenList", () => {
  it("returns an empty list when input is undefined or empty", () => {
    assert.deepEqual(parseTokenList(undefined), []);
    assert.deepEqual(parseTokenList(""), []);
    assert.deepEqual(parseTokenList("   "), []);
  });

  it("splits on commas, trims whitespace, and drops empty entries", () => {
    assert.deepEqual(parseTokenList("a,b,c"), ["a", "b", "c"]);
    assert.deepEqual(parseTokenList(" a , b ,, c , "), ["a", "b", "c"]);
    assert.deepEqual(parseTokenList(",,,"), []);
  });

  it("preserves token order so 'previous' rotation history stays predictable", () => {
    assert.deepEqual(parseTokenList("first,second,third"), [
      "first",
      "second",
      "third",
    ]);
  });
});

describe("getAcceptedTokens", () => {
  it("returns nothing when neither env var is set", () => {
    assert.deepEqual(getAcceptedTokens({}), []);
  });

  it("returns only the current token when no previous tokens are configured", () => {
    assert.deepEqual(
      getAcceptedTokens({ MODBUS_INGEST_TOKEN: "current-secret" }),
      [{ slot: "current", token: "current-secret" }],
    );
  });

  it("includes both current and previous tokens, in priority order", () => {
    assert.deepEqual(
      getAcceptedTokens({
        MODBUS_INGEST_TOKEN: "now",
        MODBUS_INGEST_TOKEN_PREVIOUS: "old1, old2",
      }),
      [
        { slot: "current", token: "now" },
        { slot: "previous", token: "old1" },
        { slot: "previous", token: "old2" },
      ],
    );
  });

  it("deduplicates a token that appears in both env vars (current wins)", () => {
    assert.deepEqual(
      getAcceptedTokens({
        MODBUS_INGEST_TOKEN: "shared",
        MODBUS_INGEST_TOKEN_PREVIOUS: "shared, leftover",
      }),
      [
        { slot: "current", token: "shared" },
        { slot: "previous", token: "leftover" },
      ],
    );
  });
});

describe("authenticateDeviceRequest", () => {
  it("returns 503 when no tokens are configured at all", () => {
    const result = authenticateDeviceRequest(
      makeReq({ "x-device-key": "anything" }),
      {},
    );
    assert.deepEqual(result, {
      ok: false,
      status: 503,
      error: "Device ingest token is not configured.",
    });
  });

  it("returns 401 when no token header is provided", () => {
    const result = authenticateDeviceRequest(makeReq({}), {
      MODBUS_INGEST_TOKEN: "current",
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.status, 401);
  });

  it("accepts the current token via x-device-key", () => {
    const result = authenticateDeviceRequest(
      makeReq({ "x-device-key": "current" }),
      { MODBUS_INGEST_TOKEN: "current" },
    );
    assert.deepEqual(result, { ok: true, slot: "current" });
  });

  it("accepts the current token via Authorization: Bearer", () => {
    const result = authenticateDeviceRequest(
      makeReq({ authorization: "Bearer current" }),
      { MODBUS_INGEST_TOKEN: "current" },
    );
    assert.deepEqual(result, { ok: true, slot: "current" });
  });

  it("accepts a rotating previous token from the comma-separated list and reports slot=previous", () => {
    const result = authenticateDeviceRequest(
      makeReq({ "x-device-key": "old2" }),
      {
        MODBUS_INGEST_TOKEN: "current",
        MODBUS_INGEST_TOKEN_PREVIOUS: "old1, old2 , old3",
      },
    );
    assert.deepEqual(result, { ok: true, slot: "previous" });
  });

  it("rejects a retired token after rotation completes (previous list cleared)", () => {
    const result = authenticateDeviceRequest(
      makeReq({ "x-device-key": "retired" }),
      {
        MODBUS_INGEST_TOKEN: "current",
        // MODBUS_INGEST_TOKEN_PREVIOUS intentionally unset to simulate
        // the operator having finished rotation.
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.status, 401);
  });

  it("rejects a token that does not match either slot", () => {
    const result = authenticateDeviceRequest(
      makeReq({ "x-device-key": "guess" }),
      {
        MODBUS_INGEST_TOKEN: "current",
        MODBUS_INGEST_TOKEN_PREVIOUS: "old",
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.status, 401);
  });

  it("rejects tokens of different lengths without throwing on timingSafeEqual", () => {
    const result = authenticateDeviceRequest(
      makeReq({ "x-device-key": "x" }),
      {
        MODBUS_INGEST_TOKEN: "much-longer-current-token",
        MODBUS_INGEST_TOKEN_PREVIOUS: "also-much-longer-old-token",
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.status, 401);
  });

  it("prefers x-device-key when both x-device-key and Authorization are present", () => {
    const result = authenticateDeviceRequest(
      makeReq({
        "x-device-key": "current",
        authorization: "Bearer old",
      }),
      {
        MODBUS_INGEST_TOKEN: "current",
        MODBUS_INGEST_TOKEN_PREVIOUS: "old",
      },
    );
    assert.deepEqual(result, { ok: true, slot: "current" });
  });
});

describe("warnIfPreviousTokenSlot", () => {
  type LogCall = { args: unknown[] };
  const makeLog = () => {
    const calls: LogCall[] = [];
    const log = {
      warn: (...args: unknown[]) => {
        calls.push({ args });
      },
    };
    return { log, calls };
  };

  it("does not warn when authentication failed", () => {
    const { log, calls } = makeLog();
    const result: AuthResult = {
      ok: false,
      status: 401,
      error: "Unauthorized: missing or invalid device token.",
    };
    const warned = warnIfPreviousTokenSlot(log, result);
    assert.equal(warned, false);
    assert.equal(calls.length, 0);
  });

  it("does not warn when the current token slot was used", () => {
    const { log, calls } = makeLog();
    const warned = warnIfPreviousTokenSlot(log, { ok: true, slot: "current" });
    assert.equal(warned, false);
    assert.equal(calls.length, 0);
  });

  it("warns once with the rotation message when the previous token slot was used", () => {
    const { log, calls } = makeLog();
    const warned = warnIfPreviousTokenSlot(
      log,
      { ok: true, slot: "previous" },
      { source: "192.0.2.10" },
    );
    assert.equal(warned, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args[0], { source: "192.0.2.10" });
    assert.equal(calls[0]?.args[1], ROTATION_WARNING_MESSAGE);
    assert.match(
      String(calls[0]?.args[1]),
      /previous \(rotating\) device token/i,
    );
    assert.match(String(calls[0]?.args[1]), /MODBUS_INGEST_TOKEN/);
  });

  it("passes an empty context object when none is provided", () => {
    const { log, calls } = makeLog();
    warnIfPreviousTokenSlot(log, { ok: true, slot: "previous" });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args[0], {});
  });
});
