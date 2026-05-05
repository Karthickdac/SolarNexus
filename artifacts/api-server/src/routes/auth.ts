import { Router, type IRouter } from "express";
import {
  findUserBySessionToken,
  loginWithPassword,
  revokeSession,
} from "../lib/auth-service";
import { getMembershipsForUser, recordAuditEvent } from "../lib/org-service";
import { extractSessionToken, requireUserSession } from "../lib/admin-auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/auth/login", async (req, res, next) => {
  try {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password) {
      res
        .status(400)
        .json({ error: "Both email and password are required." });
      return;
    }
    const result = await loginWithPassword(
      email,
      password,
      req.get("user-agent") ?? null,
    );
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const memberships = await getMembershipsForUser(result.user.id);
    void recordAuditEvent({
      orgId: memberships[0]?.orgId ?? null,
      actorUserId: result.user.id,
      action: "auth.login",
      targetType: "user",
      targetId: String(result.user.id),
    });
    res.json({
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
        siteIds: result.user.siteIds,
        memberships,
      },
    });
  } catch (err) {
    logger.error({ err }, "POST /auth/login failed");
    next(err);
  }
});

router.get("/auth/me", requireUserSession, async (req, res, next) => {
  try {
    const user = req.authenticatedUser;
    if (!user) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }
    const memberships = await getMembershipsForUser(user.id);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        siteIds: user.siteIds,
        memberships,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/auth/logout", async (req, res, next) => {
  try {
    const token = extractSessionToken(req);
    if (token) {
      const user = await findUserBySessionToken(token);
      await revokeSession(token);
      if (user) {
        const memberships = await getMembershipsForUser(user.id);
        void recordAuditEvent({
          orgId: memberships[0]?.orgId ?? null,
          actorUserId: user.id,
          action: "auth.logout",
          targetType: "user",
          targetId: String(user.id),
        });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Compatibility helper for the desktop client: lets it confirm the API
// is reachable AND that the configured token is still valid in one call.
router.get("/auth/ping", async (req, res, next) => {
  try {
    const token = extractSessionToken(req);
    const user = token ? await findUserBySessionToken(token) : null;
    res.json({
      reachable: true,
      authenticated: !!user,
      user: user
        ? {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            siteIds: user.siteIds,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
