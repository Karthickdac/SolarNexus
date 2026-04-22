import { isIP } from "node:net";
import { lookup as dnsLookupPromise } from "node:dns/promises";
import { Agent, type Dispatcher } from "undici";
import type { LookupFunction } from "node:net";

type LookupAddress = { address: string; family: number };

// Block obvious SSRF targets: localhost, link-local, RFC1918 private ranges,
// IPv6 loopback / unique-local. We reject hostnames that resolve to literal
// internal IPs and well-known internal hostnames before any DNS lookup.
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
]);

export const isPrivateIPv4 = (ip: string) => {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
};

// Parse an IPv6 string into its 16 raw bytes. Supports the dotted-quad
// suffix (e.g. ::ffff:127.0.0.1) and the standard hex-hextet syntax with
// `::` compression. Returns null for invalid input.
const parseIPv6Bytes = (ip: string): Uint8Array | null => {
  if (isIP(ip) !== 6) return null;
  let s = ip.toLowerCase();
  // Translate trailing dotted-quad into two hex hextets.
  const dotIdx = s.lastIndexOf(":");
  if (s.includes(".")) {
    const tail = s.slice(dotIdx + 1);
    if (isIP(tail) !== 4) return null;
    const parts = tail.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return null;
    }
    const [a, b, c, d] = parts as [number, number, number, number];
    const hex1 = ((a << 8) | b).toString(16);
    const hex2 = ((c << 8) | d).toString(16);
    s = `${s.slice(0, dotIdx + 1)}${hex1}:${hex2}`;
  }
  const splitOnDouble = s.split("::");
  if (splitOnDouble.length > 2) return null;
  const head =
    splitOnDouble[0] === "" ? [] : (splitOnDouble[0] ?? "").split(":");
  const tail =
    splitOnDouble.length === 2
      ? splitOnDouble[1] === ""
        ? []
        : (splitOnDouble[1] ?? "").split(":")
      : [];
  const totalGroups = splitOnDouble.length === 2 ? 8 : head.length;
  if (totalGroups > 8) return null;
  const middleZeros = splitOnDouble.length === 2 ? 8 - head.length - tail.length : 0;
  if (middleZeros < 0) return null;
  const groups = [
    ...head,
    ...new Array(middleZeros).fill("0"),
    ...tail,
  ];
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = groups[i] ?? "0";
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes[i * 2] = (v >> 8) & 0xff;
    bytes[i * 2 + 1] = v & 0xff;
  }
  return bytes;
};

export const isPrivateIPv6 = (ip: string) => {
  const bytes = parseIPv6Bytes(ip);
  if (!bytes) return false;
  // Unspecified :: and loopback ::1
  let allZero = true;
  for (let i = 0; i < 15; i++) if (bytes[i] !== 0) { allZero = false; break; }
  if (allZero && (bytes[15] === 0 || bytes[15] === 1)) return true;

  // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::0:0/96 with embedded v4).
  // Also handle IPv4/IPv6 translation prefix 64:ff9b::/96.
  let mappedV4: number[] | null = null;
  const isMapped =
    bytes.slice(0, 10).every((b) => b === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  const isWellKnownNat64 =
    bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((b) => b === 0);
  if (isMapped || isWellKnownNat64) {
    mappedV4 = [bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!];
  }
  if (mappedV4) {
    return isPrivateIPv4(mappedV4.join("."));
  }

  // ULA fc00::/7 (first 7 bits = 1111110)
  if ((bytes[0]! & 0xfe) === 0xfc) return true;
  // Link-local fe80::/10 (first 10 bits = 1111111010)
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true;
  return false;
};

export type WebhookValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

export const validateWebhookUrl = (raw: string): WebhookValidation => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "Webhook URL is not a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Webhook URL must use http or https." };
  }
  // Node's WHATWG URL preserves the brackets around IPv6 literals in
  // `hostname`. Strip them so downstream IP classification sees the raw
  // address (e.g. `::ffff:7f00:1`) rather than `[::ffff:7f00:1]`.
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, reason: "Webhook URL is missing a host." };
  if (BLOCKED_HOSTNAMES.has(host)) {
    return {
      ok: false,
      reason: `Webhook host '${host}' is not allowed (internal target).`,
    };
  }
  const ipFamily = isIP(host);
  if (ipFamily === 4 && isPrivateIPv4(host)) {
    return {
      ok: false,
      reason: `Webhook host '${host}' is in a private/loopback range.`,
    };
  }
  if (ipFamily === 6 && isPrivateIPv6(host)) {
    return {
      ok: false,
      reason: `Webhook host '${host}' is in a private/loopback range.`,
    };
  }
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    return {
      ok: false,
      reason: `Webhook host '${host}' is in an internal-only suffix.`,
    };
  }
  return { ok: true, url: parsed };
};

