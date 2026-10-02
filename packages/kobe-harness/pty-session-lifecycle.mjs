/**
 * PTY session lifecycle manager for the web sidecar.
 *
 * The HTTP/WebSocket server is transport glue; this module owns the deeper
 * lifecycle state for tab-keyed PTY sessions: single-flight spawn, attach,
 * scrollback replay, resize/input, close, process-exit cleanup, and shutdown.
 */

const DEFAULT_SUBMIT_DELAYS = {
  spawnedPasteMs: 2500,
  existingPasteMs: 0,
  enterMs: 150,
}

// A browser opening /pty?tab=<id> with ever-new tab ids would otherwise spawn
// node-pty processes without bound. Cap concurrent sessions; spawning past the
// cap evicts the oldest session with no attached sockets, and rejects when every
// session is being actively viewed.
const DEFAULT_MAX_SESSIONS = 64

// The page never POSTs /pty/close when a browser tab just closes, so a session
// nobody re-attaches to within this window is killed. Long enough to ride out a
// refresh or a laptop lid, short enough that abandoned TUIs don't pile up.
const DEFAULT_DETACH_GRACE_MS = 10 * 60 * 1000

// PTY→WebSocket backpressure: a flooding pty (`yes`) outruns a slow browser, so
// node buffers the unsent bytes (ws.bufferedAmount) without bound. Pause the pty
// once any socket's buffer crosses the high-water mark and resume once every
// socket has drained back under the low-water mark.
const DEFAULT_BACKPRESSURE = {
  highWaterBytes: 1 << 20, // 1 MiB queued to a socket → pause the pty
  lowWaterBytes: 1 << 18, // 256 KiB → resume once all sockets are back under
  drainPollMs: 50,
}

/** First session (insertion order) with no attached sockets — the safest to
 *  evict under cap pressure since no browser is watching it. Returns null when
 *  every session is actively viewed (caller rejects the new spawn). Exported
 *  for tests. */
export function pickEvictableTab(sessions) {
  for (const [tabId, entry] of sessions) {
    if (entry.sockets.size === 0) return tabId
  }
  return null
}

/** Pause the pty when ANY open socket has more than `highWaterBytes` queued —
 *  one slow client is enough to grow node memory unbounded. Exported for tests. */
export function shouldPausePty(sockets, highWaterBytes) {
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN && ws.bufferedAmount > highWaterBytes) {
      return true
    }
  }
  return false
}

/** Resume only when EVERY open socket has drained back under `lowWaterBytes`
 *  (an empty socket set resumes immediately). Exported for tests. */
export function shouldResumePty(sockets, lowWaterBytes) {
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN && ws.bufferedAmount > lowWaterBytes) {
      return false
    }
  }
  return true
}

