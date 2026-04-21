import { Router, type IRouter } from "express";
import healthRouter from "./health";
import modbusRouter from "./modbus";

const router: IRouter = Router();

router.use(healthRouter);
router.use(modbusRouter);

export default router;
