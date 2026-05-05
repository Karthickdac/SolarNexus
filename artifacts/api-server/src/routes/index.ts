import { Router, type IRouter } from "express";
import healthRouter from "./health";
import modbusRouter from "./modbus";
import alertsRouter from "./alerts";
import authRouter from "./auth";
import downloadsRouter from "./downloads";

const router: IRouter = Router();

router.use(healthRouter);
router.use(modbusRouter);
router.use(alertsRouter);
router.use(authRouter);
router.use(downloadsRouter);

export default router;
