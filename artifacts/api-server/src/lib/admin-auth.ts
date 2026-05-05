import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { findUserBySessionToken, type PublicUser } from "./auth-service";

const ADMIN_TOKEN_ENV = "ADMIN_API_TOKEN";
// Module augmentation for `Request.authenticatedUser` / `Request.orgContext`
// lives in `src/types/express.d.ts` so it's loaded by every route file.

const tokensMatch = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

const extractBearer = (header: string | undefined) => {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
};

const isLocalRuntime = () =>
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

/**
 * Returns the bearer/x-admin-token credential supplied with the request,
 * regardless of whether it is the static admin token or a per-user
 * session token. The auth middleware below decides which one wins.
 */
export const extractSessionToken = (req: Request): string | null => {
  const headerToken = req.get("x-admin-token")?.trim();
  if (headerToken) return headerToken;
  return extractBearer(req.get("authorization"));
};

/**
 * Pure user-session gate. Used by `/auth/me`. Resolves the bearer token
 * to a `PublicUser` and rejects with 401 if no valid session exists.
 */
export const requireUserSession = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const token = extractSessionToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing session token." });
    return;
  }
  const user = await findUserBySessionToken(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired session." });
    return;
  }
  req.authenticatedUser = user;
  return next();
};

/**
 * Admin gate used by mutation endpoints. Accepts either:
 *   1. The static `ADMIN_API_TOKEN` (legacy script / CI access), or
 *   2. A per-user session bearer token whose user has `role=super-admin`.
 *
 * In `NODE_ENV=development|test`, when neither `ADMIN_API_TOKEN` is set
 * nor a valid session is supplied, the gate is opened so the dashboard
 * works out of the box. A `x-admin-auth: disabled` header is set so
 * tooling can detect the open gate.
 */
export const requireAdminAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const provided = extractSessionToken(req);
  const expected = process.env[ADMIN_TOKEN_ENV]?.trim();

  // 1. Static admin token match.
  if (provided && expected && tokensMatch(provided, expected)) {
    return next();
  }

  // 2. Per-user session token belonging to a super-admin.
  if (provided) {
    try {
      const user = await findUserBySessionToken(provided);
      if (user && user.role === "super-admin") {
        req.authenticatedUser = user;
        return next();
      }
    } catch {
      // Fall through to the unauthorized response below.
    }
  }

  // 3. Local-dev convenience: if no static token configured AND no
  //    bearer was supplied, leave the gate open so the dashboard works
  //    without setup. If a bearer WAS supplied but did not validate,
  //    we still fail closed with 401 below to make broken tokens
  //    obvious.
  if (!expected && !provided && isLocalRuntime()) {
    res.setHeader("x-admin-auth", "disabled");
    return next();
  }

  if (!expected && !provided) {
    res.status(503).json({
      error:
        "Admin endpoint unavailable: no ADMIN_API_TOKEN and no user session was provided.",
    });
    return;
  }

  res
    .status(401)
    .json({ error: "Unauthorized: missing or invalid admin token." });
};
