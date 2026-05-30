---
name: trb246-dashboard build & typecheck quirks
description: Why `tsc` typecheck "fails" but the app is fine, and the env vars Vite build needs, for artifacts/trb246-dashboard.
---

# trb246-dashboard build / typecheck quirks

## `pnpm run typecheck` shows TS6305 errors that are NOT your fault
`tsc -p tsconfig.json` reports `TS6305: Output file '.../lib/api-client-react/dist/index.d.ts' has not been built from source` plus cascading `implicit any` errors across every consumer file.

**Why:** `lib/api-client-react` has `exports: { ".": "./src/index.ts" }` — it ships source directly with **no build step and no dist/**. The dashboard tsconfig lists it as a project `references` entry, so `tsc` expects composite dist output that never exists. The app itself runs through Vite (bundler moduleResolution → resolves the source export directly), so these errors are inert at runtime.

**How to apply:** Treat TS6305 + its downstream `implicit any` as pre-existing infra noise. To validate real correctness, run the Vite build, not `tsc`. Only worry about type errors that survive once types resolve.

## Vite build requires PORT and BASE_PATH env vars
`pnpm run build` (and dev) fail at config load with "PORT environment variable is required" / "BASE_PATH environment variable is required" — vite.config.ts throws if they're unset.

**How to apply:** To run a one-off production build from the shell: `PORT=5000 BASE_PATH=/ pnpm run build`. The workflow injects these automatically; only manual invocations need them.
