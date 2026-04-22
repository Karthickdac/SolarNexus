// Minimal ESM loader hook used by the api-server test suite so that local
// `node --test` runs can import workspace source modules that rely on
// directory imports (e.g. `import * as schema from "./schema"`) and on
// extensionless TypeScript imports (e.g. `import "./logger"`). Production
// builds use esbuild which already handles both, so this loader exists only
// to keep the source ergonomics intact while still letting node resolve them
// for fast, build-free unit tests.
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const TS_EXTENSIONS = [".ts", ".mts", ".cts"];
const INDEX_FILES = ["index.ts", "index.mts", "index.js"];

const fileExists = async (filePath) => {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
};

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err && err.code === "ERR_UNSUPPORTED_DIR_IMPORT" && err.url) {
      const dirPath = fileURLToPath(err.url);
      for (const candidate of INDEX_FILES) {
        if (await fileExists(`${dirPath}/${candidate}`)) {
          return nextResolve(`${specifier}/${candidate}`, context);
        }
      }
    }
    if (
      err &&
      err.code === "ERR_MODULE_NOT_FOUND" &&
      !specifier.startsWith("node:")
    ) {
      for (const ext of TS_EXTENSIONS) {
        try {
          return await nextResolve(specifier + ext, context);
        } catch {
          /* keep trying */
        }
      }
    }
    throw err;
  }
}
