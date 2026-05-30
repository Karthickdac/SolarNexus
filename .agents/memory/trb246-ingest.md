---
name: TRB246 Modbus ingest quirks
description: Hard-won device-side facts about getting Teltonika TRB246 solar data into the API ingest endpoint
---

# TRB246 → API ingest quirks

## Auth: device cannot send custom headers
The TRB246 "Data to Server" feature does NOT reliably send custom HTTP headers
(e.g. `x-device-key`). Debug logging confirmed the header was absent from the
request entirely.

**Decision:** ingest endpoint also accepts the device token as a URL query
parameter (`token` / `key` / `device_key`), via `extractQueryToken()` in
`device-auth.ts`. Header still takes precedence.
**Why:** it's the only transport the device can reliably populate.
**How to apply:** keep query-token auth; the app's pino serializer already
strips the query string from its own logs. Token-in-URL still leaks to any
upstream proxy/access logs — acceptable tradeoff for this device, HTTPS only.

## Connectivity workaround
TRB246 cellular was dead. Worked around it by sharing a laptop's WiFi internet
via Windows ICS and converting the TRB246 LAN port to WAN ("LAN to WAN") so it
pulls DHCP from the laptop. Not a permanent solution.

## Payload format problem (open)
Device POSTs arrive as `{"ssss":[{"data":"<value>"}]}` — one Modbus request
result per POST, ~9 POSTs per ~10s cycle. The segment name is always `ssss`
(the single data-input name the user configured), so **the payload carries no
register identifier** — you cannot tell which value is voltage vs frequency vs
power. Values seen: scalars (`498`, `0`, `999`), bracketed (`[7960]`,`[1266]`),
comma pairs (`65535,65535` = 0xFFFF unread; `43948,2` = 32-bit lo,hi).

`decodeModbusPayload` expects `payload.registers`, so this format yields
`no_registers` — raw readings are stored but not decoded into metrics.

**Robust fix:** on the TRB246, create one named data-input per register
(e.g. `voltage`, `frequency`) so the JSON key identifies the register. Mapping
by position is fragile (POSTs can drop/reorder). Needs user's register list +
what each represents before wiring the decoder.
