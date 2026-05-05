import { Router, type IRouter } from "express";
import { ORG_ROLES, type OrgRole } from "@workspace/db";
import {
  getInvitationByToken,
  acceptInvitation,
} from "../lib/invitation-service";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Public: fetch the org-name + role for a token so the accept page can
// show context before the user fills the form.
router.get("/invitations/:token", async (req, res, next) => {
  try {
    const summary = await getInvitationByToken(req.params.token ?? "");
    if (!summary) {
      res
        .status(404)
        .json({ error: "This invitation link is invalid or has expired." });
      return;
    }
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

router.post("/invitations/:token/accept", async (req, res, next) => {
  try {
    const name =
      typeof req.body?.name === "string" ? req.body.name : "";
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    const result = await acceptInvitation({
      token: req.params.token ?? "",
      name,
      password,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
      },
    });
  } catch (err) {
    logger.error({ err }, "POST /invitations/:token/accept failed");
    next(err);
  }
});

// Tiny helper exported for the orgs router so it can validate role enum
// without importing zod just for this.
export function isValidOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

export default router;
