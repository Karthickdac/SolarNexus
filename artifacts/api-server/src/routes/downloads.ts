import { Router, type IRouter } from "express";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Resolve the Agent_relay Windows build that publish.sh emits. We try a
// couple of well-known locations so the route works both in the dev
// monorepo (run from artifacts/api-server) and in a deployed bundle
// where the file is copied alongside the server.
const CANDIDATE_PATHS = [
  resolve(process.cwd(), "../../clients/agent-relay/dist/AgentRelay-win-x64.zip"),
  resolve(process.cwd(), "clients/agent-relay/dist/AgentRelay-win-x64.zip"),
  resolve(process.cwd(), "downloads/AgentRelay-win-x64.zip"),
];

function findBuild(): string | null {
  for (const p of CANDIDATE_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

router.get("/downloads/agent-relay", (_req, res) => {
  const filePath = findBuild();
  if (!filePath) {
    logger.warn(
      { tried: CANDIDATE_PATHS },
      "Agent_relay build not found on disk",
    );
    res.status(404).json({
      error:
        "Agent_relay build not available. Run clients/agent-relay/publish.sh to generate it.",
    });
    return;
  }
  const stat = statSync(filePath);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="AgentRelay-win-x64.zip"',
  );
  res.setHeader("Content-Length", String(stat.size));
  res.sendFile(filePath);
});

router.get("/downloads/agent-relay/info", (_req, res) => {
  const filePath = findBuild();
  if (!filePath) {
    res.json({ available: false });
    return;
  }
  const stat = statSync(filePath);
  res.json({
    available: true,
    sizeBytes: stat.size,
    builtAt: stat.mtime.toISOString(),
    filename: "AgentRelay-win-x64.zip",
  });
});

export default router;
