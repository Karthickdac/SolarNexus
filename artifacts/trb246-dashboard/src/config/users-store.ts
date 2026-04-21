import { useCallback, useEffect, useState } from "react";

export type UserRole = "super-admin" | "operator";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  siteIds: string[];
};

const USERS_KEY = "plantos.users.v1";
const CURRENT_USER_KEY = "plantos.current-user.v1";

const DEFAULT_USERS: AppUser[] = [
  {
    id: "user-admin",
    name: "Super Admin",
    email: "admin@plantos.io",
    role: "super-admin",
    siteIds: [],
  },
];

function loadUsers(): AppUser[] {
  if (typeof window === "undefined") return DEFAULT_USERS;
  try {
    const raw = window.localStorage.getItem(USERS_KEY);
    if (!raw) return DEFAULT_USERS;
    const parsed = JSON.parse(raw) as AppUser[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_USERS;
    return parsed;
  } catch {
    return DEFAULT_USERS;
  }
}

function loadCurrentUserId(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(CURRENT_USER_KEY) ?? fallback;
}

export function useUsers() {
  const [users, setUsersState] = useState<AppUser[]>(() => loadUsers());
  const [currentUserId, setCurrentUserIdState] = useState<string>(() =>
    loadCurrentUserId(loadUsers()[0]?.id ?? DEFAULT_USERS[0].id),
  );

  useEffect(() => {
    window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    window.localStorage.setItem(CURRENT_USER_KEY, currentUserId);
  }, [currentUserId]);

  useEffect(() => {
    if (!users.some((user) => user.id === currentUserId) && users[0]) {
      setCurrentUserIdState(users[0].id);
    }
  }, [users, currentUserId]);

  const currentUser = users.find((user) => user.id === currentUserId) ?? users[0] ?? null;

  const setCurrentUserId = useCallback((id: string) => setCurrentUserIdState(id), []);

  const addUser = useCallback((user: Omit<AppUser, "id"> & { id?: string }) => {
    const id = user.id ?? `user-${Date.now().toString(36)}`;
    setUsersState((prev) => [...prev, { ...user, id }]);
    return id;
  }, []);

  const updateUser = useCallback((id: string, patch: Partial<AppUser>) => {
    setUsersState((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const deleteUser = useCallback((id: string) => {
    setUsersState((prev) => {
      const remaining = prev.filter((item) => item.id !== id);
      if (remaining.some((u) => u.role === "super-admin")) return remaining;
      return prev;
    });
  }, []);

  return { users, currentUser, currentUserId, setCurrentUserId, addUser, updateUser, deleteUser };
}
