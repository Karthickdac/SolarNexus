// PM2 process definition for the SolarNexus API.
//
// The API server reads process.env directly (no dotenv at runtime), so this
// file loads the repo-root .env itself and injects it into the process env.
// That means `pm2 start ecosystem.config.cjs` works without manually sourcing
// .env first (and without relying on --update-env, which only refreshes from
// the current shell, NOT from a file).

const fs = require("node:fs");
const path = require("node:path");

const appRoot = __dirname;

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, "utf8");
  for (const rawLine of text.split("\n")) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

const fileEnv = parseEnvFile(path.join(appRoot, ".env"));

module.exports = {
  apps: [
    {
      name: "solarnexus-api",
      script: "./dist/index.mjs",
      cwd: path.join(appRoot, "artifacts/api-server"),
      node_args: "--enable-source-maps",
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: "8080",
        ...fileEnv,
      },
    },
  ],
};
