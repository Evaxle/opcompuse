import { spawn as nodeSpawn, execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import readline from "node:readline"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const psDir = path.join(here, "..", "ps")
const PS = path.join(process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
const stateDir = path.join(process.env.TEMP || path.join(os.homedir(), "AppData", "Local", "Temp"), "opencode", "opcompuse")

const DEFAULT_DECIDER = "opencode-go/glm-5.3-flash"
const SENSITIVE_RE = new RegExp("(\\bpass(?:word|code|wd)?\\s*[:=]|\\bpwd\\s*[:=]|secret\\s*[:=]|\\btoken\\s*[:=]|api[_-]?key\\s*[:=]|apikey\\s*[:=]|bearer\\s|authorization\\s*[:=]|credential|password|passwd|pin code|otp\\s|login code|ssn|cvv|credit card|username\\s*[:=]|user name\\s*[:=]|\\bemail\\s*[:=])", "i")
const APEX_MAGIC = Buffer.from("OAPX1")
const CACHE_FRESH_MS = 3500

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

async function apexRead(file, fallback) {
  try {
    const buf = await fsp.readFile(file)
    if (buf.length <= APEX_MAGIC.length || !buf.subarray(0, APEX_MAGIC.length).equals(APEX_MAGIC)) throw new Error("bad apex blob")
    return { ...fallback, ...JSON.parse(zlib.gunzipSync(buf.subarray(APEX_MAGIC.length)).toString("utf8")) }
  } catch {
    try { return { ...fallback, ...JSON.parse(await fsp.readFile(file.replace(/\.apx$/, ".json"), "utf8")) } }
    catch { return { ...fallback } }
  }
}

async function readAlive() {
  try {
    const j = JSON.parse(await fsp.readFile(path.join(stateDir, "alive.json"), "utf8"))
    const age = Date.now() - j.t
    return { alive: age < 4000, age, meta: j }
  } catch { return { alive: false, age: -1, meta: null } }
}

async function readSettings() {
  try {
    return JSON.parse(await fsp.readFile(path.join(os.homedir(), ".local", "share", "opencode", "opcompuse", "apex-memory", "settings.json"), "utf8"))
  } catch { return {} }
}

async function ensureHud() {
  try {
    fs.mkdirSync(stateDir, { recursive: true })
    const hudPath = path.join(stateDir, "hud.json")
    try {
      const j = JSON.parse(fs.readFileSync(hudPath, "utf8"))
      if (j?.pid) {
        let alive = false
        try { process.kill(j.pid, 0); alive = true } catch { alive = false }
        if (alive) return true
      }
    } catch {}
    const s = await readSettings()
    if (s.hud === false) return true
    const exe = path.join(psDir, "OpuHud.exe")
    if (fs.existsSync(exe)) {
      let blocked = false
      try {
        const ch = nodeSpawn(exe, [stateDir], { detached: true, stdio: "ignore", windowsHide: true })
        ch.on("error", () => { blocked = true })
        await new Promise((resolve) => setTimeout(resolve, 900))
        if (blocked) { try { ch.kill() } catch {} }
        else {
          let alive = false
          try { process.kill(ch.pid, 0); alive = true } catch {}
          if (alive) return true
        }
      } catch {}
    }
    try {
      const PS = path.join(process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      const script = path.join(psDir, "opu-hud.ps1")
      const ch2 = nodeSpawn(PS, ["-STA", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-StateDir", stateDir], { detached: true, stdio: "ignore", windowsHide: true })
      try { ch2.unref() } catch {}
      return true
    } catch {}
    return false
  } catch { return false }
}

let hudHeartbeat = null
void (async function hudLifecycle() {
  const s = await readSettings()
  if (s.hud === false) return
  await ensureHud()
  void atomicWrite(path.join(stateDir, "mcp.alive.json"), JSON.stringify({ t: Date.now(), pid: process.pid }))
  hudHeartbeat = setInterval(() => {
    void atomicWrite(path.join(stateDir, "mcp.alive.json"), JSON.stringify({ t: Date.now(), pid: process.pid }))
  }, 2000)
  hudHeartbeat.unref?.()
})()

async function readCachedState() {
  try {
    const raw = await fsp.readFile(path.join(stateDir, "state.txt"), "utf8")
    const { body, meta } = splitMeta(raw)
    const age = meta?.t != null ? Date.now() - meta.t : -1
    return { body, meta, age }
  } catch { return null }
}

async function captureFresh(mode, extra = {}) {
  if (mode === "fresh") mode = "full"
  const params = { Mode: mode }
  if (extra.NameRegex) params.NameRegex = extra.NameRegex
  if (extra.FindDepth) params.FindDepth = extra.FindDepth
  if (extra.FindMax) params.FindMax = extra.FindMax
  if (extra.NoOcr) params.NoOcr = true
  const raw = await psCall("state.ps1", params, mode === "quick" ? 8000 : 20000)
  return splitMeta(raw)
}

async function smartState() {
  const alive = await readAlive()
  if (!alive.alive) {
    const c = await captureFresh("full")
    return { body: c.body, meta: c.meta, age: -1, source: "captured (watcher warming up)" }
  }
  const cached = await readCachedState()
  if (cached && cached.age >= 0 && cached.age <= CACHE_FRESH_MS) {
    return { ...cached, source: "watcher cache" }
  }
  const c = await captureFresh("full")
  return { body: c.body, meta: c.meta, age: -1, source: "captured" }
}

function parseModelRef(raw) {
  const slash = raw.indexOf("/")
  return slash > 0
    ? { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) }
    : { providerID: raw, modelID: raw }
}

async function opMemory(op, key, value, kind) {
  const memoryRoot = path.join(os.homedir(), ".local", "share", "opencode", "opcompuse", "apex-memory")
  const F = {
    places: path.join(memoryRoot, "places.apx"),
    apps: path.join(memoryRoot, "apps.apx"),
    index: path.join(memoryRoot, "apex-index.md"),
  }
  if (op === "path") return `#apex-memory ${memoryRoot}`
  if (op === "index") return (await fsp.readFile(F.index, "utf8").catch(() => "#apex-memory empty"))
  const rawKey = String(key || "").trim().slice(0, 80).replace(/[\r\n|]+/g, " ")
  if (op === "save") {
    if (SENSITIVE_RE.test(String(value || "")) || SENSITIVE_RE.test(rawKey)) {
      return "#memory refused: value looks like private login data (never stored)"
    }
    const cur = await apexRead(F.places, {})
    for (const [k2, e] of Object.entries(cur)) {
      if (String(e && e.v ? e.v : e).toLowerCase().trim() === String(value).toLowerCase().trim() && k2 !== rawKey) {
        return `#memory duplicate skipped: already stored under key "${k2}"`
      }
    }
    const prevHits = cur[rawKey]?.hits || 0
    cur[rawKey] = { v: String(value || "").slice(0, 400), t: Date.now(), hits: prevHits }
    await atomicWrite(F.places, JSON.stringify(cur, null, 2))
    return `#memory saved ${rawKey}`
  }
  if (op === "get") {
    const [places, apps] = await Promise.all([apexRead(F.places, {}), apexRead(F.apps, {})])
    const hit = places[rawKey] || apps[rawKey]
    return hit ? JSON.stringify(hit) : `#not found: ${rawKey}`
  }
  if (op === "list") {
    const [places, apps] = await Promise.all([apexRead(F.places, {}), apexRead(F.apps, {})])
    const lines = [`#apex-memory ${memoryRoot}`]
    const seen = new Set()
    for (const [k, v] of Object.entries(places)) {
      const sig = String(v?.v ?? v ?? "").toLowerCase().trim()
      if (seen.has(sig)) continue
      seen.add(sig)
      lines.push(`- place ${k} -> ${v.v ?? v}`)
    }
    for (const k of Object.keys(apps)) lines.push(`- app ${k}: ${apps[k].lastFlow || ""}`)
    return lines.join("\n").slice(0, 6000)
  }
  if (op === "forget") {
    for (const file of [F.places, F.apps]) {
      const data = await apexRead(file, {})
      if (rawKey in data) { delete data[rawKey]; await atomicWrite(file, JSON.stringify(data, null, 2)) }
    }
    return `#memory forgot: ${rawKey}`
  }
  if (op === "stats") {
    const places = await apexRead(F.places, {})
    const apps = await apexRead(F.apps, {})
    return `#apex-memory stats\nplaces entries: ${Object.keys(places).length}\napps entries: ${Object.keys(apps).length}\ndir: ${memoryRoot}`
  }
  return "#unknown memory op"
}

const stepSchema = {
  type: "object",
  properties: {
    op: { type: "string", enum: ["click", "dblclick", "rclick", "move", "wheel", "write", "key", "invoke", "select", "focus", "toggle", "expand", "collapse", "set", "clickel", "scrollintoview", "win", "wait"] },
    x: { type: "number" }, y: { type: "number" }, button: { type: "string" },
    text: { type: "string" }, key: { type: "string" }, value: { type: "string" },
    el: { type: "string" }, hwnd: { type: "string" }, title: { type: "string" }, ms: { type: "number" }, dy: { type: "number" },
  },
  required: ["op"],
  additionalProperties: false,
}

const TOOLS = [
  {
    name: "opu_state",
    description:
`See the Windows screen fast (UIA element tree + clickable points + OCR + open windows). Cached ~1-5ms when the opu watcher runs; ends with "@opc {...}" metadata line you can ignore.`,
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["smart", "fresh", "quick", "find"], default: "smart" },
        find: { type: "string" },
        noOcr: { type: "boolean" },
      },
      additionalProperties: false,
    },
    handler: async (a) => {
      if (a.mode === "find") return `#FIND /${a.find}/ ->\n${(await captureFresh("find", { NameRegex: a.find || "", NoOcr: !!a.noOcr })).body}`
      if (a.mode === "fresh" || a.mode === "quick") return (await captureFresh(a.mode, { NoOcr: !!a.noOcr })).body
      const s = await smartState()
      return s.body
    },
  },
  {
    name: "opu_act",
    description:
`Batch Windows desktop actions and get the post-action state in one call. Ops: click/dblclick/rclick, wheel, move, write (typed), key combos (no Win key), UIA invoke/select/toggle/expand/collapse/focus/set/clickel/scrollintoview on el indexes from opu_state, win (activate window), wait.`,
    inputSchema: {
      type: "object",
      properties: {
        steps: { type: "array", items: stepSchema, minItems: 1, maxItems: 25 },
        minDelayMs: { type: "number" },
      },
      required: ["steps"],
      additionalProperties: false,
    },
    handler: async (a) => {
      const steps = a.steps.map((s) => {
        if (s.op === "dblclick") return { op: "click", x: s.x, y: s.y, double: true }
        if (s.op === "rclick") return { op: "click", x: s.x, y: s.y, button: "right" }
        if (s.op === "wheel") return { op: "wheel", y: s.dy ?? -3 }
        return s
      })
      const b64 = Buffer.from(JSON.stringify(steps), "utf8").toString("base64")
      return psCall("act.ps1", { StepsB64: b64, MinDelayMs: a.minDelayMs ?? 20, StateDir: stateDir }, 25000)
    },
  },
  {
    name: "opu_find",
    description: "Search UI Automation tree of the current window by regex. Returns el paths for opu_act element ops.",
    inputSchema: {
      type: "object",
      properties: { regex: { type: "string" }, depth: { type: "number" }, maxMatches: { type: "number" } },
      required: ["regex"],
      additionalProperties: false,
    },
    handler: async (a) =>
      (await captureFresh("find", { NameRegex: a.regex, FindDepth: a.depth, FindMax: a.maxMatches })).body,
  },
  {
    name: "opu_watch",
    description:
`Control the watch-ahead loop (keeps the digest hot so opu_state is ~1-5ms). on / off / status. The always-on-top OPU HUD indicator follows this state; STOP via HUD or Ctrl+Alt+Shift+X.`,
    inputSchema: {
      type: "object",
      properties: { command: { type: "string", enum: ["on", "off", "status"] } },
      additionalProperties: false,
    },
    handler: async (a) => {
      const cmd = a.command || "status"
      if (cmd === "on") {
        const enc = Buffer.from(
          `& '${path.join(psDir, "watch.ps1").replace(/'/g, "''")}' -IntervalMs 700 -OutDir '${stateDir.replace(/'/g, "''")}'`,
          "utf16le").toString("base64")
        nodeSpawn(PS, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc], { detached: true, stdio: "ignore", windowsHide: true }).unref?.()
        return `#WATCH starting (interval 700ms; HUD shows OPU WATCHING). dir ${stateDir}`
      }
      if (cmd === "off") {
        try { fs.rmSync(path.join(stateDir, "alive.json"), { force: true }) } catch {}
        return "#WATCH off (HUD flips to idle)"
      }
      const a2 = await readAlive()
      return a2.alive ? `#WATCH alive age=${a2.age}ms dir=${stateDir}` : "#WATCH not running"
    },
  },
  {
    name: "opu_memory",
    description:
`apex-memory: compressed, de-duplicated desktop knowledge. ops: save {key,value} | get {key} | list | forget {key} | path | index | stats. Never stores usernames/passwords/tokens/API keys/emails.`,
    inputSchema: {
      type: "object",
      properties: {
        op: { type: "string", enum: ["save", "get", "list", "forget", "path", "index", "stats"] },
        key: { type: "string" },
        value: { type: "string" },
        kind: { type: "string", enum: ["place", "app"], default: "place" },
      },
      required: ["op"],
      additionalProperties: false,
    },
    handler: async (a) => opMemory(a.op, a.key, a.value, a.kind),
  },
  {
    name: "opu_settings",
    description:
`Read/toggle opcompuse runtime settings. get | set with fields: memory, memoryAuto, memoryConfirm, access (minimal|standard|full), hud (on-screen indicator), watchIntervalMs, burstIntervalMs, ocrEveryMs, interpreterEverySec,         targets (window selectors "re:<regex-title>" / "proc:<name>" / "pid:<n>" / "hwnd:<n>", display selectors "disp:<monitor-index>" / "disp:all", max 8). The always-running watcher and the OPU HUD pick changes up within a second; conductor model switching is available inside OpenCode via opcompuse_settings.`,
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "set"], default: "get" },
        memory: { type: "boolean" },
        memoryAuto: { type: "boolean" },
        memoryConfirm: { type: "boolean" },
        access: { type: "string", enum: ["minimal", "standard", "full"] },
        hud: { type: "boolean" },
        watchIntervalMs: { type: "number" },
        burstIntervalMs: { type: "number" },
        ocrEveryMs: { type: "number" },
        interpreterEverySec: { type: "number" },
        targets: { type: "array", items: { type: "string" }, maxItems: 8, description: 'selectors "re:<regex-title>" / "proc:<process>" / "pid:<n>" / "hwnd:<n>" / "disp:<monitor-index>" / "disp:all"' },
        reset: { type: "boolean" },
      },
      additionalProperties: false,
    },
    handler: async (a) => {
      const sp = path.join(os.homedir(), ".local", "share", "opencode", "opcompuse", "apex-memory", "settings.json")
      if (a.action === "set" || a.reset) {
        let cur = {}
        try { cur = JSON.parse(await fsp.readFile(sp, "utf8")) } catch {}
        if (a.reset) {
          cur = {}
        } else {
          for (const k of ["memory", "memoryAuto", "memoryConfirm", "hud"]) if (a[k] != null) cur[k] = !!a[k]
          for (const k of ["watchIntervalMs", "burstIntervalMs", "ocrEveryMs", "interpreterEverySec"]) if (a[k] != null) cur[k] = a[k]
          if (a.access) cur.access = a.access
          if (Array.isArray(a.targets)) cur.targets = a.targets.map(String).slice(0, 8)
        }
        await atomicWrite(sp, JSON.stringify(cur, null, 2))
        return `#settings updated (watcher + HUD apply within ~1s): ${JSON.stringify(cur)}`
      }
      try {
        return await fsp.readFile(sp, "utf8")
      } catch { return "{}" }
    },
  },
]

let mux = {}
function send(obj) {
  try { process.stdout.write(JSON.stringify(obj) + "\n") } catch {}
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })
rl.on("line", async (line) => {
  if (!line.trim()) return
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.jsonrpc !== "2.0") return
  const id = msg.id ?? null
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: msg.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "opu-mcp", version: "1.0.0" },
      },
    })
    return
  }
  if (msg.method === "notifications/initialized") return
  if (msg.method === "ping") { send({ jsonrpc: "2.0", id, result: {} }); return }
  if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } })
    return
  }
  if (msg.method === "tools/call") {
    const name = msg.params?.name
    const tool = TOOLS.find((t) => t.name === name)
    if (!tool) { send({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool ${name}` } }); return }
    try {
      const text = await tool.handler(msg.params?.arguments || {})
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(text).slice(0, 30000) }] } })
    } catch (e) {
      send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: String(e && e.message || e).slice(0, 4000) }] } })
    }
    return
  }
  if (id != null) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method ${msg.method} not found` } })
})
rl.on("close", () => process.exit(0))
