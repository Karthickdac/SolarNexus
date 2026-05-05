import { Router, type IRouter } from "express";
import healthRouter from "./health";
import modbusRouter from "./modbus";
import alertsRouter from "./alerts";
import authRouter from "./auth";
import downloadsRouter from "./downloads";
import passwordResetRouter from "./password-reset";
import invitationsRouter from "./invitations";
import orgsRouter from "./orgs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(modbusRouter);
router.use(alertsRouter);
router.use(authRouter);
router.use(downloadsRouter);
router.use(passwordResetRouter);
router.use(invitationsRouter);
router.use(orgsRouter);

export default router;
