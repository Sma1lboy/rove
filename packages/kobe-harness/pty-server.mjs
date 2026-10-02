/**
 * PTY server — the node half of the web terminal (node-pty doesn't work under
 * bun, so the live terminals run here as a separate node process).
 *
 * Model: each web PTY tab is identified by a client-generated `tab` id. Its
 * PTY is spawned lazily on first attach (launch spec fetched from daemon web
 * transport by taskId + mode) and kept alive across WebSocket reconnects, so a
 * page refresh re-attaches to the same process. Closing a tab (POST
 * /pty/close) kills its PTY, and so does no socket re-attaching within the
 * detach grace window. The sidecar exits with its parent process.
 *
 *   ws  /pty?tab=<id>&taskId=<id>&mode=engine|shell&cols=<n>&rows=<n>
 *   POST /pty/close   { tab }                          kill the tab process
 *   POST /pty/send    { tab, taskId, text }            paste text + Enter into the tab's engine
 *
 * With KOBE_PTY_CAST=1 (film capture) every tab is also recorded:
 *   POST /pty/mark    { tab, label }                   storyboard marker into the recording
 *   GET  /pty/cast?tab=<id>                            the recording (asciicast v2), then dropped
 */

import { createServer } from "node:http"
import { spawn } from "node-pty"
import { WebSocketServer } from "ws"
import { allowedHostForBindHost, originAllowed } from "./origin-policy.mjs"
import { ptyRequestAuthorized } from "./pty-auth.mjs"
import { ptyEnv } from "./pty-env.mjs"
import { createScrollback } from "./pty-scrollback.mjs"
import { watchParent } from "./pty-parent-watch.mjs"
import { createPtySessionManager } from "./pty-session-lifecycle.mjs"
import { createSpecFetcher } from "./pty-spec.mjs"
import { createCast } from "./pty-cast.mjs"
import { killPtyTree } from "./pty-tree-kill.mjs"

const PORT = Number.parseInt(process.env.KOBE_PTY_PORT ?? "5175", 10)
const SCROLLBACK_CAP = 256 * 1024 // bytes of recent output replayed on (re)attach
const HEALTH_PATH = "/__kobe_harness"
const HEALTH_MARKER = "kobe-harness"
const HOST = process.env.KOBE_WEB_HOST?.trim() || "127.0.0.1"
const ALLOWED_HOST = allowedHostForBindHost(HOST)

const fetchSpec = createSpecFetcher()

const ptySessions = createPtySessionManager({
  fetchSpec,
  spawnPty: spawn,
  terminatePty: killPtyTree,
  createScrollback,
  scrollbackCap: SCROLLBACK_CAP,
  env: ptyEnv,
  createCast: process.env.KOBE_PTY_CAST === "1" ? createCast : null,
})

/**
 * The gate every PTY route shares. Origin says which page is asking, the token
 * says whether the caller is entitled at all — and the token is the one that
 * stops a non-browser process, which sends no Origin. Returns the status to
 * refuse with, or null to proceed.
 */
