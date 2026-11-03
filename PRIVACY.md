# OPCOMPUSE Privacy Policy

_Last updated: 2026-11-02_

OPCOMPUSE is an open-source, local-first computer-use plugin for OpenCode. This policy explains exactly what data it touches.

## What OPCOMPUSE stores

- **Screen digests** (active window element tree + OCR text) **while the watcher runs**. These live in a temporary cache folder and are refreshed in place. They are **not** synced, uploaded, or shared.
- **apex-memory** (in `%USERPROFILE%\.local\share\opencode\opcompuse\apex-memory`): a plain folder of desktop knowledge for AI tools to reuse:
  - app names, window titles, and action chains (e.g. `writeline > key "ctrl+s"`)
  - element paths used for known controls
  - file/URL "places" typed during save dialogs
  - your own manual notes saved through `opcompuse_memory save`
  - rolling screen-change event notes from the watcher

## What OPCOMPUSE never stores

- usernames, passwords, PINs, OTP codes, tokens, API keys, authorization headers, credentials of any kind
- the **text you type or the values you fill** through automation (only the bare op chain is remembered, never the payload)
- private login information — saves matching credential-like words are **refused at write time**

## What leaves the machine

- Nothing, unless you explicitly use `opcompuse_decide` or enable `watcherModel`. Those calls send the **text digest of your screen** (no screenshots) to the model provider you configured. Local model providers (LM Studio, KoboldCpp) keep everything on-device.

## Controls

- `opcompuse_settings { action: "set", memory: false }` — disable all memory writes
- `opcompuse_settings { action: "set", memoryAuto: false }` — manual-only memory
- `opcompuse_memory { op: "forget", key: "..." }` / `/opstop` — delete or stop
- Uninstalling removes the plugin; the apex-memory folder remains until you delete it.

## Telemetry

None. OPCOMPUSE phones home never.