const isPrivateAddress = (address: string, family: number) =>
  family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);

export const resolveAndValidateWebhookHost = async (
  host: string,
): Promise<{ ok: true } | { ok: false; reason: string }> => {
  // For literal IPs, run the full private-range classification here so all
  // representations (including IPv6 hex-hextet IPv4 mappings like
  // ::ffff:7f00:1) get the same treatment regardless of the validation entry
  // point.
  const family = isIP(host);
  if (family !== 0) {
    const blocked =
      family === 4 ? isPrivateIPv4(host) : isPrivateIPv6(host);
    if (blocked) {
      return {
        ok: false,
        reason: `Webhook host '${host}' is in a private/loopback range.`,
      };
    }
    return { ok: true };
  }
  let records: LookupAddress[];
  try {
    records = await dnsLookupPromise(host, { all: true });
  } catch (err) {
    return {
      ok: false,
      reason: `Webhook host '${host}' could not be resolved: ${
        err instanceof Error ? err.message : "DNS lookup failed."
      }`,
    };
  }
  if (records.length === 0) {
    return { ok: false, reason: `Webhook host '${host}' has no DNS records.` };
  }
  for (const record of records) {
    if (isPrivateAddress(record.address, record.family)) {
      return {
        ok: false,
        reason: `Webhook host '${host}' resolves to private/internal address ${record.address}.`,
      };
    }
  }
  return { ok: true };
};

// Custom undici dispatcher whose connect-time DNS resolution rejects any
// address in our private/internal ranges. This closes the DNS-rebinding
// TOCTOU window between resolveAndValidateWebhookHost and the actual TCP
// connect: the address the agent dials is the same one we classify here.
const safeConnectLookup: LookupFunction = (hostname, options, callback) => {
  const opts = (typeof options === "object" ? options : {}) ?? {};
  const wantAll = (opts as { all?: boolean }).all === true;
  dnsLookupPromise(hostname, { all: true })
    .then((records) => {
      const filtered = records.filter(
        (record) => !isPrivateAddress(record.address, record.family),
      );
      if (filtered.length === 0) {
        const err = new Error(
          `SSRF guard: hostname '${hostname}' resolves only to private/internal addresses.`,
        ) as NodeJS.ErrnoException;
        err.code = "ESSRFBLOCKED";
        // The LookupFunction callback signature accepts (err) at minimum.
        (callback as (err: NodeJS.ErrnoException) => void)(err);
        return;
      }
      if (wantAll) {
        (
          callback as (err: null, addresses: LookupAddress[]) => void
        )(null, filtered);
      } else {
        const first = filtered[0]!;
        (
          callback as (
            err: null,
            address: string,
            family: number,
          ) => void
        )(null, first.address, first.family);
      }
    })
    .catch((err: NodeJS.ErrnoException) =>
      (callback as (err: NodeJS.ErrnoException) => void)(err),
    );
};

export const safeOutboundDispatcher: Dispatcher = new Agent({
  connect: {
    lookup: safeConnectLookup,
  },
});
