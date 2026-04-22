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

const isLocalRuntime = () =>
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

export const requireAdminAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const expected = process.env[ADMIN_TOKEN_ENV]?.trim();
  if (!expected) {
    if (isLocalRuntime()) {
      // In local development (NODE_ENV=development|test) we allow these
      // endpoints without a token so the dashboard works out of the box.
      // The response carries `x-admin-auth: disabled` so it's obvious the
      // gate is open and so dashboard tooling can show a banner. In any
      // other runtime we fail closed below.
      res.setHeader("x-admin-auth", "disabled");
      return next();
    }
    // Fail closed in non-local runtimes: refuse to mutate alerting
    // configuration when the operator has not configured ADMIN_API_TOKEN.
    res.status(503).json({
      error:
        "Admin endpoint unavailable: ADMIN_API_TOKEN is not configured on the server.",
    });
    return;
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
