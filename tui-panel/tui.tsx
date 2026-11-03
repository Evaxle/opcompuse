import { Plugin } from "@opencode/plugin/tui"
import { createSignal, onCleanup, onMount, Show, For } from "solid-js"
import { Opcompuse } from "./rpc.js"

export default Plugin.define({
  id: "opcompuse.tui",
  setup(context) {
    const rpc = context.client.rpc(Opcompuse)
    const [status, setStatus] = createSignal(null)
    let poll = null

    async function refresh() {
      try { setStatus(await rpc.status({})) } catch {}
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
              context.ui.toast.show({ message: `OPU ${r || ""}`.trim(), variant: "warning" })
              void refresh()
            } },
            { id: "opcompuse.memory.top", bind: "m", run: async () => {
              const s = status()
              const on = s?.settings?.memory === true
              await rpc.settingsSet({ memory: !on })
              context.ui.toast.show({ message: `apex-memory ${on ? "off" : "on"}` })
              void refresh()
            } },
            { id: "opcompuse.refresh", bind: "r", run: () => void refresh() },
            { id: "opcompuse.close", bind: "escape", run: () => { context.ui.panel.close() } },
          ],
        }))
        return () => {}
      })
      const s = status()
      const dot = s ? (s.watchAlive ? (s.running ? "* WATCHING + RUNNING" : "* WATCHING") : (s.stoppedByOpu ? "x STOPPED" : "o IDLE")) : ".. connecting"
      const age = s ? (s.digestAge >= 0 ? `${s.digestAge}ms` : "?") : "?"
      return (
        <box style={{ flexDirection: "column", gap: 1, paddingLeft: 1, paddingRight: 1 }}>
          <text fg={context.theme.text.base}>OPCOMPUSE</text>
          <box style={{ flexDirection: "row", gap: 2 }}>
            <text fg={s?.watchAlive ? context.theme.primary : context.theme.text.muted}>{dot}</text>
            <text fg={context.theme.text.muted}>{`digest ${age}`}</text>
          </box>
          <text fg={context.theme.text.base}>{`win: ${s?.currentProcess || "?"} "${s?.currentWindow || ""}"`}</text>
          <text fg={context.theme.text.muted}>EVENTS</text>
          <For each={(s?.events || []).slice(-8)}>{(e) => <text fg={context.theme.text.base}>{e}</text>}</For>
          <Show when={!s || (s.events || []).length === 0}>
            <text fg={context.theme.text.muted}>(no events yet)</text>
          </Show>
          <text fg={context.theme.text.muted}>APEX-MEMORY</text>
          <text fg={context.theme.text.base}>
            {s ? `places ${s.memory?.places ?? 0} / apps ${s.memory?.apps ?? 0}` : "..."}
          </text>
          <text fg={context.theme.text.muted}>{s ? `memory=${String(s.settings?.memory)} auto=${String(s.settings?.memoryAuto)} confirm=${String(s.settings?.memoryConfirm)}` : ""}</text>
          <text fg={context.theme.text.muted}>{s ? `access=${s.settings?.access} decider=${s.settings?.decider} watcherModel=${String(s.settings?.watcherModel || "off")}` : ""}</text>
          <box style={{ flexDirection: "row", gap: 2 }}>
            <text fg={context.theme.text.muted}>[t] watch</text>
            <text fg={context.theme.text.muted}>[x] STOP</text>
            <text fg={context.theme.text.muted}>[m] memory</text>
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
      if (poll) clearInterval(poll)
      unregisterSlot()
    }
  },
})
