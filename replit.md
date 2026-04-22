# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Dashboard**: React + Vite, Recharts, TanStack Table, React Query

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/api-server run test:decoder` — run Modbus decoder unit coverage
- `pnpm --filter @workspace/api-server run test:ingestion` — verify Modbus ingestion through the running API
- `pnpm --filter @workspace/trb246-dashboard run dev` — run the TRB246 dashboard locally

## Artifacts

- `artifacts/api-server` — Express API server mounted at `/api`.
- `artifacts/trb246-dashboard` — TRB246 Modbus monitoring dashboard and report UI mounted at `/`.

## API Endpoints

- `GET /api/healthz` — API health check.
- `POST /api/modbus/readings` — receives non-empty JSON payloads from a Teltonika TRB246 / Modbus reader and stores the raw payload with `deviceId`, source, parsing status, decoded values, and received timestamp. Requires the shared device token from `MODBUS_INGEST_TOKEN` via `x-device-key` or `Authorization: Bearer <token>`. If `deviceId` is omitted, the server falls back to `device`, `imei`, then `trb246`.
- `GET /api/modbus/readings?limit=25` — returns recent stored Modbus reader payloads plus decoded register values for verification and dashboard visualization.

## Database Tables

- `modbus_readings` — stores raw Modbus/TRB246 HTTP payloads, intake metadata, and decoded register values. Unknown or invalid registers are retained in `decoded_values.registers` with explicit status/error details.

## Dashboard Notes

- The dashboard reads from `GET /api/modbus/readings` through generated React Query hooks.
- Seed test readings use `source = 'sample-trb246'` and include two devices: `TRB246-GATEWAY-01` and `TRB246-GATEWAY-02`.
- The dashboard parses `rawPayload.values`, `rawPayload.registers`, and stored decoded values defensively for temperature, voltage, current, power, energy, RSSI, signal quality, relay, and uptime metrics.
- `artifacts/trb246-dashboard/src/config/site-blueprint.ts` drives the enterprise plant simulation. Replace this file per client site to map zones, inverters, strings, positions, gateway IDs, MPPT labels, expected output, and live status thresholds.
- The plant console now includes sidebar navigation, overview/simulation/analytics/report/config views, and a visual blueprint simulation where strings/inverters render green for healthy telemetry, amber for review states, and red for stale, missing, invalid, weak, or low-output telemetry.
- Dashboard metric mapping is centralized in `artifacts/trb246-dashboard/src/pages/dashboard.tsx` as `METRIC_DEFINITIONS`, covering provided value aliases, decoded register names, and fallback register addresses.

## Configuration

- `TRB246_REGISTER_MAP_JSON` — optional JSON object for overriding or adding register definitions without code changes. Each key is a register address and each value includes `name`, `unit`, `kind` (`number` or `boolean`), optional `scale`, and optional `labels`.
- `MODBUS_INGEST_TOKEN` — required shared secret for the TRB246/device ingest endpoint. Store it as an environment secret, never in source code.
- `MODBUS_INGEST_TOKEN_PREVIOUS` — optional, comma-separated list of previously valid device tokens still accepted during a rotation window. Unset once all devices have been migrated.

## Device Token Rotation

The ingest endpoint accepts the current `MODBUS_INGEST_TOKEN` plus any comma-separated tokens in `MODBUS_INGEST_TOKEN_PREVIOUS`, so admins can rotate without dropping device traffic. Recommended workflow:

1. **Generate a new token** (e.g. `openssl rand -hex 32`).
2. **Stage the rotation:** copy the existing `MODBUS_INGEST_TOKEN` value into `MODBUS_INGEST_TOKEN_PREVIOUS` (append to existing comma-separated list if needed), then set `MODBUS_INGEST_TOKEN` to the new value. Restart the API workflow so the new env vars take effect. Both tokens are now accepted.
3. **Migrate devices:** update each TRB246/Modbus reader to send the new token in `x-device-key` (or `Authorization: Bearer ...`). Migrated devices keep ingesting through the new token; not-yet-migrated devices keep working through the previous token.
4. **Confirm migration:** watch the API server logs for the warning `authenticated with a previous (rotating) device token`. When no such warnings appear for a full reporting interval (e.g. 24 hours), every device has switched.
5. **Retire the old token:** remove the rotated-out value from `MODBUS_INGEST_TOKEN_PREVIOUS` (or unset the variable entirely) and restart the API workflow. Old token is now rejected with `401`.

If a token is suspected to be compromised, you can skip step 2's grace period by rotating `MODBUS_INGEST_TOKEN` immediately and leaving `MODBUS_INGEST_TOKEN_PREVIOUS` unset; non-migrated devices will fail until updated.

## Rollout Notes

- Apply the database schema in each target environment before deploying this API version or sending live TRB246 data, otherwise reads/writes can fail if the `modbus_readings` table or `decoded_values` column is missing.
- Development currently includes sample TRB246 readings for dashboard/report visualization; production deployments should seed or ingest real readings separately.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
