import { useCallback, useEffect, useMemo, useState } from "react";
import { siteBlueprint as defaultBlueprint, type SiteBlueprint } from "./site-blueprint";

export type Site = { id: string } & SiteBlueprint;

const SITES_KEY = "plantos.sites.v2";
const CURRENT_SITE_KEY = "plantos.current-site.v2";

const DEFAULT_SITE: Site = { id: "site-default", ...defaultBlueprint };

function loadSites(): Site[] {
  if (typeof window === "undefined") return [DEFAULT_SITE];
  try {
    const raw = window.localStorage.getItem(SITES_KEY);
    if (!raw) return [DEFAULT_SITE];
    const parsed = JSON.parse(raw) as Site[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [DEFAULT_SITE];
    return parsed;
  } catch {
    return [DEFAULT_SITE];
  }
}

function loadCurrentSiteId(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(CURRENT_SITE_KEY) ?? fallback;
}

export function useSites(allowedSiteIds: string[] | "all") {
  const [sites, setSitesState] = useState<Site[]>(() => loadSites());
  const [currentSiteId, setCurrentSiteIdState] = useState<string>(() =>
    loadCurrentSiteId(loadSites()[0]?.id ?? DEFAULT_SITE.id),
  );

  useEffect(() => {
    window.localStorage.setItem(SITES_KEY, JSON.stringify(sites));
  }, [sites]);

  useEffect(() => {
    window.localStorage.setItem(CURRENT_SITE_KEY, currentSiteId);
  }, [currentSiteId]);

  const visibleSites = useMemo(() => {
    if (allowedSiteIds === "all") return sites;
    return sites.filter((site) => allowedSiteIds.includes(site.id));
  }, [sites, allowedSiteIds]);

  useEffect(() => {
    if (visibleSites.length === 0) return;
    if (!visibleSites.some((site) => site.id === currentSiteId)) {
      setCurrentSiteIdState(visibleSites[0].id);
    }
  }, [visibleSites, currentSiteId]);

  const currentSite = visibleSites.find((site) => site.id === currentSiteId) ?? visibleSites[0] ?? null;

  const setCurrentSiteId = useCallback((id: string) => setCurrentSiteIdState(id), []);

  const addSite = useCallback((site: Omit<Site, "id"> & { id?: string }) => {
    const id = site.id ?? `site-${Date.now().toString(36)}`;
    setSitesState((prev) => [...prev, { ...site, id }]);
    return id;
  }, []);

  const updateSite = useCallback((id: string, patch: Partial<Site>) => {
    setSitesState((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const deleteSite = useCallback((id: string) => {
    setSitesState((prev) => (prev.length > 1 ? prev.filter((item) => item.id !== id) : prev));
  }, []);

  const setBlueprintForSite = useCallback((id: string, blueprint: SiteBlueprint) => {
    setSitesState((prev) => prev.map((item) => (item.id === id ? { ...item, ...blueprint } : item)));
  }, []);

  return { sites, visibleSites, currentSite, currentSiteId, setCurrentSiteId, addSite, updateSite, deleteSite, setBlueprintForSite };
}
