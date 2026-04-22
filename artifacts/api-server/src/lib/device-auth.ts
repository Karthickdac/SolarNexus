import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export const DEVICE_TOKEN_ENV = "MODBUS_INGEST_TOKEN";
export const DEVICE_TOKEN_PREVIOUS_ENV = "MODBUS_INGEST_TOKEN_PREVIOUS";

export type TokenSlot = "current" | "previous";

export type AuthResult =
  | { ok: true; slot: TokenSlot }
  | { ok: false; status: 401 | 503; error: string };

export const extractBearerToken = (
  authorization: string | undefined,
): string | null => {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
};

export const tokensMatch = (candidate: string, expected: string): boolean => {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
};

export const parseTokenList = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
};

export const getAcceptedTokens = (
  env: NodeJS.ProcessEnv = process.env,
): { slot: TokenSlot; token: string }[] => {
  const current = env[DEVICE_TOKEN_ENV]?.trim();
  const previous = parseTokenList(env[DEVICE_TOKEN_PREVIOUS_ENV]);

  const tokens: { slot: TokenSlot; token: string }[] = [];
  const seen = new Set<string>();

  if (current) {
    tokens.push({ slot: "current", token: current });
    seen.add(current);
  }

  for (const token of previous) {
    if (seen.has(token)) continue;
    tokens.push({ slot: "previous", token });
    seen.add(token);
  }

  return tokens;
};

export const authenticateDeviceRequest = (
  req: Pick<Request, "get">,
  env: NodeJS.ProcessEnv = process.env,
): AuthResult => {
  const acceptedTokens = getAcceptedTokens(env);

  if (acceptedTokens.length === 0) {
    return {
      ok: false,
      status: 503,
      error: "Device ingest token is not configured.",
    };
  }

  const providedToken =
    req.get("x-device-key")?.trim() ||
    extractBearerToken(req.get("authorization") ?? undefined);

  if (!providedToken) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized: missing or invalid device token.",
    };
  }

  for (const { slot, token } of acceptedTokens) {
    if (tokensMatch(providedToken, token)) {
      return { ok: true, slot };
    }
  }

  return {
    ok: false,
    status: 401,
    error: "Unauthorized: missing or invalid device token.",
  };
};
