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
- `pnpm --filter @workspace/trb246-dashboard run test` — run the dashboard state tests (Vitest + React Testing Library, jsdom)

## Artifacts

- `artifacts/api-server` — Express API server mounted at `/api`.
- `artifacts/trb246-dashboard` — TRB246 Modbus monitoring dashboard and report UI mounted at `/`.

## API Endpoints

- `GET /api/healthz` — API health check.
- `POST /api/modbus/readings` — receives non-empty JSON payloads from a Teltonika TRB246 / Modbus reader and stores the raw payload with `deviceId`, source, parsing status, decoded values, and received timestamp. Requires the shared device token from `MODBUS_INGEST_TOKEN` via `x-device-key` or `Authorization: Bearer <token>`. If `deviceId` is omitted, the server falls back to `device`, `imei`, then `trb246`.
- `GET /api/modbus/readings?limit=25` — returns recent stored Modbus reader payloads plus decoded register values for verification and dashboard visualization.
- `GET /api/alerts/preferences` / `PUT /api/alerts/preferences` — read or update the global stale-device notification preferences (enabled flag, threshold, repeat cooldown, per-channel config for in-app feed, webhook URL, email).
- `GET /api/alerts/events?limit=50&since=ISO` — list recent stale-device alert events with per-channel dispatch results.
- `POST /api/alerts/test` — dispatch a synthetic alert through the currently configured channels (useful for verifying webhook/email setup).
- `POST /api/alerts/evaluate` — run the staleness evaluator immediately instead of waiting for the next 60-second tick.

## Database Tables

- `modbus_readings` — stores raw Modbus/TRB246 HTTP payloads, intake metadata, and decoded register values. Unknown or invalid registers are retained in `decoded_values.registers` with explicit status/error details.
- `notification_settings` — single global row (`scope = 'global'`) holding the staleness threshold, repeat cooldown, master enabled flag, and per-channel config (in-app, webhook, email).
- `device_alert_events` — append-only log of stale-device alerts with severity (`warning`/`fault`/`resolved`), how long the device had been silent, the threshold used, the user-facing message, and the per-channel dispatch result (`delivered`/`skipped`/`failed`).

## Dashboard Notes

- The dashboard reads from `GET /api/modbus/readings` through generated React Query hooks.
- Seed test readings use `source = 'sample-trb246'` and include two devices: `TRB246-GATEWAY-01` and `TRB246-GATEWAY-02`.
- The dashboard parses `rawPayload.values`, `rawPayload.registers`, and stored decoded values defensively for temperature, voltage, current, power, energy, RSSI, signal quality, relay, and uptime metrics.
- `artifacts/trb246-dashboard/src/config/site-blueprint.ts` drives the enterprise plant simulation. Replace this file per client site to map zones, inverters, strings, positions, gateway IDs, MPPT labels, expected output, and live status thresholds.
- The plant console now includes sidebar navigation, overview/simulation/analytics/report/config views, and a visual blueprint simulation where strings/inverters render green for healthy telemetry, amber for review states, and red for stale, missing, invalid, weak, or low-output telemetry.
- Dashboard metric mapping is centralized in `artifacts/trb246-dashboard/src/pages/dashboard.tsx` as `METRIC_DEFINITIONS`, covering provided value aliases, decoded register names, and fallback register addresses.
- The dashboard exposes a configurable "Warn when stale after" threshold (default 30 minutes, persisted in `localStorage` under `solarnexus.staleness-threshold-minutes.v1`). When a device's most recent payload exceeds this threshold its string status drops from healthy to warning (amber) and a banner lists the silent devices; if the gap exceeds 3× the threshold the status escalates to fault (red). The threshold control and explanation are surfaced in the dashboard filter card.

## Configuration

- `TRB246_REGISTER_MAP_JSON` — optional JSON object for overriding or adding register definitions without code changes. Each key is a register address and each value includes `name`, `unit`, `kind` (`number` or `boolean`), optional `scale`, and optional `labels`.
- `MODBUS_INGEST_TOKEN` — required shared secret for the TRB246/device ingest endpoint. Store it as an environment secret, never in source code.
- `MODBUS_INGEST_TOKEN_PREVIOUS` — optional, comma-separated list of previously valid device tokens still accepted during a rotation window. Unset once all devices have been migrated.
- `SMTP_HOST` — optional. When set, future builds may use it to send email alerts. The current build records email-channel attempts as `skipped` until an SMTP transport is wired up; webhook delivery is the recommended outbound channel today.
- `ADMIN_API_TOKEN` — shared secret for the alert preference / dispatch / evaluate endpoints. Callers must include it in the `x-admin-token` header (or `Authorization: Bearer <token>`) to mutate notification preferences, send a test alert, or trigger an immediate evaluation. **Behavior by runtime:** in `NODE_ENV=development` or `test`, when the variable is unset the endpoints are open and responses carry `x-admin-auth: disabled` so the dashboard works out of the box. In every other runtime the endpoints fail closed with HTTP 503 until the secret is set, and the API server logs a startup warning. Webhook URLs are independently validated to reject loopback, RFC1918, link-local, IPv6 unique-local (including `::ffff:`-mapped IPv4 and NAT64 forms), `.local`/`.internal` suffix, and `localhost`/cloud-metadata hostnames before any outbound HTTP call. The dashboard reads `VITE_ADMIN_API_TOKEN` at build time and attaches it as a bearer token so the dashboard stays usable once the server-side token is configured.

## Stale-Device Alerts

The API server runs a background staleness monitor every 60 seconds (started from `artifacts/api-server/src/index.ts`). Each tick reads the latest `received_at` per device from `modbus_readings`, compares it to the configured threshold in `notification_settings`, and writes a `device_alert_events` row plus dispatches the configured channels when a device crosses (or recovers from) the threshold. Repeat alerts for the same device are suppressed inside the configured cooldown window so a single outage does not spam recipients.

Channels supported today:
- **In-app** — always recorded; surfaces in the dashboard bell badge and Alerts view.
- **Webhook** — POSTs a JSON body to any URL (Slack/Teams/Discord-compatible incoming webhooks work out of the box). 5-second timeout, recorded as `delivered` / `failed` per attempt.
- **Email** — placeholder; configure `SMTP_HOST` to enable in a future iteration. Currently recorded as `skipped`.

Operators can edit preferences (enabled flag, threshold minutes, cooldown minutes, channels, webhook URL, email recipient) from the Alerts view in the dashboard, and the same view exposes "Send test alert" and "Evaluate devices now" buttons for verification.

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
