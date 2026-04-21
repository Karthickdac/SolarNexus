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

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## API Endpoints

- `GET /api/healthz` — API health check.
- `POST /api/modbus/readings` — receives non-empty JSON payloads from a Teltonika TRB246 / Modbus reader and stores the raw payload with `deviceId`, source, parsing status, and received timestamp. If `deviceId` is omitted, the server falls back to `device`, `imei`, then `trb246`.
- `GET /api/modbus/readings?limit=25` — returns recent stored Modbus reader payloads for verification and future dashboard use.

## Database Tables

- `modbus_readings` — stores raw Modbus/TRB246 HTTP payloads and intake metadata for later decoding and dashboard visualization.

## Rollout Notes

- Apply the database schema in each target environment before sending live TRB246 data to `POST /api/modbus/readings`, otherwise inserts will fail if the `modbus_readings` table is missing.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
