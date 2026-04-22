import { Router, type IRouter } from "express";
import healthRouter from "./health";
import modbusRouter from "./modbus";
import alertsRouter from "./alerts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(modbusRouter);
router.use(alertsRouter);

export default router;
