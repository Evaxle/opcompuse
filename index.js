import { Plugin, Rpc } from "@opencode/plugin"
import { execFile } from "node:child_process"
import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"

const DEFAULT_DECIDER = "opencode-go/glm-5.3-flash"
const CACHE_FRESH_MS = 3500
const SENSITIVE_RE = /(\bpass(?:word|code|wd)?\s*[:=]|\bpwd\s*[:=]|secret\s*[:=]|\btoken\s*[:=]|api[_-]?key\s*[:=]|apikey\s*[:=]|bearer\s|authorization\s*[:=]|credential|password|passwd|pin code|otp\s|login code|ssn|cvv|credit card|username\s*[:=]|user name\s*[:=]|\bemail\s*[:=])/i
const APEX_MAGIC = Buffer.from("OAPX1")

function findPluginDir() {
  const candidates = []
  try { candidates.push(path.dirname(fileURLToPath(import.meta.url))) } catch {}
  candidates.push("C:\\Users\\esc10\\.opencode\\plugins\\opcompuse")
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, "ps", "opcompuse.lib.ps1"))) return c } catch {}
  }
  return null
}

function apexPack(obj, level = 9) {
  const json = Buffer.from(JSON.stringify(obj), "utf8")
  return Buffer.concat([APEX_MAGIC, zlib.gzipSync(json, { level })])
}

