import { Router, type IRouter } from "express";
import healthRouter from "./health";
import modbusRouter from "./modbus";
import alertsRouter from "./alerts";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(modbusRouter);
router.use(alertsRouter);
router.use(authRouter);

export default router;
