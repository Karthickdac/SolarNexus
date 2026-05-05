import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  organizationsTable,
  organizationMembershipsTable,
  ORG_ROLES,
  roleAtLeast,
  type OrgRole,
  type DbOrganization,
} from "@workspace/db";
import { findUserBySessionToken } from "./auth-service";
import { extractSessionToken } from "./admin-auth";

export type OrgContext = {
  org: DbOrganization;
  role: OrgRole;
};
// Module augmentation lives in `admin-auth.ts` to avoid duplicate
// declarations across files.

/**
 * Returns middleware that:
 *  1. Authenticates the caller as a logged-in user.
 *  2. Loads the org by `:slug` from the route.
 *  3. Verifies the user is a member with at least `minRole`.
 *  4. Stashes `{org, role}` on `req.orgContext`.
 *
 * Super-admins bypass membership requirements but still need a valid
 * session — they implicitly have `owner` access to every org.
 */
export function requireOrgRole(minRole: OrgRole) {
  return async (req: Request, res: Response, next: NextFunction) => {
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

    const slug = String(req.params.slug ?? "").trim();
    if (!slug) {
      res.status(400).json({ error: "Missing org slug." });
      return;
    }
    const orgs = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.slug, slug))
      .limit(1);
    const org = orgs[0];
    if (!org) {
      res.status(404).json({ error: "Organization not found." });
      return;
    }

    if (user.role === "super-admin") {
      req.orgContext = { org, role: "owner" };
      return next();
    }

    const memberships = await db
      .select()
      .from(organizationMembershipsTable)
      .where(eq(organizationMembershipsTable.orgId, org.id))
      .limit(500);
    const membership = memberships.find((m) => m.userId === user.id);
    if (!membership) {
      res
        .status(403)
        .json({ error: "You are not a member of this organization." });
      return;
    }
    if (!roleAtLeast(membership.role, minRole)) {
      res.status(403).json({
        error: `This action requires at least ${minRole} role; you are ${membership.role}.`,
      });
      return;
    }
    req.orgContext = { org, role: membership.role };
    return next();
  };
}

export const ROLE_OPTIONS = ORG_ROLES;
