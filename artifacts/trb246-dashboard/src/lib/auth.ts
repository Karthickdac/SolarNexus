import type { AuthUser } from "@workspace/api-client-react";

const TOKEN_KEY = "solarnexus.sessionToken";
const USER_KEY = "solarnexus.sessionUser";
const EXPIRES_KEY = "solarnexus.sessionExpiresAt";

export function getStoredToken(): string | null {
  try {
    const token = window.localStorage.getItem(TOKEN_KEY);
    const expiresAt = window.localStorage.getItem(EXPIRES_KEY);
    if (!token || !expiresAt) return null;
    if (new Date(expiresAt).getTime() <= Date.now()) {
      clearSession();
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function saveSession(
  token: string,
  expiresAt: string,
  user: AuthUser,
): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(EXPIRES_KEY, expiresAt);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    window.dispatchEvent(new Event("solarnexus:auth-changed"));
  } catch {
    /* ignore quota errors */
  }
}

export function updateStoredUser(user: AuthUser): void {
  try {
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    window.dispatchEvent(new Event("solarnexus:auth-changed"));
  } catch {
    /* ignore quota errors */
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(EXPIRES_KEY);
    window.localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new Event("solarnexus:auth-changed"));
  } catch {
    /* ignore */
  }
}
