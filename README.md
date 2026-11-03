# OPCOMPUSE. Fast cheap memory-optimized Windows computer use

OPCOMPUSE is an OpenCode plugin that runs on a server and has a TUI part.

OPCOMPUSE replaces screenshot or vision‑model methods with deterministic Windows UI Automation.

OPCOMPUSE provides:

- **Screen digest**: OPCOMPUSE builds an element tree that lists index, role, name, rectangle, clickable point and flags. OPCOMPUSE also uses built‑in WinRT OCR. Tokens for models stay close to zero.

- **Watch‑ahead cache**: OPCOMPUSE runs a watcher loop inside the process. This loop stores the digest on disk. When OPCOMPUSE calls `opcompuse_state` the read takes only **1‑5 milliseconds** due to an idle‑adaptive interval.

- **Batched actions**: OPCOMPUSE offers `opcompuse_act`. This function runs a sequence—clicks, keys, scrolls and UIA commands such as `invoke` `select` or `set`—in one spawn. After the sequence OPCOMPUSE returns the state that follows the actions. In short one call means act and verify.

- ****: OPCOMPUSE stores desktop knowledge in a simple folder. Every model can read this folder.

- **Cheap decider**: OPCOMPUSE runs `opcompuse_decide`. This function asks a flash‑class model. The model uses the TEXT digest, not any screenshots.

- **TUI panel**: When you type `/opcompuse` OPCOMPUSE opens a panel on the right side of the screen. The panel shows status of the watcher events when the screen changes, memory statistics and quick toggles.

## Layout

```

opcompuse/

index.js      server part: tools, hooks, watcher, memory, settings, RPC

tui.tsx       TUI part: /opcompuse right-side session panel

rpc.js        typed server<->TUI contract (status, watch, settings, memory)

ps/opcompuse.lib.ps1    UIA digest. Ocr + native input core

ps/state.ps1            digest entry (-Mode full|quick|find)

ps/act.ps1              batched executor (SendInput + UIA patterns)

ps/watch.ps1            optional standalone daemon loop (not needed normally)

README.md

```

## Data and memory

- Watcher cache files: `%TEMP%\opencode\opcompuse\{alive,state,state}.json`

- **pc‑memory** (durable model‑readable plain folder): OPCOMPUSE stores it at `C:\Users\<you>\.local\share\opencode\opcompuse\pc-memory\`

`Index.md`: OPCOMPUSE auto‑generates a quick reference. Read this first.

`Apps.json`: OPCOMPUSE keeps information per app such as the title and the last successful action chains ( op chains).

`Places.json`: OPCOMPUSE records file or URL places that the user has interacted with.

`Memory-events.md`: OPCOMPUSE logs rolling screen‑change events. May include notes for watcher‑model.

`Settings.json`: OPCOMPUSE mirrors runtime settings.

## Privacy ( rule):

- pc‑memory never stores usernames, passwords, tokens, API keys or private login data. Anything that matches those words is refused at save. Typed text from `opcompuse_act` is never memorized. The op chain (e.g. `Writeline > key ctrl+s`) and safe file paths.

## Speed techniques (the ")

1. OPCOMPUSE reads first from cache: when OPCOMPUSE calls `opcompuse_state` it obtains a hot digest in about **1‑5 milliseconds**.

2. OPCOMPUSE batches actions: a single `opcompuse_act` call handles all steps. It waits between steps and the whole act‑plus‑verify cycle takes roughly **one second**. This stays below the two‑second budget for each decision.

3. OPCOMPUSE works with UI elements not pixels. Commands like `invoke` `set` or `focus` act on the UI model. This approach is deterministic uses no coordinates and does not rely on screenshots.

4. OPCOMPUSE uses memory hints. When digests are created OPCOMPUSE appends lines marked `#MEM` from pc‑memory. This lets repeated tasks skip exploration. OPCOMPUSE also preloads app. Place knowledge from `index.md` before starting longer tasks.

5. OPCOMPUSE’s watcher adapts. While the screen changes it runs at speed. When the screen is idle it slows down.

6. OPCOMPUSE limits OCR usage. OCR is throttled by the setting `ocrEveryMs`. If the element tree already provides the answer OPCOMPUSE skips OCR.

## Controls (toggle in seconds)

- **Runtime**: OPCOMPUSE uses `opcompuse_settings { action: "get" }` to retrieve settings and `{ action: "set"... }` To change them.

- **Config** (`opencode.jsonc`): OPCOMPUSE offers plugin options such, as `memory` `memoryAuto` `memoryConfirm` `access` (values: standard, full) `decider` `watchModel` (or `watcherModel`) `interpreterEverySec` `watchIntervalMs` `ocrEveryMs` and `psEntry`.

- **Panel**: When you type `/opcompuse` OPCOMPUSE opens the right‑side TUI panel. Use t` to toggle the watcher, `m` to toggle memory `r` to refresh and `esc` to close the panel.

Access levels:

- `minimal`. Element and keyboard operations no pixel clicks. This is the mode.

- `standard` (default). All actions except destructive combinations.

- `full`. All actions.

## Fallback

The windows-mcp or the `computer-use` subagent remains available for content such as games, video and remote sessions and for `win`‑key shortcuts.

## Defaults of note

- decider model: `opencode-go/glm-5.3-flash` (~3.3 seconds. Alternatives: `opencode/glm-5.3-flash-(daily free quota) or a local LM Studio / KoboldCpp model for no cost.

- watcher model: **empty, by default**. The watcher runs locally only so watching costs nothing 24/7. Set `watcherModel` to use a model to turn events into memory notes every `interpreterEverySec` seconds.