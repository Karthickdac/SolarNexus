import { Router, type IRouter } from "express";
import {
  requestPasswordReset,
  confirmPasswordReset,
} from "../lib/password-reset-service";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Always responds 204 to avoid leaking which emails are registered.
router.post("/auth/password-reset/request", async (req, res, next) => {
  try {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim() : "";
    if (email) {
      await requestPasswordReset(email).catch((err) => {
        logger.warn({ err }, "password reset background error");
      });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post("/auth/password-reset/confirm", async (req, res, next) => {
  try {
    const token =
      typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const newPassword =
      typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    const result = await confirmPasswordReset(token, newPassword);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
