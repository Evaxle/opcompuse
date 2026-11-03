# OPCOMPUSE

**The fast, cheap, memory-smart computer-use plugin for OpenCode (Windows).**

![logo](logo.png)

Say `use opu` in OpenCode and the plugin reads your screen with **Windows UI
Automation + built-in OCR** (no screenshots, no vision-model tokens), keeps the
digest hot in a local cache (~1-5 ms reads), batched-acts **and verifies in one
call**, remembers desktop knowledge in compressed **apex-memory** for any AI,
and shows a live always-on-top indicator while working — with an instant STOP.

## Install

1. Run `opcompuse-installer.exe` (GUI wizard: features -> privacy & terms -> install -> done; self-signed, SHA-256 in the release notes).
   - Or CLI: `opcompuse-installer.exe silent` (no prompts), `norestart` flag available, `uninstall` removes it.
2. Start a session and say: **use opu** — or open `/opcompuse` for the watcher panel.

## What you get

- `opcompuse_state` — instant digest of the active window, specific windows, or whole displays (elements / rects / clickable points / OCR / windows list)
- `opcompuse_act` — batched actions (click, type, keys, scrolls, UIA `invoke/select/set/toggle/...`) + built-in post-verification; per-step `hwnd` targeting for background windows
- `opcompuse_find` — element regex search
- `opcompuse_decide` — cheap flash model reads the **text digest** when a screen is ambiguous (~$0.001)
- `opcompuse_memory` — apex-memory: compressed (`OAPX1`+gzip, ~50%), **de-duplicated** desktop knowledge at `%USERPROFILE%\.local\share\opencode\opcompuse\apex-memory`
- `opcompuse_watch` — the watch-ahead cache loop (lazily starts, idle-adaptive **700 ms**, burst-follow to 250 ms on screen change)
- `opcompuse_settings` — runtime toggles: memory, auto-memory, confirm-on-save, access levels, models, intervals, watch targets — hot-reloaded by the watcher and HUD within ~1 s
- `mcp/opu-mcp.mjs` — standalone **MCP server** (stdio): `opu_state`, `opu_act`, `opu_find`, `opu_watch`, `opu_memory`, `opu_settings` for clients outside OpenCode; shares the same settings file that the plugin and HUD live-reload

## Window & display targets

The watcher digests whatever you point it at — the foreground window by default,
or any mix of up to 8 targets (set via `opcompuse_watch {targets:[...]}` or
settings):

- `re:<regex>` / plain text — title regex match, e.g. `re:GitHub.*opcompuse`
- `proc:<name>` — process name fragment, e.g. `proc:msedge`
- `pid:<n>` / `hwnd:<n>` — by process id or window handle
- `disp:<index>` / `disp:primary` / `disp:all` — whole **monitors** (Windows
  screen index): every top-level window on that screen plus full-monitor OCR

Window targets keep full UIA element trees (background windows included);
display targets add a window list + screen-wide OCR. Multi-monitor setups work
natively since everything is addressed in the virtual-screen coordinate space.

## Conductor & watcher models

- `conductorModel` in `opcompuse_settings` switches the current session's model
  live (`providerID/modelID`), e.g. a local LM Studio/KoboldCpp model or
  `opencode-go/glm-5.3-flash`.
- `watcherModel` chooses the cheap model for the 24/7 watcher interpreter;
  `decider` for `opcompuse_decide`.

## Safety

- Always-on-top HUD (`ps/OpuHud.exe`, with a PowerShell fallback `ps/opu-hud.ps1`): `W: WATCHING/STOPPED` + `R: RUNNING xN` rows, live app line, target and display counts
- **STOP button** on the HUD + global hotkey **Ctrl+Alt+Shift+X** + `/opcompuse` panel key `x`
- `opcompuse_act` checks the stop gate before every step
- `access=minimal` disables pixel ops entirely (UIA/keyboard only)

## Privacy

Local-first. No telemetry. Credentials are never stored — saves matching username/password/token/key/email patterns are refused; typed text is never memorized (only the op chain). Full details in [PRIVACY.md](PRIVACY.md); terms in [TERMS.md](TERMS.md).

## Build

- Plugin code: `index.js` (server with inlined RPC contract), `tui-panel/` (parked TUI panel), `ps/*` (UIA/OCR runtime, HUD).
- HUD: `ps/OpuHud.cs` -> `ps/OpuHud.exe` (csc /target:winexe). If Windows Smart
  App Control blocks the built exe, the plugin automatically falls back to
  `ps/opu-hud.ps1`.
- Installer GUI: `opcompuse-installer-src/InstallerGui.cs` -> `opcompuse-installer.exe` via `build.cmd` (csc, embeds `opcompuse.zip` + `logo.png`, icons via `logo.ico`).

## Data layout

- Plugin: `%USERPROFILE%\.opencode\plugins\opcompuse`
- Apex-memory + settings: `%USERPROFILE%\.local\share\opencode\opcompuse\apex-memory`
- Watcher cache: `%TEMP%\opencode\opcompuse`
