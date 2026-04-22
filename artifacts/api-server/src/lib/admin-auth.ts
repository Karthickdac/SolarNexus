import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const ADMIN_TOKEN_ENV = "ADMIN_API_TOKEN";

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

export const requireAdminAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const expected = process.env[ADMIN_TOKEN_ENV]?.trim();
  if (!expected) {
    // No admin token configured: allow access in this build but signal in
    // response headers so operators can spot the gap. The startup warning in
    // index.ts also flags this.
    res.setHeader("x-admin-auth", "disabled");
    return next();
  }
  const provided =
    req.get("x-admin-token")?.trim() || extractBearer(req.get("authorization"));
  if (!provided || !tokensMatch(provided, expected)) {
    res
      .status(401)
      .json({ error: "Unauthorized: missing or invalid admin token." });
    return;
  }
  return next();
};
