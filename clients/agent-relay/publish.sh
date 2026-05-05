#!/usr/bin/env bash
# Build self-contained Windows EXEs for the GUI and the Worker Service.
# Output ends up in clients/agent-relay/dist/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"
mkdir -p "$DIST"

echo "==> Restoring solution"
dotnet restore "$ROOT/AgentRelay.sln"

echo "==> Publishing AgentRelay.Gui (WPF) for win-x64"
# NOTE: PublishSingleFile is intentionally NOT used because the .NET 8
# bundler silently skips when cross-publishing WPF from Linux. We instead
# ship the multi-file self-contained directory inside a ZIP — same UX for
# the user (unzip, run AgentRelay.exe), no missing-runtime risk.
dotnet publish "$ROOT/src/AgentRelay.Gui/AgentRelay.Gui.csproj" \
    -c Release -r win-x64 --self-contained true \
    -p:DebugType=embedded --nologo

echo "==> Publishing AgentRelay.Service (worker) for win-x64"
dotnet publish "$ROOT/src/AgentRelay.Service/AgentRelay.Service.csproj" \
    -c Release -r win-x64 --self-contained true \
    -p:DebugType=embedded --nologo

mkdir -p "$DIST/AgentRelay/gui" "$DIST/AgentRelay/service"
cp -r "$ROOT/src/AgentRelay.Gui/bin/Release/net8.0-windows/win-x64/." "$DIST/AgentRelay/gui/"
cp -r "$ROOT/src/AgentRelay.Service/bin/Release/net8.0/win-x64/." "$DIST/AgentRelay/service/"
cp "$ROOT/README.md" "$DIST/AgentRelay/README.md"

(cd "$DIST" && zip -qr AgentRelay-win-x64.zip AgentRelay)

echo "==> Done"
du -sh "$DIST/AgentRelay" "$DIST/AgentRelay-win-x64.zip"
