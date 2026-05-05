import { Router, type IRouter } from "express";
import { and, desc, eq, lt } from "drizzle-orm";
import {
  db,
  organizationMembershipsTable,
  usersTable,
  auditLogTable,
  ORG_ROLES,
  type OrgRole,
} from "@workspace/db";
import { requireOrgRole } from "../lib/org-context";
import {
  createInvitation,
  listPendingInvitations,
  revokeInvitation,
} from "../lib/invitation-service";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "../lib/api-key-service";
import {
  checkApiKeyLimit,
  checkMemberLimit,
  getUsageSnapshot,
} from "../lib/usage-limits";
import { recordAuditEvent } from "../lib/org-service";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const isValidRole = (v: unknown): v is OrgRole =>
  typeof v === "string" && (ORG_ROLES as readonly string[]).includes(v);

// ---------------- Members ----------------

router.get(
  "/orgs/:slug/members",
  requireOrgRole("viewer"),
  async (req, res, next) => {
    try {
      const ctx = req.orgContext!;
      const rows = await db
        .select({
          membershipId: organizationMembershipsTable.id,
          userId: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          role: organizationMembershipsTable.role,
          joinedAt: organizationMembershipsTable.createdAt,
        })
        .from(organizationMembershipsTable)
        .innerJoin(
          usersTable,
          eq(usersTable.id, organizationMembershipsTable.userId),
        )
        .where(eq(organizationMembershipsTable.orgId, ctx.org.id))
        .orderBy(desc(organizationMembershipsTable.createdAt));
      res.json({ members: rows });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/orgs/:slug/members/:userId/role",
  requireOrgRole("admin"),
  async (req, res, next) => {
    try {
      const ctx = req.orgContext!;
      const actor = req.authenticatedUser!;
      const targetUserId = Number(req.params.userId);
      const newRole = req.body?.role;
      if (!Number.isFinite(targetUserId) || !isValidRole(newRole)) {
        res.status(400).json({ error: "Invalid user id or role." });
        return;
      }
      // Only owners can grant the owner role.
      if (newRole === "owner" && ctx.role !== "owner") {
        res.status(403).json({ error: "Only owners can grant owner role." });
        return;
      }
      const updated = await db
        .update(organizationMembershipsTable)
        .set({ role: newRole })
        .where(
          and(
            eq(organizationMembershipsTable.orgId, ctx.org.id),
            eq(organizationMembershipsTable.userId, targetUserId),
          ),
        )
        .returning();
      if (!updated[0]) {
        res.status(404).json({ error: "Membership not found." });
        return;
      }
      void recordAuditEvent({
        orgId: ctx.org.id,
        actorUserId: actor.id,
        action: "members.role_changed",
        targetType: "user",
        targetId: String(targetUserId),
        metadata: { newRole },
      });
      res.json({ membership: updated[0] });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/orgs/:slug/members/:userId",
  requireOrgRole("admin"),
  async (req, res, next) => {
    try {
      const ctx = req.orgContext!;
      const actor = req.authenticatedUser!;
      const targetUserId = Number(req.params.userId);
      if (!Number.isFinite(targetUserId)) {
        res.status(400).json({ error: "Invalid user id." });
        return;
      }
      if (targetUserId === actor.id) {
        res.status(400).json({ error: "You can't remove yourself." });
        return;
      }
      const removed = await db
        .delete(organizationMembershipsTable)
        .where(
          and(
            eq(organizationMembershipsTable.orgId, ctx.org.id),
            eq(organizationMembershipsTable.userId, targetUserId),
          ),
        )
        .returning();
      if (!removed[0]) {
        res.status(404).json({ error: "Membership not found." });
        return;
      }
      void recordAuditEvent({
        orgId: ctx.org.id,
        actorUserId: actor.id,
        action: "members.removed",
        targetType: "user",
        targetId: String(targetUserId),
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------- Invitations ----------------

router.get(
  "/orgs/:slug/invitations",
  requireOrgRole("admin"),
  async (req, res, next) => {
    try {
      const ctx = req.orgContext!;
      const invites = await listPendingInvitations(ctx.org.id);
      res.json({
        invitations: invites.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          expiresAt: i.expiresAt,
          createdAt: i.createdAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/orgs/:slug/invitations",
  requireOrgRole("admin"),
  async (req, res, next) => {
    try {
      const ctx = req.orgContext!;
      const actor = req.authenticatedUser!;
      const email =
        typeof req.body?.email === "string" ? req.body.email.trim() : "";
      const role = req.body?.role;
      if (!email || !isValidRole(role)) {
        res
          .status(400)
          .json({ error: "Email and a valid role are required." });
        return;
      }
      if (role === "owner" && ctx.role !== "owner") {
        res.status(403).json({ error: "Only owners can invite owners." });
        return;
      }
      const limit = await checkMemberLimit(ctx.org.id);
      if (!limit.ok) {
        res.status(403).json({ error: limit.reason });
        return;
      }
      const result = await createInvitation({
        orgId: ctx.org.id,
        orgName: ctx.org.name,
        email,
        role,
        invitedByUserId: actor.id,
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json({
        ok: true,
        inviteId: result.inviteId,
        mailDispatched: result.mailDispatched,
      });
    } catch (err) {
      logger.error({ err }, "POST /orgs/:slug/invitations failed");
      next(err);
    }
  },
);

router.delete(
  "/orgs/:slug/invitations/:id",
  requireOrgRole("admin"),
  async (req, res, next) => {
    try {
      const ctx = req.orgContext!;
      const actor = req.authenticatedUser!;
      const inviteId = Number(req.params.id);
      if (!Number.isFinite(inviteId)) {
        res.status(400).json({ error: "Invalid invitation id." });
        return;
      }
      const ok = await revokeInvitation(ctx.org.id, inviteId, actor.id);
      if (!ok) {
        res.status(404).json({ error: "Invitation not found." });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------- API Keys ----------------

router.get(
  "/orgs/:slug/api-keys",
  requireOrgRole("admin"),
  async (req, res, next) => {
    try {
      const ctx = req.orgContext!;
      const keys = await listApiKeys(ctx.org.id);
      res.json({
        apiKeys: keys.map((k) => ({
          id: k.id,
          prefix: k.prefix,
          label: k.label,
          createdAt: k.createdAt,
          lastUsedAt: k.lastUsedAt,
          revokedAt: k.revokedAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/orgs/:slug/api-keys",
  requireOrgRole("admin"),
  async (req, res, next) => {
    try {
      const ctx = req.orgContext!;
      const actor = req.authenticatedUser!;
      const label =
        typeof req.body?.label === "string" ? req.body.label.trim() : "";
      if (!label) {
        res.status(400).json({ error: "A label is required." });
        return;
      }
      const limit = await checkApiKeyLimit(ctx.org.id);
      if (!limit.ok) {
        res.status(403).json({ error: limit.reason });
        return;
      }
      const created = await createApiKey({
        orgId: ctx.org.id,
        label,
        createdByUserId: actor.id,
      });
      res.json({ apiKey: created });
    } catch (err) {
      logger.error({ err }, "POST /orgs/:slug/api-keys failed");
      next(err);
    }
  },
);

router.delete(
  "/orgs/:slug/api-keys/:id",
  requireOrgRole("admin"),
  async (req, res, next) => {
    try {
      const ctx = req.orgContext!;
      const actor = req.authenticatedUser!;
      const keyId = Number(req.params.id);
      if (!Number.isFinite(keyId)) {
        res.status(400).json({ error: "Invalid key id." });
        return;
      }
      const ok = await revokeApiKey({
        orgId: ctx.org.id,
        keyId,
        actorUserId: actor.id,
      });
      if (!ok) {
        res.status(404).json({ error: "API key not found." });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------- Audit log ----------------

router.get(
  "/orgs/:slug/audit-log",
  requireOrgRole("admin"),
  async (req, res, next) => {
    try {
      const ctx = req.orgContext!;
      const limit = Math.min(
        Math.max(Number(req.query.limit ?? 100), 1) || 100,
        500,
      );
      const beforeId = Number(req.query.beforeId ?? 0);
      const filters = [eq(auditLogTable.orgId, ctx.org.id)];
      if (Number.isFinite(beforeId) && beforeId > 0) {
        filters.push(lt(auditLogTable.id, beforeId));
      }
      const rows = await db
        .select({
          id: auditLogTable.id,
          orgId: auditLogTable.orgId,
          actorUserId: auditLogTable.actorUserId,
          action: auditLogTable.action,
          targetType: auditLogTable.targetType,
          targetId: auditLogTable.targetId,
          metadata: auditLogTable.metadata,
          createdAt: auditLogTable.createdAt,
        })
        .from(auditLogTable)
        .where(and(...filters))
        .orderBy(desc(auditLogTable.id))
        .limit(limit);

      // Hydrate actor email/name in a single follow-up query.
      const actorIds = Array.from(
        new Set(
          rows
            .map((r) => r.actorUserId)
            .filter((v): v is number => typeof v === "number"),
        ),
      );
      const actors = actorIds.length
        ? await db
            .select({
              id: usersTable.id,
              email: usersTable.email,
              name: usersTable.name,
            })
            .from(usersTable)
        : [];
      const actorMap = new Map(actors.map((a) => [a.id, a]));
      res.json({
        events: rows.map((r) => ({
          ...r,
          actor: r.actorUserId != null ? actorMap.get(r.actorUserId) ?? null : null,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------- Usage ----------------

router.get(
  "/orgs/:slug/usage",
  requireOrgRole("viewer"),
  async (req, res, next) => {
    try {
      const ctx = req.orgContext!;
      const usage = await getUsageSnapshot(ctx.org.id);
      res.json(usage);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
