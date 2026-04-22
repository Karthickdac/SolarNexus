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

const hasCurrentToken = !!process.env.MODBUS_INGEST_TOKEN?.trim();
const hasPreviousToken = !!process.env.MODBUS_INGEST_TOKEN_PREVIOUS?.trim();

if (!isLocalRuntime && !hasCurrentToken) {
  if (hasPreviousToken) {
    logger.warn(
      "MODBUS_INGEST_TOKEN is not configured, but MODBUS_INGEST_TOKEN_PREVIOUS is set. Device ingest requests are still accepted via the previous token(s); set a new MODBUS_INGEST_TOKEN to complete rotation before retiring the previous one.",
    );
  } else {
    logger.warn(
      "MODBUS_INGEST_TOKEN is not configured. Device ingest requests will be rejected.",
    );
  }
}

if (hasPreviousToken) {
  logger.warn(
    "MODBUS_INGEST_TOKEN_PREVIOUS is set. Previous device tokens are still accepted during rotation. Unset this variable once all devices have been migrated to MODBUS_INGEST_TOKEN.",
  );
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
