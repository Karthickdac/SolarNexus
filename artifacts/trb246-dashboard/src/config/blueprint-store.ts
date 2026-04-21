import { useCallback, useEffect, useState } from "react";
import { siteBlueprint as defaultBlueprint, type SiteBlueprint } from "./site-blueprint";

const STORAGE_KEY = "plantos.site-blueprint.v1";

function loadBlueprint(): SiteBlueprint {
  if (typeof window === "undefined") return defaultBlueprint;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultBlueprint;
    const parsed = JSON.parse(raw) as SiteBlueprint;
    if (!parsed.strings || !parsed.inverters || !parsed.zones) return defaultBlueprint;
    return parsed;
  } catch {
    return defaultBlueprint;
  }
}

function saveBlueprint(blueprint: SiteBlueprint) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blueprint));
}

export function useBlueprint() {
  const [blueprint, setBlueprintState] = useState<SiteBlueprint>(() => loadBlueprint());

  useEffect(() => {
    saveBlueprint(blueprint);
  }, [blueprint]);

  const setBlueprint = useCallback((next: SiteBlueprint) => setBlueprintState(next), []);
  const resetBlueprint = useCallback(() => setBlueprintState(defaultBlueprint), []);

  return { blueprint, setBlueprint, resetBlueprint };
}

export { defaultBlueprint };
