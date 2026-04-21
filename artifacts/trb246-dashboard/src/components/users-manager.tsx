import { useState } from "react";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { AppUser, UserRole } from "../config/users-store";
import type { Site } from "../config/sites-store";

type Props = {
  users: AppUser[];
  sites: Site[];
  currentUserId: string;
  addUser: (user: Omit<AppUser, "id">) => string;
  updateUser: (id: string, patch: Partial<AppUser>) => void;
  deleteUser: (id: string) => void;
};

type Draft = { id?: string; name: string; email: string; role: UserRole; siteIds: string[] };

export function UsersManager({ users, sites, currentUserId, addUser, updateUser, deleteUser }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  function handleCreate() {
    setDraft({ name: "", email: "", role: "operator", siteIds: [] });
    setIsCreating(true);
  }

  function handleEdit(user: AppUser) {
    setDraft({ id: user.id, name: user.name, email: user.email, role: user.role, siteIds: [...user.siteIds] });
    setIsCreating(false);
  }

  function handleSave() {
    if (!draft) return;
    if (!draft.name.trim()) { window.alert("Name is required"); return; }
    if (isCreating) {
      addUser({ name: draft.name, email: draft.email, role: draft.role, siteIds: draft.siteIds });
    } else if (draft.id) {
      updateUser(draft.id, { name: draft.name, email: draft.email, role: draft.role, siteIds: draft.siteIds });
    }
    setDraft(null);
    setIsCreating(false);
  }

  function toggleSite(id: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      siteIds: draft.siteIds.includes(id) ? draft.siteIds.filter((s) => s !== id) : [...draft.siteIds, id],
    });
  }

  function describeSites(user: AppUser) {
    if (user.role === "super-admin") return "All sites";
    if (user.siteIds.length === 0) return "No site access";
    return user.siteIds
      .map((id) => sites.find((s) => s.id === id)?.siteName ?? id)
      .join(", ");
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Users ({users.length})</CardTitle>
        <Button size="sm" onClick={handleCreate}><Plus className="mr-1 h-4 w-4" /> Add User</Button>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {users.map((user) => (
          <div key={user.id} className={`rounded-xl border p-4 ${user.id === currentUserId ? "border-primary" : ""}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 font-semibold">
                  {user.name}
                  {user.id === currentUserId && <Badge>You</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">{user.email}</div>
                <div className="mt-1">
                  <Badge variant={user.role === "super-admin" ? "default" : "outline"}>{user.role}</Badge>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">{describeSites(user)}</div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => handleEdit(user)}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => deleteUser(user.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button>
              </div>
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={draft !== null} onOpenChange={(open) => { if (!open) { setDraft(null); setIsCreating(false); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isCreating ? "Add User" : "Edit User"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div><label className="text-xs font-semibold text-muted-foreground">Name</label><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
                <div><label className="text-xs font-semibold text-muted-foreground">Email</label><Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Role</label>
                  <select className="flex h-9 w-full rounded-md border bg-background px-2" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as UserRole })}>
                    <option value="operator">Operator</option>
                    <option value="super-admin">Super Admin</option>
                  </select>
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-muted-foreground">Site Access {draft.role === "super-admin" && "(super admin has access to all sites)"}</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {sites.map((site) => (
                    <label key={site.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={draft.role === "super-admin"}
                        checked={draft.role === "super-admin" || draft.siteIds.includes(site.id)}
                        onChange={() => toggleSite(site.id)}
                      />
                      <span>{site.siteName}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setDraft(null); setIsCreating(false); }}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