export function createPtySessionManager({
  fetchSpec,
  spawnPty,
  terminatePty = (pty) => pty.kill(),
  createScrollback,
  scrollbackCap,
  env,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  submitDelays = DEFAULT_SUBMIT_DELAYS,
  maxSessions = DEFAULT_MAX_SESSIONS,
  detachGraceMs = DEFAULT_DETACH_GRACE_MS,
  backpressure = DEFAULT_BACKPRESSURE,
  /** Film capture only (`KOBE_PTY_CAST=1`): record each tab as an asciicast. */
  createCast = null,
}) {
  /** @type {Map<string, { pty: any, scrollback: ReturnType<createScrollback>, sockets: Set<any> }>} */
  const sessions = new Map()
  /** @type {Map<string, Promise<any>>} */
  const pendingSpawns = new Map()
  let stopped = false
  // Keyed by tab and kept past the process's exit: a take that quits and
  // reattaches the TUI is still one recording, and the cast is read after close.
  /** @type {Map<string, ReturnType<NonNullable<typeof createCast>>>} */
  const casts = new Map()

  /** Pause the pty once a socket is saturated and poll for drain to resume.
   *  Idempotent: a second saturation while already paused is a no-op. */
  function applyBackpressure(entry) {
    if (entry.paused) return
    if (!shouldPausePty(entry.sockets, backpressure.highWaterBytes)) return
    entry.paused = true
    try {
      entry.pty.pause?.()
    } catch {
      /* engine died — onExit clears the entry */
    }
    if (entry.drainTimer !== null) return
    entry.drainTimer = setIntervalFn(() => {
      if (!shouldResumePty(entry.sockets, backpressure.lowWaterBytes)) return
      clearDrainTimer(entry)
      entry.paused = false
      try {
        entry.pty.resume?.()
      } catch {
        /* engine died — onExit clears the entry */
      }
    }, backpressure.drainPollMs)
  }

  function clearDrainTimer(entry) {
    if (entry.drainTimer !== null) {
      clearIntervalFn(entry.drainTimer)
      entry.drainTimer = null
    }
  }

  /** Start the reap countdown for a session no socket is watching. */
  function armDetachTimer(tabId, entry) {
    if (entry.detachTimer !== null || entry.sockets.size > 0) return
    entry.detachTimer = setTimeoutFn(() => {
      entry.detachTimer = null
      if (sessions.get(tabId) === entry && entry.sockets.size === 0) closeSession(tabId)
    }, detachGraceMs)
  }

  function clearDetachTimer(entry) {
    if (entry.detachTimer !== null) {
      clearTimeoutFn(entry.detachTimer)
      entry.detachTimer = null
    }
  }

  function spawnSession(tabId, spec, cols, rows) {
    // Enforce the session cap before allocating another process: evict the
    // oldest unwatched session, or reject when every session is in active use.
    if (sessions.size >= maxSessions && !sessions.has(tabId)) {
      const victim = pickEvictableTab(sessions)
      if (victim === null) {
        throw new Error(`pty session limit reached (${maxSessions})`)
      }
      closeSession(victim)
    }
    const [cmd, ...args] = spec.command
    const spawnEnv = typeof env === "function" ? env() : env
    let pty
    try {
      pty = spawnPty(cmd, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: spec.cwd,
        env: spawnEnv,
      })
    } catch (error) {
      const path = typeof spawnEnv.PATH === "string" && spawnEnv.PATH ? "set" : "missing"
      throw new Error(`PTY spawn failed (command ${cmd}, cwd ${spec.cwd}, PATH ${path}): ${error instanceof Error ? error.message : String(error)}`)
    }
    let cast = null
    if (createCast) {
      cast = casts.get(tabId) ?? null
      if (cast) cast.respawn(cols, rows)
      else casts.set(tabId, (cast = createCast({ cols, rows })))
    }
    const entry = {
      pty,
      scrollback: createScrollback(scrollbackCap),
      sockets: new Set(),
      paused: false,
      drainTimer: null,
      detachTimer: null,
      cast,
    }
    pty.onData((data) => {
      entry.scrollback.push(data)
      entry.cast?.output(data)
      for (const ws of entry.sockets) {
        if (ws.readyState === ws.OPEN) ws.send(data)
      }
      applyBackpressure(entry)
    })
    pty.onExit(() => {
      clearDrainTimer(entry)
      for (const ws of entry.sockets) {
        if (ws.readyState === ws.OPEN) ws.close(1000, "engine exited")
      }
      // After the socket loop: a synchronous close re-arms the reap timer.
      clearDetachTimer(entry)
      if (sessions.get(tabId) === entry) sessions.delete(tabId)
    })
    sessions.set(tabId, entry)
    // A spawn-on-send with no viewer is reaped too; an attach cancels this.
    armDetachTimer(tabId, entry)
    return entry
  }

  /** Bracketed-paste `text` into the session and submit, after `pasteDelay`
   *  ms — shared by sendText and a fresh spawn's spec-carried first message
   *  (paste-delivery vendors, issue #25: the message can't ride the argv). */
  function schedulePaste(entry, text, pasteDelay) {
    setTimeoutFn(() => {
      try {
        entry.pty.write(`\x1b[200~${text}\x1b[201~`)
      } catch {
        return
      }
      setTimeoutFn(() => {
        try {
          entry.pty.write("\r")
        } catch {
          /* best-effort */
        }
      }, submitDelays.enterMs)
    }, pasteDelay)
  }

  async function ensureSession(tabId, taskId, mode, cols, rows) {
    if (stopped) throw new Error("PTY server is shutting down")
    const existing = sessions.get(tabId)
    if (existing) return existing
    const inflight = pendingSpawns.get(tabId)
    if (inflight) return inflight
    const p = (async () => {
      const spec = await fetchSpec(taskId, mode)
      if (stopped) throw new Error("PTY server is shutting down")
      let entry = sessions.get(tabId)
      const spawned = !entry
      if (!entry) entry = spawnSession(tabId, spec, cols, rows)
      // Paste-delivery vendor (kimi — issue #25): the daemon kept the first
      // message OUT of the launch argv, so a FRESH spawn owes it a paste —
      // same fixed-delay rule as sendText's spawn-on-send path. An existing
      // session already received (or never had) it.
      if (spawned && spec.firstMessage) schedulePaste(entry, spec.firstMessage, submitDelays.spawnedPasteMs)
      return entry
    })()
    pendingSpawns.set(tabId, p)
    try {
      return await p
    } finally {
      pendingSpawns.delete(tabId)
    }
  }

  function safePty(tabId, entry, fn) {
    if (sessions.get(tabId) !== entry) return
    try {
      fn(entry.pty)
    } catch {
      /* engine died — its onExit closes sockets and clears the entry */
    }
  }

  function resizePty(tabId, entry, cols, rows) {
    safePty(tabId, entry, (pty) => {
      pty.resize(cols, rows)
      entry.cast?.resize(cols, rows)
    })
  }

  async function attachSocket({ ws, tabId, taskId, mode, cols, rows }) {
    const entry = await ensureSession(tabId, taskId, mode, cols, rows)
    // The browser can leave during the spawn; its close event already fired,
    // so tracking the socket would pin the session as watched forever.
    if (ws.readyState !== ws.OPEN) return entry
    const replay = entry.scrollback.length() > 0 ? entry.scrollback.replay() : ""
    entry.sockets.add(ws)
    clearDetachTimer(entry)
    if (replay && ws.readyState === ws.OPEN) ws.send(replay)
    resizePty(tabId, entry, cols, rows)

    ws.on("message", (raw) => {
      const text = raw.toString()
      if (text.startsWith("{")) {
        try {
          const msg = JSON.parse(text)
          if (msg && msg.type === "resize" && Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
            resizePty(tabId, entry, Math.max(1, msg.cols | 0), Math.max(1, msg.rows | 0))
            return
          }
        } catch {
          /* fall through to raw write */
        }
      }
      safePty(tabId, entry, (pty) => pty.write(text))
    })

    ws.on("close", () => {
      entry.sockets.delete(ws)
      if (sessions.get(tabId) === entry) armDetachTimer(tabId, entry)
    })

    return entry
  }

  function closeSession(tabId) {
    const entry = sessions.get(tabId)
    if (!entry) return false
    clearDrainTimer(entry)
    clearDetachTimer(entry)
    sessions.delete(tabId)
    try {
      terminatePty(entry.pty)
    } catch {
      /* already gone */
    }
    return true
  }

  async function sendText({ tabId, taskId, text }) {
    let entry = sessions.get(tabId)
    let spawned = false
    if (!entry && taskId) {
      entry = await ensureSession(tabId, taskId, "engine", 80, 24)
      spawned = true
    }
    if (!entry) return { sent: false, spawned: false, missing: true }

    const target = entry
    const pasteDelay = spawned ? submitDelays.spawnedPasteMs : submitDelays.existingPasteMs
    schedulePaste(target, text, pasteDelay)
    return { sent: true, spawned }
  }

  /** Append a storyboard marker; false when the tab never recorded. */
  function markCast(tabId, label) {
    const cast = casts.get(tabId)
    if (!cast) return false
    cast.mark(label)
    return true
  }

  /** Hand the tab's recording over (asciicast v2) and forget it. */
  function takeCast(tabId) {
    const cast = casts.get(tabId)
    if (!cast) return null
    casts.delete(tabId)
    return cast.serialize()
  }

  function shutdown() {
    stopped = true
    for (const tabId of sessions.keys()) closeSession(tabId)
    pendingSpawns.clear()
  }

  return {
    attachSocket,
    closeSession,
    ensureSession,
    sendText,
    markCast,
    takeCast,
    shutdown,
    sessionCount: () => sessions.size,
    pendingSpawnCount: () => pendingSpawns.size,
  }
}
