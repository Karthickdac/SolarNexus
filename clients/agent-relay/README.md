# Agent Relay

A configurable Windows desktop client + Windows Service for the SolarNexus
TRB246 platform.

It does two things:

1. **Pulls** historical readings, alerts, and configuration from the central
   API server through a per-user authenticated session.
2. **Relays** local Modbus/TCP register reads up to the same server using a
   shared device-ingest token.

The same compiled binary can run interactively (the WPF GUI) or as a
Windows Service in the background.

## Solution layout

```
clients/agent-relay/
├── AgentRelay.sln
├── publish.sh                       # cross-publish from Linux
├── dist/                            # output of publish.sh
└── src/
    ├── AgentRelay.Core/             # netstandard-style class lib
    │   ├── Models.cs                # API DTOs
    │   ├── AppSettings.cs           # %APPDATA%\AgentRelay\settings.json
    │   ├── ApiClient.cs             # REST client (login, readings, alerts…)
    │   ├── CsvExporter.cs           # CSV/Excel export
    │   └── ModbusRelay.cs           # poll + push loop (NModbus)
    ├── AgentRelay.Gui/              # WPF (net8.0-windows)
    │   ├── App.xaml(.cs)
    │   └── Views/
    │       ├── LoginWindow.xaml(.cs)
    │       └── MainWindow.xaml(.cs) # Dashboard / Readings / Alerts /
    │                                # Sites / Devices / Modbus / Settings
    └── AgentRelay.Service/          # Worker Service host
        └── Program.cs               # AddWindowsService + RelayWorker
```

## Building

From the project root:

```bash
clients/agent-relay/publish.sh
```

This produces:

* `dist/AgentRelay.exe` — the GUI (WPF, single-file, self-contained ~70MB)
* `dist/AgentRelay.Service.exe` — the background worker

Both are unsigned. The user accepted this for now; signing is a Phase 2 task.

## Default credentials

The API server seeds a super-admin on first boot:

| Variable | Default in `NODE_ENV=development` |
|----------|-----------------------------------|
| `DEFAULT_ADMIN_EMAIL` | `admin@local.dev` |
| `DEFAULT_ADMIN_PASSWORD` | `password123` |

Override these in production by setting the environment variables before
the API server starts. The seeder is idempotent — it never overwrites an
existing user's password.

## Installing as a Windows Service

After running `publish.sh`, copy `dist/AgentRelay.Service.exe` somewhere
permanent on the client machine (e.g. `C:\Program Files\AgentRelay\`) and
register it from an elevated command prompt:

```cmd
sc.exe create AgentRelaySvc binPath= "C:\Program Files\AgentRelay\AgentRelay.Service.exe" start= auto
sc.exe start AgentRelaySvc
```

The service reads the same `%APPDATA%\AgentRelay\settings.json` that the
GUI writes, so configure once and the service picks it up.

## Phase scope

**Shipped in Phase 1 (this commit):**

* Server-side username / password auth (`/auth/login`, `/auth/me`,
  `/auth/logout`, `/auth/ping`) — `users` and `user_sessions` tables,
  scrypt password hashes, super-admin role accepted by the existing
  `requireAdminAuth` middleware.
* WPF GUI: login, dashboard with reachability + live tail, readings list
  with CSV export, alerts with acknowledge, site thresholds editor,
  device→site assignments editor, local Modbus device list, settings
  (API URL, ingest token, log level).
* Worker Service skeleton wired to the same `AppSettings` + `ModbusRelay`.
* Cross-built single-file `AgentRelay.exe` from Linux.

**Deferred to Phase 2:**

* Modbus RTU (serial) transport — only TCP is wired today.
* MSI/NSIS installer and code signing.
* Migrating the React dashboard from its localStorage user store to the
  new `/auth/login` endpoint (currently a follow-up task).
* Per-register decoding UI — registers are stored in `settings.json` but
  the GUI does not yet expose an editor for them.
* Per-event alert acknowledge — the server endpoint isn't built yet, so
  the GUI's "Acknowledge selected" button is intentionally disabled.
* Hashing session tokens at rest in the `user_sessions` table.

## Where settings live

Both the GUI and the Windows Service read and write the same JSON file:

* Windows: `C:\ProgramData\AgentRelay\settings.json`
* Linux (dev): `/var/lib/AgentRelay/settings.json`

`ProgramData` is used (rather than per-user `%APPDATA%`) so that the
service running as `LocalSystem` shares configuration with the GUI
running as the signed-in user. If you need to lock down edits to
admins, restrict NTFS ACLs on that folder.
