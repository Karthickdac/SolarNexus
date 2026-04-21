import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use(
  (
    err: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    if (err instanceof SyntaxError && "body" in err) {
      req.log.warn(
        { error: err.message },
        "Malformed JSON request body",
      );
      res.status(400).json({ error: "Malformed JSON request body." });
      return;
    }

    next(err);
  },
);

export default app;
