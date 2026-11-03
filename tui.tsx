import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createSignal, onCleanup, onMount, Show, For } from "solid-js"
import { Opcompuse } from "./rpc.js"

export default Plugin.define({
  id: "opcompuse.tui",
  setup(context) {
    const rpc = context.client.rpc(Opcompuse)
    const [status, setStatus] = createSignal(null)
    let pollTimer = null

    async function refresh() {
      try { setStatus(await rpc.status({})) } catch {}
    }

    async function setField(patch, label) {
      try {
        const r = await rpc.settingsSet(patch)
        setStatus({ ...(status() || {}), settings: r })
        context.ui.toast.show({ message: label, variant: "success" })
      } catch (e) {
        context.ui.toast.show({ message: `settings failed: ${e && e.message ? e.message : e}`, variant: "error" })
      }
      void refresh()
    }

    async function settingsMenu() {
      const s = status()
      const st = (s && s.settings) || {}
      const opts = [
        { title: `watcher: ${st.watchAlive || false ? "WATCHING" : "off"}`, value: "watch" },
        { title: `targets: ${(st.targets && st.targets.length ? st.targets.join(" | ") : "foreground only")}`, value: "targets" },
        { title: `hud: ${st.hud !== false}`, value: "hud" },
        { title: `memory: ${st.memory !== false}; auto: ${st.memoryAuto !== false}; confirm: ${st.memoryConfirm === true}`, value: "mem" },
        { title: `access: ${st.access || "standard"}`, value: "access" },
        { title: `watchIntervalMs: ${st.watchIntervalMs || 700}`, value: "watchIntervalMs" },
        { title: `burstIntervalMs: ${st.burstIntervalMs || 250}`, value: "burstIntervalMs" },
        { title: `ocrEveryMs: ${st.ocrEveryMs || 3000}`, value: "ocrEveryMs" },
        { title: `interpreterEverySec: ${st.interpreterEverySec || 90}`, value: "interpreterEverySec" },
        { title: `decider: ${st.decider || "(default)"}`, value: "decider" },
        { title: `watcherModel: ${st.watcherModel || "(off)"}`, value: "watcherModel" },
        { title: `conductorModel: ${st.conductorModel || "(session model)"}`, value: "conductorModel" },
      ]
      const pick = await context.ui.dialog.select({
        title: "OPU settings (changes apply instantly)",
        options: opts,
        actions: [{ bind: "ctrl+r", title: "Refresh", side: "right", selection: "none", onTrigger: () => void refresh() }],
      })
      if (!pick) return
      switch (pick) {
        case "watch": {
          const r = await rpc.watch({ command: st.watchAlive ? "off" : "on" })
          context.ui.toast.show({ message: `watcher ${r.text}`, variant: "success" })
          void refresh()
          break
        }
        case "targets": {
          const cur = (st.targets || []).join(", ")
          const ans = await context.ui.dialog.prompt({
            title: "Watch targets",
            placeholder: "re:GitHub, proc:msedge, pid:1234, hwnd:5678, disp:1, disp:all (empty = foreground only)",
          })
          if (ans != null) {
            const list = String(ans).split(",").map((x) => x.trim()).filter(Boolean).slice(0, 8)
            await setField({ targets: list }, `targets: ${list.length ? list.join(" | ") : "foreground only"}`)
          }
          break
        }
        case "hud": await setField({ hud: st.hud === false }, `hud ${st.hud === false ? "on" : "off"}`); break
        case "mem": {
          const choice = await context.ui.dialog.select({
            title: "Apex-memory",
            options: [
              { title: `memory saving: ${st.memory !== false ? "ON" : "OFF"} (toggle)`, value: "memory" },
              { title: `auto-capture after actions: ${st.memoryAuto !== false ? "ON" : "OFF"} (toggle)`, value: "memoryAuto" },
              { title: `confirm before saving: ${st.memoryConfirm === true ? "ON" : "OFF"} (toggle)`, value: "memoryConfirm" },
            ],
          })
          if (choice === "memory") await setField({ memory: st.memory === false }, `memory ${st.memory === false ? "on" : "off"}`)
          if (choice === "memoryAuto") await setField({ memoryAuto: st.memoryAuto === false }, `memoryAuto ${st.memoryAuto === false ? "on" : "off"}`)
          if (choice === "memoryConfirm") await setField({ memoryConfirm: st.memoryConfirm !== true }, `memoryConfirm ${st.memoryConfirm !== true ? "on" : "off"}`)
          break
        }
        case "access": {
          const a = await context.ui.dialog.select({
            title: "Access level",
            current: st.access || "standard",
            options: [
              { title: "minimal - UIA/keyboard only, no pixel ops", value: "minimal" },
              { title: "standard - default", value: "standard" },
              { title: "full - everything", value: "full" },
            ],
          })
          if (a) await setField({ access: a }, `access=${a}`)
          break
        }
        case "watchIntervalMs":
        case "burstIntervalMs":
        case "ocrEveryMs":
        case "interpreterEverySec": {
          const cur = st[pick] || { watchIntervalMs: 700, burstIntervalMs: 250, ocrEveryMs: 3000, interpreterEverySec: 90 }[pick]
          const ans = await context.ui.dialog.prompt({ title: `${pick} (number)`, placeholder: `current: ${cur}` })
          if (ans != null) {
            const n = parseInt(String(ans).trim(), 10)
            if (Number.isFinite(n) && n >= 100) await setField({ [pick]: n }, `${pick}=${n}`)
            else if (String(ans).trim() !== "") context.ui.toast.show({ message: "need a number >= 100", variant: "error" })
          }
          break
        }
        case "decider":
        case "watcherModel":
        case "conductorModel": {
          const ans = await context.ui.dialog.prompt({
            title: `${pick}`,
            placeholder: `providerID/modelID - "providerID/modelID", empty = ${pick === "conductorModel" ? "session model" : "off"}`,
          })
          if (ans != null) await setField({ [pick]: String(ans).trim() }, `${pick}=${String(ans).trim() || "(default)"}`)
          break
        }
      }
      void settingsMenu()
    }

    function SidebarWidget() {
      onMount(() => {
        void refresh()
        pollTimer = setInterval(refresh, 2500)
        onCleanup(() => { if (pollTimer) clearInterval(pollTimer) })
      })
      const s = status()
      const st = (s && s.settings) || {}
      const mode = !s
        ? { text: "connecting...", fg: context.theme.text.muted }
        : s.running
          ? { text: "RUNNING", fg: context.theme.primary }
          : s.watchAlive
            ? { text: "WATCHING", fg: context.theme.success || context.theme.primary }
            : s.stoppedByOpu
              ? { text: "STOPPED", fg: context.theme.error || context.theme.text.muted }
              : { text: "idle", fg: context.theme.text.muted }
      const targets = st.targets && st.targets.length ? st.targets.join(" | ") : "foreground"
      const memCount = s ? `places ${s.memory?.places ?? 0} · apps ${s.memory?.apps ?? 0}` : "..."
      return (
        <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1, gap: 0 }}>
          <text fg={context.theme.text.muted}>__opu (opcompuse)</text>
          <box style={{ flexDirection: "row", gap: 1 }}>
            <text fg={mode.fg}>{`● ${mode.text}`}</text>
            <text fg={context.theme.text.muted}>{s ? `digest ${s.digestAge >= 0 ? `${s.digestAge}ms` : "?"}` : ""}</text>
          </box>
          <text fg={context.theme.text.base}>{`screen: ${s?.currentProcess || "?"} "${(s?.currentWindow || "").slice(0, 40)}"`}</text>
          <text fg={context.theme.text.muted}>{`targets: ${targets}`}</text>
          <text fg={context.theme.text.muted}>{`hud: ${st.hud !== false} · memory: ${st.memory !== false}/${st.memoryAuto !== false}`}</text>
          <text fg={context.theme.text.muted}>{`apex: ${memCount}`}</text>
          <text fg={context.theme.text.muted}>{`/opsettings settings · /opcompuse panel`}</text>
        </box>
      )
    }

    function PanelComponent(props) {
      onMount(() => {
        void refresh()
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            { id: "opcompuse.watch.top", bind: "t", run: async () => {
              const r = await rpc.watch({ command: (status()?.watchAlive ? "off" : "on") })
              context.ui.toast.show({ message: `watcher ${r.text}` })
              void refresh()
            } },
            { id: "opcompuse.stop.top", bind: "x", run: async () => {
              const r = await rpc.stop({})
              context.ui.toast.show({ message: `OPU ${r.text}`, variant: "warning" })
              void refresh()
            } },
            { id: "opcompuse.memory.top", bind: "m", run: async () => {
              const s = status()
              const on = s?.settings?.memory === true
              await setField({ memory: !on }, `apex-memory ${on ? "off" : "on"}`)
            } },
            { id: "opcompuse.hud.top", bind: "h", run: async () => {
              const s = status()
              await setField({ hud: s?.settings?.hud === false }, `hud ${s?.settings?.hud === false ? "on" : "off"}`)
            } },
            { id: "opcompuse.settings.top", bind: "s", run: () => void settingsMenu() },
            { id: "opcompuse.refresh", bind: "r", run: () => void refresh() },
            { id: "opcompuse.close", bind: "escape", run: () => { context.ui.panel.close() } },
          ],
        }))
        return () => {}
      })
      const s = status()
      const dot = s ? (s.watchAlive ? (s.running ? "* WATCHING + RUNNING" : "* WATCHING") : (s.stoppedByOpu ? "x STOPPED" : "o IDLE")) : ".. connecting"
      const age = s ? (s.digestAge >= 0 ? `${s.digestAge}ms` : "?") : "?"
      const st = (s && s.settings) || {}
      return (
        <box style={{ flexDirection: "column", gap: 1, paddingLeft: 1, paddingRight: 1 }}>
          <text fg={context.theme.text.base}>OPCOMPUSE</text>
          <box style={{ flexDirection: "row", gap: 2 }}>
            <text fg={s?.watchAlive ? context.theme.primary : context.theme.text.muted}>{dot}</text>
            <text fg={context.theme.text.muted}>{`digest ${age}`}</text>
          </box>
          <text fg={context.theme.text.base}>{`screen: ${s?.currentProcess || "?"} "${s?.currentWindow || ""}"`}</text>
          <text fg={context.theme.text.muted}>{`targets: ${st.targets && st.targets.length ? st.targets.join(" | ") : "foreground"}`}</text>
          <text fg={context.theme.text.muted}>EVENTS</text>
          <For each={(s?.events || []).slice(-8)}>{(e) => <text fg={context.theme.text.base}>{e}</text>}</For>
          <Show when={!s || (s.events || []).length === 0}>
            <text fg={context.theme.text.muted}>(no events yet)</text>
          </Show>
          <text fg={context.theme.text.muted}>APEX-MEMORY</text>
          <text fg={context.theme.text.base}>{s ? `places ${s.memory?.places ?? 0} / apps ${s.memory?.apps ?? 0}` : "..."}</text>
          <text fg={context.theme.text.muted}>{s ? `memory=${String(s.settings?.memory)} auto=${String(s.settings?.memoryAuto)} confirm=${String(s.settings?.memoryConfirm)}` : ""}</text>
          <text fg={context.theme.text.muted}>{s ? `access=${s.settings?.access} decider=${s.settings?.decider} watcherModel=${String(s.settings?.watcherModel || "off")}` : ""}</text>
          <box style={{ flexDirection: "row", gap: 2 }}>
            <text fg={context.theme.text.muted}>[t] watch</text>
            <text fg={context.theme.text.muted}>[x] STOP</text>
            <text fg={context.theme.text.muted}>[m] memory</text>
            <text fg={context.theme.text.muted}>[h] hud</text>
            <text fg={context.theme.text.muted}>[s] settings</text>
            <text fg={context.theme.text.muted}>[r] refresh</text>
            <text fg={context.theme.text.muted}>[esc] close</text>
          </box>
        </box>
      )
    }

    const unregisterSlot = context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === "opcompuse.watch"}>
          <PanelComponent panel={panel} />
        </Show>
      ),
    })

    const unregisterSidebar = context.ui.slot({
      append: "sidebar.footer",
      render: () => <SidebarWidget />,
    })

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opcompuse.panel",
          title: "Open opcompuse watcher panel",
          group: "opcompuse",
          palette: true,
          slash: { name: "opcompuse" },
          run: () => {
            void refresh()
            context.ui.panel.open("opcompuse.watch")
          },
        },
        {
          id: "opcompuse.settings",
          title: "OPU settings",
          group: "opcompuse",
          palette: true,
          slash: { name: "opsettings" },
          run: () => { void refresh(); void settingsMenu() },
        },
        {
          id: "opcompuse.watch.toggle",
          title: "Toggle opcompuse watcher",
          group: "opcompuse",
          palette: true,
          slash: { name: "opwatch" },
          run: async () => {
            const r = await rpc.watch({ command: (status()?.watchAlive ? "off" : "on") })
            context.ui.toast.show({ message: `watcher ${r.text}` })
            void refresh()
          },
        },
        {
          id: "opcompuse.stop",
          title: "OPU emergency stop",
          group: "opcompuse",
          palette: true,
          slash: { name: "opstop" },
          run: async () => {
            const r = await rpc.stop({})
            context.ui.toast.show({ message: `OPU STOPPED (${r.text})`, variant: "warning" })
            void refresh()
          },
        },
      ],
    }))

    return () => {
      if (pollTimer) clearInterval(pollTimer)
      unregisterSlot()
      unregisterSidebar()
    }
  },
})