const Opcompuse = Rpc.define({
  id: "opcompuse",
  methods: {
    status: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          watchAlive: { type: "boolean" },
          watchAge: { type: "number" },
          digestAge: { type: "number" },
          running: { type: "boolean" },
          stoppedByOpu: { type: "boolean" },
          currentWindow: { type: "string" },
          currentProcess: { type: "string" },
          events: { type: "array", items: { type: "string" } },
          memory: {
            type: "object",
            properties: {
              places: { type: "number" },
              apps: { type: "number" },
              dir: { type: "string" },
            },
            required: ["places", "apps", "dir"],
            additionalProperties: true,
          },
          settings: { type: "object", additionalProperties: true },
          note: { type: "string" },
        },
        required: ["watchAlive", "watchAge", "digestAge", "running", "stoppedByOpu", "currentWindow", "currentProcess", "events", "memory", "settings", "note"],
        additionalProperties: false,
      },
    },
    stop: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
    watch: {
      input: {
        type: "object",
        properties: { command: { type: "string", enum: ["on", "off", "status"] } },
        required: ["command"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
    settingsGet: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: { type: "object", additionalProperties: true },
    },
    settingsSet: {
      input: { type: "object", additionalProperties: true },
      output: { type: "object", additionalProperties: true },
    },
    memorySummary: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          dir: { type: "string" },
          places: { type: "array", items: { type: "string" } },
          apps: { type: "array", items: { type: "string" } },
        },
        required: ["dir", "places", "apps"],
        additionalProperties: false,
      },
    },
    memorySave: {
      input: {
        type: "object",
        properties: { key: { type: "string" }, value: { type: "string" }, kind: { type: "string", enum: ["place", "app", "note"] } },
        required: ["key", "value"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})
function apexUnpack(buf) {
  if (buf.length <= APEX_MAGIC.length) throw new Error("bad apex blob")
  if (!buf.subarray(0, APEX_MAGIC.length).equals(APEX_MAGIC)) throw new Error("bad apex magic")
  return JSON.parse(zlib.gunzipSync(buf.subarray(APEX_MAGIC.length)).toString("utf8"))
}

function stepsPattern(steps) {
  return steps
    .filter((o) => o.op !== "wait")
    .slice(0, 12)
    .map((o) => (o.op === "write" ? "writeline" : o.op + (o.key ? `"${o.key}"` : "")))
    .join(">")
    .slice(0, 200)
}

export default Plugin.define({
  id: "opcompuse",
  async setup(ctx) {
    const pluginDir = findPluginDir()
    const psDir = path.join(pluginDir || ".", "ps")
    const optsIn = ctx.options || {}

    const stateDir = path.join(process.env.TEMP || path.join(os.homedir(), "AppData", "Local", "Temp"), "opencode", "opcompuse")
    const memoryRoot = path.join(os.homedir(), ".local", "share", "opencode", "opcompuse", "apex-memory")
    const F = {
      places: path.join(memoryRoot, "places.apx"),
      apps: path.join(memoryRoot, "apps.apx"),
      index: path.join(memoryRoot, "apex-index.md"),
      settings: path.join(memoryRoot, "settings.json"),
      events: path.join(memoryRoot, "memory-events.md"),
    }
    const defaults = {
      memory: true,
      memoryAuto: true,
      memoryConfirm: false,
      access: "standard",
      decider: DEFAULT_DECIDER,
      watchIntervalMs: 900,
      ocrEveryMs: 3000,
      watcherModel: "",
      interpreterEverySec: 90,
      psEntry: "",
    }
    let S = { ...defaults, ...optsIn }
    const apexStats = { places: { raw: 0, packed: 0 }, apps: { raw: 0, packed: 0 } }

    try {
      fs.mkdirSync(memoryRoot, { recursive: true })
      const saved = JSON.parse(await fsp.readFile(F.settings, "utf8"))
      if (saved && typeof saved === "object") {
        for (const [k, v] of Object.entries(saved)) {
          if (k in defaults && v != null) S[k] = v
        }
      }
    } catch {}

    async function persistSettings() {
      const pick = {}
      for (const k of Object.keys(defaults)) pick[k] = S[k]
      try { await ctx.storage.set("settings", pick) } catch {}
      try { await atomicWrite(F.settings, JSON.stringify(pick, null, 2)) } catch {}
    }
    void persistSettings()

    const PS = S.psEntry || path.join(process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    function psCall(scriptFile, params = {}, timeoutMs = 15000) {
      const scriptPath = path.join(psDir, scriptFile).replace(/'/g, "''")
      const pairs = Object.entries(params).map(([k, v]) => {
        if (v === true) return `-${k}`
        if (v == null || v === "") return ""
        return `-${k} '${String(v).replace(/'/g, "''")}'`
      }).filter(Boolean)
      const cmd = `& '${scriptPath}' ${pairs.join(" ")}`.trim()
      const enc = Buffer.from(cmd, "utf16le").toString("base64")
      return new Promise((resolve, reject) => {
        execFile(
          PS,
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc],
          { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
          (err, stdout, stderr) => {
            if (err && !String(stdout || "").trim()) {
              return reject(new Error(`${scriptFile}: ${err.message} ${String(stderr || "").slice(0, 400)}`))
            }
            resolve(String(stdout || ""))
          },
        )
      })
    }

    function splitMeta(text, marker = "@opc") {
      const lines = text.split(/\r?\n/)
      const bodyLines = []
      let metaText = ""
      for (const l of lines) {
        if (l.startsWith(`${marker} `)) metaText = l.slice(marker.length + 1)
        else bodyLines.push(l)
      }
      let meta = null
      try { if (metaText) meta = JSON.parse(metaText) } catch {}
      return { body: bodyLines.join("\n").trimEnd(), meta }
    }

    async function atomicWrite(file, content) {
      const tmp = `${file}.tmp${process.pid}`
      try {
        await fsp.writeFile(tmp, content, "utf8")
        try { await fsp.rename(tmp, file) }
        catch { try { await fsp.unlink(file) } catch {}; await fsp.rename(tmp, file).catch(() => {}) }
      } catch {}
    }

    async function apexWrite(file, obj) {
      const raw = JSON.stringify(obj, null, 2)
      const packed = apexPack(obj)
      const stats = apexStats[path.basename(file, ".apx")] || { raw: 0, packed: 0 }
      stats.raw = raw.length
      stats.packed = packed.length
      await atomicWrite(file, packed)
    }
    async function apexRead(file, fallback) {
      try {
        const buf = await fsp.readFile(file)
        const obj = apexUnpack(buf)
        const merged = { ...fallback }
        for (const [k, v] of Object.entries(obj)) merged[k] = v
        return merged
      } catch {
        try {
          return { ...fallback, ...JSON.parse(await fsp.readFile(file.replace(/\.apx$/, ".json"), "utf8")) }
        } catch { return { ...fallback } }
      }
    }

    function scrubBlocked(valueText) {
      return SENSITIVE_RE.test(String(valueText || ""))
    }
    function normalizeKey(key) {
      return String(key || "").trim().slice(0, 80).replace(/[\r\n|]+/g, " ")
    }
    function valuesEqual(a, b) {
      const n = (x) => String(x ?? "").toLowerCase().trim().replace(/[\\/]+/g, "/")
      return n(a) === n(b) && n(a) !== ""
    }
    function findDuplicatedEntry(cur, value) {
      for (const [existingKey, e] of Object.entries(cur)) {
        if (valuesEqual(e?.v ?? e, value)) return { key: existingKey, entry: e }
      }
      return null
    }
    async function memorySave({ key, value, kind = "place" }) {
      if (S.memory !== true) return { ok: false, why: "memory off (opcompuse_settings)" }
      const k = normalizeKey(key)
      const v = String(value ?? "").slice(0, 400)
      if (!k || !v) return { ok: false, why: "empty key/value" }
      if (scrubBlocked(v) || scrubBlocked(k)) return { ok: false, why: "refused: value looks like private login data (never stored)" }
      const file = kind === "app" ? F.apps : F.places
      const cur = await apexRead(file, {})
      if (cur[k] && valuesEqual(cur[k].v, v)) {
        cur[k].hits = (cur[k].hits || 0) + 1
        cur[k].t = Date.now()
        await apexWrite(file, cur)
        return { ok: true, key: k, unchanged: true }
      }
      const dup = findDuplicatedEntry(cur, v)
      if (dup && dup.key !== k) {
        return { ok: false, why: `duplicate info skipped: already stored under key "${dup.key}"` }
      }
      const prevHits = cur[k]?.hits || 0
      cur[k] = { v, t: Date.now(), hits: prevHits }
      await apexWrite(file, cur)
      await regenerateIndex()
      return { ok: true, key: k }
    }
    async function memoryAutoCapture({ process: procName, title, steps, fileHint }) {
      if (S.memory !== true || S.memoryAuto !== true || !procName) return
      try {
        const apps = await apexRead(F.apps, {})
        const key = String(procName).slice(0, 40)
        const label = stepsPattern(steps)
        const entry = apps[key] || { chains: [] }
        entry.flows = [label, ...(entry.flows || [])].filter((c, i, a) => c && a.indexOf(c) === i).slice(0, 8)
        entry.lastFlow = label
        entry.t = String(title || entry.t || "").slice(0, 120)
        entry.time = Date.now()
        apps[key] = entry
        await apexWrite(F.apps, apps)
        if (fileHint && !scrubBlocked(fileHint) && /^[A-Za-z]:\\/.test(String(fileHint))) {
          const places = await apexRead(F.places, {})
          const k2 = path.basename(String(fileHint)).slice(0, 60)
          const existing = findDuplicatedEntry(places, String(fileHint))
          if (existing) {
            places[existing.key] = { ...existing.entry, hits: (existing.entry?.hits || 0) + 1, t: Date.now(), p: existing.entry?.p || key }
          } else {
            places[k2] = { v: String(fileHint), t: Date.now(), p: key }
          }
          await apexWrite(F.places, places)
        }
        await regenerateIndex()
      } catch {}
    }
    async function regenerateIndex() {
      try {
        const [apps, places] = await Promise.all([apexRead(F.apps, {}), apexRead(F.places, {})])
        const appLines = []
        const appSeen = new Set()
        for (const [k, v] of Object.entries(apps)) {
          const sig = String(v?.lastFlow || "") + "|" + String(v?.t || "")
          if (appSeen.has(sig)) continue
          appSeen.add(sig)
          const fl = (v.flows || []).slice(0, 3).map((c) => `    - ${c}`)
          appLines.push([`- **${k}**${v.t ? ` "${v.t}"` : ""}`, ...fl].join("\n"))
        }
        const placeLines = []
        const seenValues = new Set()
        for (const [k, v] of Object.entries(places)) {
          const sig = String(v?.v ?? v ?? "").toLowerCase().trim()
          if (!sig || seenValues.has(sig)) continue
          seenValues.add(sig)
          const hits = v?.hits ? ` (${v.hits}x used)` : ""
          placeLines.push(`- ${k} -> ${v.v}${hits}`)
        }
        const lines = [
          "# apex-memory (opcompuse)",
          "# Plain notes any AI can reference while driving this desktop.",
          "# Privacy: login credentials are never stored here.",
          "",
          `## apps (${appLines.length})`,
          ...appLines.slice(0, 40),
          "",
          `## places (${placeLines.length})`,
          ...placeLines.slice(0, 60),
        ]
        await atomicWrite(F.index, lines.join("\n") + "\n")
      } catch {}
    }
    void regenerateIndex()

    async function memHints(processName) {
      if (S.memory !== true || !processName) return []
      try {
        const apps = await apexRead(F.apps, {})
        const e = apps[String(processName).slice(0, 40)]
        if (!e || !e.lastFlow) return []
        return ["#MEM", `#MEM known app "${processName}" previous successful flow: ${e.lastFlow}`]
      } catch { return [] }
    }

    let watcherTimer = null
    let watcherNextMs = 900
    let prevSig = ""
    let prevWinLine = ""
    let prevFocus = ""
    let lastOcrMs = 0
    const events = []
    let lastInterpreterMs = 0

    async function watcherTick() {
      try {
        const quickRaw = await psCall("state.ps1", { Mode: "quick" }, 9000)
        const q = splitMeta(quickRaw)
        let winLine = ""
        let focusLine = ""
        for (const l of q.body.split(/\r?\n/)) {
          if (l.startsWith("#W ")) winLine = l
          if (l.startsWith("#F ")) focusLine = l
        }
        const sig = q.body
        const meta = q.meta || {}
        meta.watchHeartbeat = true
        meta.watchInterval = S.watchIntervalMs
        await atomicWrite(path.join(stateDir, "alive.json"), JSON.stringify(meta))
        if (sig === prevSig) {
          watcherNextMs = Math.min(2400, S.watchIntervalMs * 2 || 1800)
          try {
            const stPath = path.join(stateDir, "state.json")
            const metaNow = await fsp.readFile(stPath, "utf8").then((j) => JSON.parse(j)).catch(() => null)
            if (metaNow?.t && Date.now() - metaNow.t > CACHE_FRESH_MS) {
              metaNow.t = Date.now()
              metaNow.idleRefresh = true
              await atomicWrite(stPath, JSON.stringify(metaNow))
              const stRaw = await fsp.readFile(path.join(stateDir, "state.txt"), "utf8").catch(() => null)
              if (stRaw) {
                const body = stRaw.split("@opc {")[0].replace(/\s*$/, "")
                await atomicWrite(
                  path.join(stateDir, "state.txt"),
                  `${body}\n@opc ${JSON.stringify(metaNow)}\n#EVENTS --- recent screen changes ---\n${events.slice(-14).join("\n")}`,
                )
              }
            }
          } catch {}
          return
        }
        watcherNextMs = S.watchIntervalMs
        const now = new Date().toLocaleTimeString("en-GB", { hour12: false })
        if (winLine !== prevWinLine) { events.push(`[${now}] window: ${winLine}`); prevWinLine = winLine }
        if (focusLine !== prevFocus) { events.push(`[${now}] focus: ${focusLine}`); prevFocus = focusLine }
        while (events.length > 24) events.shift()
        writeEventsMemory()

        const sinceOcr = Date.now() - lastOcrMs
        const full = await captureFresh("full", { NoOcr: sinceOcr < S.ocrEveryMs })
        if (sinceOcr >= S.ocrEveryMs) lastOcrMs = Date.now()
        const txt = full.body + (full.meta ? `\n@opc ${JSON.stringify(full.meta)}` : "")
        await atomicWrite(
          path.join(stateDir, "state.txt"),
          txt + "\n#EVENTS --- recent screen changes ---\n" + events.slice(-14).join("\n"),
        )
        await atomicWrite(path.join(stateDir, "state.json"), JSON.stringify(full.meta || {}))
        prevSig = sig
        scheduleInterpreter()
      } catch {}
    }

    function writeEventsMemory() {
      if (S.memory !== true) return
      const content =
        `# memory-events (rolling, opcompuse watcher)\n` +
        `# Privacy: no usernames/passwords/tokens/keys. Only window/process transitions.\n\n` +
        events.slice(-60).join("\n") + "\n"
      fsp.writeFile(F.events, content).catch(() => {})
    }

    function scheduleInterpreter() {
      if (!S.watcherModel || S.memory !== true) return
      if (Date.now() - lastInterpreterMs < (S.interpreterEverySec || 90) * 1000) return
      void interpret()
    }

    async function interpret() {
      try {
        const evTail = events.slice(-25).join("\n") || "(no events yet)"
        const raw = await readCachedStateRaw()
        const digestHead = raw ? raw.split("\n").slice(0, 6).join("\n") : ""
        const prompt =
`You are the 24/7 watcher. From the events + digest head write MEMORY CANDIDATES only. Never write usernames/passwords/tokens/keys. Format up to 3 lines: "kind | phrase | note" where kind is info|event|place. Max 30 words total.

EVENTS:
${evTail}

DIGEST HEAD:
${digestHead}`
        lastInterpreterMs = Date.now()
        const modelRef = parseModelRef(S.watcherModel)
        const r = await callGenerate(modelRef, prompt)
        const text = (r.text || "").slice(0, 900)
        if (text) {
          try {
            const prev = await fsp.readFile(F.events, "utf8").catch(() => "")
            await fsp.writeFile(F.events, prev + `\n## interpreted ${new Date().toISOString()}\n${text}\n`)
          } catch {}
        }
      } catch {}
    }

    function parseModelRef(raw) {
      const slash = raw.indexOf("/")
      return slash > 0
        ? { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) }
        : { providerID: raw, modelID: raw }
    }

    function callGenerate(modelRef, prompt) {
      return (ctx.experimental?.generate?.text ?? ctx.generate?.text).call(ctx, {
        model: { providerID: modelRef.providerID, id: modelRef.modelID },
        prompt,
      })
    }

    function startWatcher() {
      if (watcherTimer) return true
      try { fs.mkdirSync(stateDir, { recursive: true }) } catch {}
      try { fs.rmSync(path.join(stateDir, "stop.json"), { force: true }) } catch {}
      startHud()
      let cancelled = false
      const loop = async () => {
        if (cancelled) return
        const stopRequested = fs.existsSync(path.join(stateDir, "stop.json"))
        if (stopRequested) {
          cancelled = true
          watcherTimer = { stop: () => {} }
          return
        }
        await watcherTick()
        if (cancelled) return
        watcherTimer = setTimeout(loop, watcherNextMs)
      }
      void loop()
      watcherTimer = { stop: () => { cancelled = true; clearTimeout(watcherTimer) } }
      return true
    }
    function stopWatcher() {
      if (watcherTimer) {
        if (watcherTimer.stop) watcherTimer.stop()
        watcherTimer = null
      }
    }
    function stopAll() {
      stopWatcher()
      try { fs.writeFileSync(path.join(stateDir, "stop.json"), `{"t":${Date.now()},"by":"rpc"}`, "utf8") } catch {}
      try { fs.writeFileSync(path.join(stateDir, "running.json"), '{"t":0}', "utf8") } catch {}
      return "stopped (watcher + actions blocked until next opcompuse_watch on)"
    }

    let hud = null
    const HUD_FRESH_MS = 5000
    async function startHud() {
      try { fs.mkdirSync(stateDir, { recursive: true }) } catch {}
      const hudPath = path.join(stateDir, "hud.json")
      try {
        const j = JSON.parse(fs.readFileSync(hudPath, "utf8"))
        if (j?.pid && Date.now() - j.t < HUD_FRESH_MS * 8) return true
      } catch {}
      const exe = path.join(psDir, "OpuHud.exe")
      if (fs.existsSync(exe)) {
        const ch = await import("node:child_process").then((m) => m.spawn(exe, [stateDir], { detached: true, stdio: "ignore", windowsHide: true }))
        try { ch.unref() } catch {}
        hud = { kill: () => stopHud() }
        return true
      }
      const script = path.join(psDir, "opu-hud.ps1")
      const inner = `start "" /min "${PS}" -STA -NoProfile -ExecutionPolicy Bypass -File "${script}" -StateDir "${stateDir}"`
      return new Promise((resolve) => {
        execFile("cmd.exe", ["/d", "/c", inner], { timeout: 8000, windowsHide: true }, () => {
          if (!hud) hud = { kill: () => stopHud() }
          resolve(true)
        })
      })
    }
    async function stopHud() {
      try {
        const j = JSON.parse(await fsp.readFile(path.join(stateDir, "hud.json"), "utf8"))
        if (j?.pid) {
          execFile("taskkill", ["/PID", String(j.pid), "/F", "/T"], { windowsHide: true }, () => {})
        }
      } catch {}
      try { fs.rmSync(path.join(stateDir, "hud.json"), { force: true }) } catch {}
      hud = null
    }

    let aliveCache = null
    let aliveCacheAt = 0
    async function watcherAlive() {
      if (aliveCache && Date.now() - aliveCacheAt < 900) return aliveCache
      try {
        const j = JSON.parse(await fsp.readFile(path.join(stateDir, "alive.json"), "utf8"))
        const age = Date.now() - j.t
        aliveCache = { alive: age < 4000, age, meta: j }
      } catch { aliveCache = { alive: false, age: -1, meta: null } }
      aliveCacheAt = Date.now()
      return aliveCache
    }

    async function readCachedStateRaw() {
      try { return await fsp.readFile(path.join(stateDir, "state.txt"), "utf8") } catch { return null }
    }
    async function readCachedState() {
      const raw = await readCachedStateRaw()
      if (!raw) return null
      const { body, meta } = splitMeta(raw)
      const age = meta?.t != null ? Date.now() - meta.t : -1
      return { body, meta, age }
    }
    async function captureFresh(mode = "full", extra = {}) {
      const params = { Mode: mode }
      if (extra.NameRegex) params.NameRegex = extra.NameRegex
      if (extra.FindDepth) params.FindDepth = extra.FindDepth
      if (extra.FindMax) params.FindMax = extra.FindMax
      if (extra.NoOcr) params.NoOcr = true
      const raw = await psCall("state.ps1", params, mode === "quick" ? 8000 : 20000)
      return splitMeta(raw)
    }

    async function smartState({ mode = "full" } = {}) {
      const alive = await watcherAlive()
      if (!alive.alive) {
        if (process.env.OPCOMPUSE_WATCH_OFF !== "1") startWatcher()
        const c = await captureFresh(mode)
        return { body: c.body, meta: c.meta, age: -1, source: "captured (watcher warming up)" }
      }
      const cached = await readCachedState()
      if (cached && cached.age >= 0 && cached.age <= CACHE_FRESH_MS) {
        return { ...cached, source: "watcher cache" }
      }
      const c = await captureFresh(mode)
      return { body: c.body, meta: c.meta, age: -1, source: "captured" }
    }

    function freshnessLabel(age) {
      if (age == null || age < 0) return "unknown"
      if (age <= 250) return "instant"
      return `screen-age ${age}ms`
    }

    async function decide(question, goal, modelOverride) {
      const alive = await watcherAlive()
      let see = await readCachedState()
      if (!see || see.age < 0 || see.age > 6000 || !alive.alive) {
        const c = await captureFresh("quick")
        see = { body: c.body }
      }
      const modelRef = parseModelRef(modelOverride || S.decider || DEFAULT_DECIDER)
      const prompt =
`You are the tactical decider of opcompuse. ONE action.

SCREEN (rows: "index role name aid value rect cp=click [d o k]", "#F" focused, "#O" OCR):
${see.body}

TASK: ${goal || "continue the user's task"}
QUESTION: ${question}

<=45 words, format:
ACTION: <click x,y | key <combo> | writeline | el <index> <invoke|select|focus|set|toggle> | move x,y | wheel <n> | state <what else> | blocked <why>
WHY: <short>`
      const t0 = Date.now()
      let text = ""
      try {
        const r = await callGenerate(modelRef, prompt)
        text = r.text || ""
      } catch {
        try {
          const r = await callGenerate(parseModelRef(modelRef.providerID), prompt)
          text = (r.text || "") + "\n(note: fallback provider)"
        } catch (e2) {
          return `#DECIDE failed: ${e2 && e2.message ? e2.message : e2} (model ${modelRef.providerID}/${modelRef.modelID}). Override with fcu_decide({model}) or opcompuse_settings.`
        }
      }
      return `#DECIDE model=${modelRef.providerID}/${modelRef.modelID} ${Date.now() - t0}ms\n${text}`
    }

    const SCHEMA_BOOL = { type: "boolean" }
    const SCHEMA_STR = { type: "string" }
    const SCHEMA_NUM = { type: "number" }
    const stepSchema = {
      type: "object",
      properties: {
        op: { type: "string", enum: [
          "click", "dblclick", "rclick", "move", "wheel", "write", "key",
          "invoke", "select", "focus", "toggle", "expand", "collapse", "set", "clickel", "scrollintoview",
          "win", "wait",
        ] },
        x: SCHEMA_NUM, y: SCHEMA_NUM, button: SCHEMA_STR,
        text: SCHEMA_STR, key: SCHEMA_STR, value: SCHEMA_STR,
        el: SCHEMA_STR, hwnd: SCHEMA_STR, title: SCHEMA_STR, ms: SCHEMA_NUM, dy: SCHEMA_NUM,
      },
      required: ["op"],
      additionalProperties: false,
    }
    const stepsToNative = (steps) =>
      steps.map((s) => {
        if (s.op === "dblclick") return { op: "click", x: s.x, y: s.y, double: true }
        if (s.op === "rclick") return { op: "click", x: s.x, y: s.y, button: "right" }
        if (s.op === "wheel") return { op: "wheel", y: s.dy ?? -3 }
        return s
      })

    function enforceAccess(steps) {
      const access = S.access || "standard"
      if (access !== "minimal") return { ok: true, steps }
      const denied = steps.filter((s) => ["click", "rclick", "dblclick", "move", "wheel"].includes(s.op))
      if (denied.length) {
        return { ok: false, msg: `#ACT blocked by access=minimal: pixel ops (${denied.map((d) => d.op).join(", ")}) are disabled. Use element ops (invoke/select/focus/set) or keyboard. Change in opcompuse_settings.` }
      }
      return { ok: true, steps }
    }

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "opcompuse",
        description:
`Fast Windows computer use: UIA+OCR screen digest (element tree + clickable points), batched actions with built-in verify, watch-ahead cache, cheap-model decider, apex-memory of desktop knowledge.`,
      })
      for (const t of [
        {
          name: "state",
          description: `See the screen fast. Compact digest of the active window: element tree (index/role/name/rect/clickable), focused element, OCR text, open windows. Served from the hot watcher cache (1-5ms). Ends with "#MEM" apex-memory hints when this app has prior knowledge. Element indexes power opcompuse_act element ops.`,
          input: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["smart", "fresh", "quick", "find"], default: "smart" },
              find: SCHEMA_STR,
              noOcr: SCHEMA_BOOL,
            },
            required: [],
            additionalProperties: false,
          },
          options: { namespace: "opcompuse", codemode: true },
          async execute(inp) {
            const mode = inp.mode || "smart"
            try {
              if (mode === "find") {
                const c = await captureFresh("find", { NameRegex: inp.find || "", NoOcr: !!inp.noOcr })
                return { content: `#FIND /${inp.find}/ ->\n${c.body}` }
              }
              if (mode === "fresh" || mode === "quick") {
                const c = await captureFresh(mode, { NoOcr: !!inp.noOcr })
                return { content: `#STATE (${mode}, fresh)\n${c.body}` }
              }
              const s = await smartState({ mode: "full" })
              const hints = [`#STATE (${s.source}, snapshot=${freshnessLabel(s.age)})`]
              if (s.meta?.process) hints.push(...(await memHints(s.meta.process)))
              return { content: `${hints.join("\n")}\n${s.body}` }
            } catch (e) {
              return { content: `#STATE failed: ${e && e.message ? e.message : e}` }
            }
          },
        },
        {
          name: "act",
          description: `Do desktop actions FAST; post-action state returned in one call (act + verify). Ops:
 click {x,y} / dblclick / rclick, wheel {dy}, move {x,y}
 write {text} (content never memorized)
 key {key:"ctrl+shift+t"} (no Win key)
 invoke/select/toggle/expand/collapse {el:"2.1"} (UIA pattern; click fallback)
 focus {el} | set {el,value} | clickel {el} | scrollintoview {el}
 win {title} | wait {ms}
Elements index from latest opcompuse_state. Prefer element ops / keyboard. access=minimal gates pixel ops.`,
          input: {
            type: "object",
            properties: {
              steps: { type: "array", items: stepSchema, minItems: 1, maxItems: 25 },
              minDelayMs: SCHEMA_NUM,
            },
            required: ["steps"],
            additionalProperties: false,
          },
          options: { namespace: "opcompuse", codemode: true },
          async execute(inp) {
            try {
              const handled = enforceAccess(stepsToNative(Array.isArray(inp.steps) ? inp.steps : [inp.steps]))
              if (!handled.ok) return { content: handled.msg }
              const raw = await psCall("act.ps1", {
                StepsB64: Buffer.from(JSON.stringify(handled.steps), "utf8").toString("base64"),
                MinDelayMs: inp.minDelayMs ?? 20,
              }, 25000)
              const { body, meta } = splitMeta(raw)
              const fileHintStep = handled.steps.find((s) => s.op === "write" && /^[A-Za-z]:\\[^"<>|?*\r\n]+\.(txt|md|json|html|htm|ps1|log|csv|url|lnk)$/i.test(s.text || ""))
              if (meta?.process) {
                void memoryAutoCapture({
                  process: meta.process,
                  title: meta.winName,
                  steps: handled.steps,
                  fileHint: fileHintStep?.text,
                })
              }
              return { content: `${meta ? `@act process=${meta.process}` : ""}\n${body}` }
            } catch (e) {
              return { content: `#ACT failed: ${e && e.message ? e.message : e}` }
            }
          },
        },
        {
          name: "find",
          description: `Search UI Automation tree of current window for a regex; returns el paths for opcompuse_act element ops.`,
          input: {
            type: "object",
            properties: { regex: SCHEMA_STR, depth: SCHEMA_NUM, maxMatches: SCHEMA_NUM },
            required: ["regex"],
            additionalProperties: false,
          },
          options: { namespace: "opcompuse", codemode: true },
          async execute(inp) {
            try {
              const c = await captureFresh("find", { NameRegex: inp.regex, FindDepth: inp.depth, FindMax: inp.maxMatches })
              return { content: `#FIND /${inp.regex}/ ->\n${c.body}` }
            } catch (e) {
              return { content: `#FIND failed: ${e && e.message ? e.message : e}` }
            }
          },
        },
        {
          name: "watch",
          description: `Control the watch-ahead loop that keeps the screen digest hot so opcompuse_state reads are 1-5ms.`,
          input: {
            type: "object",
            properties: { command: { type: "string", enum: ["on", "off", "status"] } },
            required: [],
            additionalProperties: false,
          },
          options: { namespace: "opcompuse", codemode: true },
          async execute(inp) {
            const cmd = inp.command || "status"
            if (cmd === "on") { stopWatcher(); startWatcher(); return { content: `#WATCH started (interval ${S.watchIntervalMs}ms idle-adaptive, state dir ${stateDir})` } }
            if (cmd === "off") { stopWatcher(); return { content: "#WATCH stopped" } }
            const a = await watcherAlive()
            return { content: a.alive ? `#WATCH alive age=${a.age}ms interval=${S.watchIntervalMs}ms dir=${stateDir}` : `#WATCH not running (use "on")` }
          },
        },
        {
          name: "decide",
          description: `Ask the cheap WATCHER MODEL what to do next using the TEXT digest (no screenshot => fast + ~$0). Use to break ambiguity. Override via {model} or opcompuse_settings.decider.`,
          input: {
            type: "object",
            properties: {
              question: SCHEMA_STR,
              goal: SCHEMA_STR,
              model: { type: "string" },
            },
            required: ["question"],
            additionalProperties: false,
          },
          options: { namespace: "opcompuse", codemode: true },
          async execute(inp) {
            return { content: await decide(inp.question, inp.goal, inp.model) }
          },
        },
        {
          name: "memory",
          description: `apex-memory: compressed desktop knowledge at ${memoryRoot} for ANY AI to reference.
  save {key, value} | get {key} | list | forget {key} | path | index | stats
Never stores usernames/passwords/tokens/API keys/emails - refused at save time.`,
          input: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["save", "get", "list", "forget", "path", "index", "stats"] },
              key: SCHEMA_STR,
              value: SCHEMA_STR,
              kind: { type: "string", enum: ["place", "app"], default: "place" },
            },
            required: ["op"],
            additionalProperties: false,
          },
          options: { namespace: "opcompuse", codemode: true },
          async execute(inp) {
            try {
              if (inp.op === "path") return { content: memoryRoot }
              if (inp.op === "index") return { content: await fsp.readFile(F.index, "utf8").catch(() => "#apex-memory empty") }
              if (inp.op === "stats") {
                const fmt = (fs_ => `${fs_.raw.toLocaleString()}B -> ${fs_.packed.toLocaleString()}B (${fs_.raw ? Math.round((1 - fs_.packed / Math.max(1, fs_.raw)) * 100) : 0}% saved)`)(apexStats.places)
                const fmt2 = (fs_ => `${fs_.raw.toLocaleString()}B -> ${fs_.packed.toLocaleString()}B (${fs_.raw ? Math.round((1 - fs_.packed / Math.max(1, fs_.raw)) * 100) : 0}% saved)`)(apexStats.apps)
                return { content: `#apex-memory compression stats\nplaces: ${fmt}\napps: ${fmt2}\ndir: ${memoryRoot}` }
              }
              if (S.memory !== true) return { content: "#memory disabled (opcompuse_settings)" }
              if (inp.op === "save") {
                if (S.memoryConfirm) {
                  try {
                    await ctx.permission.assert({
                      sessionID: ctx.sessionID || "",
                      action: "opcompuse_memory_save",
                      resources: [`${inp.key}: ${String(inp.value || "").slice(0, 40)}`],
                    })
                  } catch (e) {
                    return { content: `#memory save cancelled: ${e && e.message ? e.message : e}` }
                  }
                }
                const r = await memorySave({ key: inp.key, value: inp.value, kind: inp.kind })
                return { content: r.ok ? `#memory saved ${r.key}` : `#memory NOT saved: ${r.why}` }
              }
              if (inp.op === "get") {
                const [places, apps] = await Promise.all([apexRead(F.places, {}), apexRead(F.apps, {})])
                const hit = places[normalizeKey(inp.key)] || apps[normalizeKey(inp.key)]
                return { content: hit ? JSON.stringify(hit) : `#not found: ${inp.key}` }
              }
              if (inp.op === "list") {
                const [places, apps] = await Promise.all([apexRead(F.places, {}), apexRead(F.apps, {})])
                const lines = [`#apex-memory ${memoryRoot}`]
                const seenApp = new Set()
                for (const [k, v] of Object.entries(apps)) {
                  const sig = String(v?.lastFlow || "")
                  if (sig && seenApp.has(sig)) { lines.push(`- app ${k}: (same flow as above)`) ; continue }
                  if (sig) seenApp.add(sig)
                  lines.push(`- app ${k}: ${v.lastFlow || ""}`)
                }
                const seenVal = new Set()
                for (const [k, v] of Object.entries(places)) {
                  const sig = String(v?.v ?? v ?? "").toLowerCase().trim()
                  if (seenVal.has(sig)) { lines.push(`- place ${k}: (duplicate value, primary key shown first)`) ; continue }
                  seenVal.add(sig)
                  lines.push(`- place ${k} -> ${v.v ?? v}`)
                }
                return { content: lines.join("\n").slice(0, 6000) }
              }
              if (inp.op === "forget") {
                const k = normalizeKey(inp.key)
                for (const file of [F.places, F.apps]) {
                  const data = await apexRead(file, {})
                  if (k in data) { delete data[k]; await apexWrite(file, data) }
                }
                await regenerateIndex()
                return { content: `#memory forgot: ${k}` }
              }
              return { content: "#unknown memory op" }
            } catch (e) {
              return { content: `#memory failed: ${e && e.message ? e.message : e}` }
            }
          },
        },
        {
          name: "settings",
          description: `Read/toggle opcompuse runtime settings (memory, access, models, speed). get | set.`,
          input: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["get", "set"], default: "get" },
              memory: SCHEMA_BOOL,
              memoryAuto: SCHEMA_BOOL,
              memoryConfirm: SCHEMA_BOOL,
              access: { type: "string", enum: ["minimal", "standard", "full"] },
              decider: SCHEMA_STR,
              watchIntervalMs: SCHEMA_NUM,
              ocrEveryMs: SCHEMA_NUM,
              watcherModel: SCHEMA_STR,
              interpreterEverySec: SCHEMA_NUM,
              reset: SCHEMA_BOOL,
            },
            required: [],
            additionalProperties: false,
          },
          options: { namespace: "opcompuse", codemode: true },
          async execute(inp) {
            if (inp.action === "set" || inp.reset) {
              if (inp.reset) S = { ...defaults }
              for (const k of Object.keys(defaults)) if (inp[k] != null) S[k] = inp[k]
              await persistSettings()
            }
            const summary = Object.entries(S).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n")
            return { content: `#opcompuse settings (runtime; persists in ${F.settings})\n${summary}` }
          },
        },
      ]) editor.add(t)
    })

    await ctx.command.transform((editor) => {
      editor.add({
        name: "opu",
        description: "Shorthand: run the rest of this prompt in opcompuse fast computer-use mode",
        execute: async ({ sessionID, prompt, delivery }) => {
          await ctx.session.prompt({
            sessionID,
            delivery,
            text: `use opcompuse (the fast Windows computer-use plugin): ${prompt.text}`,
            attachments: prompt.attachments,
          })
        },
      })
    })

    await ctx.session.hook("context", (event) => {
      const head =
event.agent === "computer-use"
? `FAST PATH: prefer opcompuse_* element ops (invoke/select/set/focus) or keyboard over pixel screenshots; windows-mcp screenshots only for pixels-only content or Win-key combos. "use opu" from the user means: start opcompuse watcher and follow the fast loop. Save learned app flows with opcompuse_memory; check apex-memory index first.`
: `COMPUTER USE (opcompuse fast path):
1. opcompuse_state — instant element digest (~1-5ms from cache). User shorthand "use opu" = turn the watcher on and run this loop.
2. opcompuse_act — BATCH ALL STEPS IN ONE CALL; returns post-action state (verify built in). Prefer element ops + keyboard; pixel coords only when needed.
3. opcompuse_find — locate an element by regex before acting.
4. opcompuse_decide — cheap model consult on ambiguous screens (no screenshot).
5. opcompuse_watch "on" at task start; "off" when done.
6. apex-memory: "opcompuse_memory {op:'path'}" -> folder; read apex-index.md (or list) BEFORE long tasks; save successful flows/places with opcompuse_memory save (NEVER usernames/passwords/keys/emails).
Speed rules: batch generously; skip OCR when digest has enough; re-read state only when something could have changed. windows-mcp only for pixels-only surfaces or "win" key combos.`
      event.system.push({ type: "text", text: head })
    })

    if (Opcompuse) { await ctx.rpc.register(Opcompuse, {
      status: async (_input) => {
        const a = await watcherAlive()
        const cached = await readCachedState()
        let running = false
        try {
          const j = JSON.parse(await fsp.readFile(path.join(stateDir, "running.json"), "utf8"))
          running = j?.t > 0 && Date.now() - j.t < 1500
        } catch {}
        let stoppedByOpu = false
        try { stoppedByOpu = fs.existsSync(path.join(stateDir, "stop.json")) } catch {}
        const evLines = String(cached?.body || "").split(/\r?\n/)
        const evIdx = evLines.findIndex((l) => l.startsWith("#EVENTS"))
        const evList = evIdx >= 0 ? evLines.slice(evIdx + 1, evIdx + 15) : []
        const winLine = evLines.find((l) => l.startsWith("#W ")) || ""
        const [places, apps] = S.memory === true
          ? await Promise.all([apexRead(F.places, {}), apexRead(F.apps, {})])
          : [{}, {}]
        return {
          watchAlive: a.alive,
          watchAge: a.age,
          digestAge: cached?.age ?? -1,
          running,
          stoppedByOpu,
          currentWindow: (winLine.match(/"([^"]+)"/) || [])[1] || cached?.meta?.winName || "",
          currentProcess: cached?.meta?.process || "",
          events: evList,
          memory: {
            places: Object.keys(places).length,
            apps: Object.keys(apps).length,
            dir: memoryRoot,
          },
          settings: { ...S },
          note: stoppedByOpu
            ? "OPU STOPPED (stop button/hotkey) - re-enable with opcompuse_watch on"
            : running
              ? "opu IS RUNNING actions right now"
              : "apex-memory: no usernames/passwords/tokens/keys/emails stored; typed text is never memorized.",
        }
      },
      watch: async ({ command }) => {
        if (command === "on") { stopWatcher(); startWatcher(); return { text: "on" } }
        if (command === "off") { stopWatcher(); return { text: "off" } }
        const a = await watcherAlive()
        return { text: a.alive ? `alive age=${a.age}ms` : "off" }
      },
      settingsGet: async () => ({ ...S }),
      settingsSet: async (patch) => {
        for (const k of Object.keys(defaults)) if (patch?.[k] != null) S[k] = patch[k]
        await persistSettings()
        return { ...S }
      },
      memorySummary: async () => {
        const [places, apps] = await Promise.all([apexRead(F.places, {}), apexRead(F.apps, {})])
        return {
          dir: memoryRoot,
          places: Object.keys(places).slice(0, 200),
          apps: Object.keys(apps).slice(0, 200),
        }
      },
      memorySave: async ({ key, value, kind }) => {
        const r = await memorySave({ key, value, kind: kind || "place" })
        return { text: r.ok ? (r.unchanged ? `already known (${key})` : `saved ${key}`) : `refused: ${r.why}` }
      },
      stop: async () => {
        const text = stopAll()
        await stopHud()
        return { text }
      },
    }) }
    else { console.log("[opcompuse] rpc contract unavailable (rpc.js missing); panel disabled") }

    return () => stopWatcher()
  },
})