function ptyRouteDenial(req, url) {
  if (!originAllowed(req.headers.origin, { allowedHost: ALLOWED_HOST })) return 403
  return ptyRequestAuthorized(req.headers, url) ? null : 401
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost")
  if (url.pathname === HEALTH_PATH) {
    res.writeHead(200, { "content-type": "text/plain" })
    res.end(HEALTH_MARKER)
    return
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    })
    res.end()
    return
  }
  if (req.method === "POST" && url.pathname === "/pty/send") {
    // Sending text DRIVES the engine like a keyboard, so this holds the same
    // gate as the WS attach — the bearer token, plus the origin check.
    const denial = ptyRouteDenial(req, url)
    if (denial) {
      res.writeHead(denial)
      res.end()
      return
    }
    let body = ""
    req.on("data", (c) => {
      body += c
    })
    req.on("end", async () => {
      let tab
      let taskId
      let text
      try {
        ;({ tab, taskId, text } = JSON.parse(body || "{}"))
      } catch {
        /* ignore */
      }
      const respond = (status, payload) => {
        res.writeHead(status, {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
        })
        res.end(JSON.stringify(payload))
      }
      if (typeof tab !== "string" || !tab || typeof text !== "string" || !text) {
        respond(400, { sent: false, error: "tab and text are required" })
        return
      }
      let result
      try {
        // Spawn-on-send: a board action can fire without the terminal ever
        // opening — output lands in the scrollback ring for the next attach.
        result = await ptySessions.sendText({
          tabId: tab,
          taskId: typeof taskId === "string" && taskId ? taskId : null,
          text,
        })
      } catch (err) {
        respond(500, { sent: false, error: `failed to start engine: ${err?.message ?? err}` })
        return
      }
      if (!result.sent) {
        respond(404, { sent: false, error: "no such tab" })
        return
      }
      respond(200, { sent: true, spawned: result.spawned })
    })
    return
  }
  if (req.method === "POST" && url.pathname === "/pty/mark") {
    const denial = ptyRouteDenial(req, url)
    if (denial) {
      res.writeHead(denial)
      res.end()
      return
    }
    let body = ""
    req.on("data", (c) => {
      body += c
    })
    req.on("end", () => {
      let tab
      let label
      try {
        ;({ tab, label } = JSON.parse(body || "{}"))
      } catch {
        /* ignore */
      }
      const ok = typeof tab === "string" && typeof label === "string" && ptySessions.markCast(tab, label)
      res.writeHead(ok ? 200 : 404, { "content-type": "application/json" })
      res.end(JSON.stringify({ marked: ok }))
    })
    return
  }
  if (req.method === "GET" && url.pathname === "/pty/cast") {
    // The recording is everything the tab displayed — same gate as attaching.
    const denial = ptyRouteDenial(req, url)
    if (denial) {
      res.writeHead(denial)
      res.end()
      return
    }
    const cast = ptySessions.takeCast(url.searchParams.get("tab") ?? "")
    res.writeHead(cast === null ? 404 : 200, { "content-type": "application/x-asciicast" })
    res.end(cast ?? "")
    return
  }
  if (req.method === "POST" && url.pathname === "/pty/close") {
    // Killing a tab is a side effect any caller that reached this port could
    // abuse to DoS the session (tab ids are client-generated/observable), so
    // hold the same gate as /pty/send and the WS attach.
    const denial = ptyRouteDenial(req, url)
    if (denial) {
      res.writeHead(denial)
      res.end()
      return
    }
    let body = ""
    req.on("data", (c) => {
      body += c
    })
    req.on("end", () => {
      let tab
      try {
        tab = JSON.parse(body || "{}").tab
      } catch {
        /* ignore */
      }
      const ok = tab ? ptySessions.closeSession(tab) : false
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      })
      res.end(JSON.stringify({ closed: ok }))
    })
    return
  }
  res.writeHead(404)
  res.end()
})

// A PTY WS is arbitrary command exec in the worktree, so it takes both checks.
// The origin check rejects cross-origin upgrades, which defends a malicious
// local page / DNS-rebinding even on the loopback bind; it cannot defend
// anything against a client that simply sends no Origin, which is why the
// bearer token — the same one every REST and SSE caller presents — decides.
// `ws` refuses a false verifyClient with HTTP 401.
const wss = new WebSocketServer({
  server,
  path: "/pty",
  verifyClient: ({ origin, req }) =>
    originAllowed(origin, { allowedHost: ALLOWED_HOST }) &&
    ptyRequestAuthorized(req.headers, new URL(req.url ?? "/", "http://localhost")),
})

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://localhost")
  const tabId = url.searchParams.get("tab")
  const taskId = url.searchParams.get("taskId")
  const cols = Number.parseInt(url.searchParams.get("cols") ?? "80", 10) || 80
  const rows = Number.parseInt(url.searchParams.get("rows") ?? "24", 10) || 24
  const mode = url.searchParams.get("mode") === "shell" ? "shell" : "engine"

  if (!tabId || !taskId) {
    ws.close(1008, "missing tab/taskId")
    return
  }

  void (async () => {
    try {
      // Single-flight spawn: concurrent attaches for this tab share one PTY.
      await ptySessions.attachSocket({ ws, tabId, taskId, mode, cols, rows })
    } catch (err) {
      if (ws.readyState === ws.OPEN) {
        ws.send(`\r\nfailed to start ${mode}: ${err?.message ?? err}\r\n`)
        ws.close(1011, "spawn failed")
      }
      return
    }
  })()
})

// Bind loopback by default — a PTY is an arbitrary shell/engine in the
// worktree, so it must never listen on all interfaces. KOBE_WEB_HOST overrides.
server.listen(PORT, HOST, () => {
  process.stdout.write(`Rove PTY server listening on ${HOST}:${server.address().port}\n`)
})

let stopping = false
const shutdown = () => {
  if (stopping) return
  stopping = true
  stopParentWatch()
  ptySessions.shutdown()
  for (const ws of wss.clients) ws.terminate()
  wss.close()
  server.close()
  server.closeAllConnections()
  process.stdin.destroy()
  // Let node-pty's asynchronous Windows console cleanup finish before exit.
  process.exitCode = 0
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
const stopParentWatch = watchParent({ onGone: shutdown })
if (process.env.KOBE_PTY_PARENT_PIPE === "1") {
  process.stdin.once("end", shutdown)
  process.stdin.resume()
}
