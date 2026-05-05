import type { PublicUser } from "../lib/auth-service";
import type { OrgContext } from "../lib/org-context";

declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: PublicUser | null;
      orgContext?: OrgContext;
    }
  }
}

export {};
