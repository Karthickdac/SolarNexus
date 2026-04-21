import { useState } from "react";
import { Plus, Pencil, Trash2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { siteBlueprint as defaultBlueprint } from "../config/site-blueprint";
import type { Site } from "../config/sites-store";

type Props = {
  sites: Site[];
  currentSiteId: string;
  setCurrentSiteId: (id: string) => void;
  addSite: (site: Omit<Site, "id">) => string;
  updateSite: (id: string, patch: Partial<Site>) => void;
  deleteSite: (id: string) => void;
};

type SiteDraft = { id?: string; siteName: string; clientName: string; capacityMw: number; location: string };

export function SitesManager({ sites, currentSiteId, setCurrentSiteId, addSite, updateSite, deleteSite }: Props) {
  const [draft, setDraft] = useState<SiteDraft | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  function handleCreate() {
    setDraft({ siteName: `New Site ${sites.length + 1}`, clientName: "Client", capacityMw: 1, location: "" });
    setIsCreating(true);
  }

  function handleEdit(site: Site) {
    setDraft({ id: site.id, siteName: site.siteName, clientName: site.clientName, capacityMw: site.capacityMw, location: site.location });
    setIsCreating(false);
  }

  function handleSave() {
    if (!draft) return;
    if (isCreating) {
      addSite({
        ...defaultBlueprint,
        siteName: draft.siteName,
        clientName: draft.clientName,
        capacityMw: draft.capacityMw,
        location: draft.location,
        zones: [],
        inverters: [],
        strings: [],
      });
    } else if (draft.id) {
      updateSite(draft.id, {
        siteName: draft.siteName,
        clientName: draft.clientName,
        capacityMw: draft.capacityMw,
        location: draft.location,
      });
    }
    setDraft(null);
    setIsCreating(false);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /> Sites ({sites.length})</CardTitle>
        <Button size="sm" onClick={handleCreate}><Plus className="mr-1 h-4 w-4" /> Add Site</Button>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sites.map((site) => (
          <div key={site.id} className={`rounded-xl border p-4 ${site.id === currentSiteId ? "border-primary" : ""}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 font-semibold">{site.siteName}{site.id === currentSiteId && <Badge>Active</Badge>}</div>
                <div className="text-xs text-muted-foreground">{site.clientName}</div>
                <div className="mt-1 text-xs text-muted-foreground">{site.location} • {site.capacityMw} MW</div>
                <div className="mt-1 text-xs text-muted-foreground">{site.inverters.length} inverters • {site.strings.length} strings</div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => handleEdit(site)}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => deleteSite(site.id)} disabled={sites.length <= 1}><Trash2 className="h-4 w-4 text-red-600" /></Button>
              </div>
            </div>
            {site.id !== currentSiteId && (
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setCurrentSiteId(site.id)}>Switch to this site</Button>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={draft !== null} onOpenChange={(open) => { if (!open) { setDraft(null); setIsCreating(false); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isCreating ? "Add Site" : "Edit Site"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="grid gap-3 md:grid-cols-2">
              <div><label className="text-xs font-semibold text-muted-foreground">Site Name</label><Input value={draft.siteName} onChange={(e) => setDraft({ ...draft, siteName: e.target.value })} /></div>
              <div><label className="text-xs font-semibold text-muted-foreground">Client Name</label><Input value={draft.clientName} onChange={(e) => setDraft({ ...draft, clientName: e.target.value })} /></div>
              <div><label className="text-xs font-semibold text-muted-foreground">Capacity (MW)</label><Input type="number" value={draft.capacityMw} onChange={(e) => setDraft({ ...draft, capacityMw: Number(e.target.value) })} /></div>
              <div><label className="text-xs font-semibold text-muted-foreground">Location</label><Input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} /></div>
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
