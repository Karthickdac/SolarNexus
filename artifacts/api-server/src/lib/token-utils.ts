import { createHash, randomBytes } from "node:crypto";

/** Generates a URL-safe random token (hex-encoded). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** SHA-256 hash of a token; what we persist in the database. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
