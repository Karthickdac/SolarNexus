import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];
const isLocalRuntime =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

if (!isLocalRuntime && !process.env.MODBUS_INGEST_TOKEN?.trim()) {
  logger.warn(
    "MODBUS_INGEST_TOKEN is not configured. Device ingest requests will be rejected.",
  );
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
