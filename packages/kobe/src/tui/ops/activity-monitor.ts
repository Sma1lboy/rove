/** Per-PTY turn polling. Completion evidence must name this session's file. */
import { createHash } from "node:crypto"
import { type EngineScreenManifest, classifyScreen } from "@/engine/screen-state"
import type { ChatTabTurnState, EngineTurnDetector } from "@/engine/turn-detector"
import { TURN_STATUS_POLL_MS, nextTurnStatusPollDelay } from "./activity-poll"

export interface TurnSession {
  readonly id: string
  readonly transcriptPath: string
}

export interface TurnStatusIo {
  readonly sessionAttached: () => Promise<boolean>
  readonly capturePane: () => Promise<string>
  readonly setTurnState: (state: ChatTabTurnState) => Promise<void>
}

export interface TurnStatusOpts {
  readonly detector: Pick<EngineTurnDetector, "supportsCompletionMarkers" | "latestActivityInFile">
  /** Current hook-confirmed identity. Missing identity never permits a directory scan. */
  readonly session: () => TurnSession | null
  readonly screenManifest?: EngineScreenManifest
}

function sameSession(a: TurnSession | null, b: TurnSession | null): boolean {
  return a?.id === b?.id && a?.transcriptPath === b?.transcriptPath
}

/** Each loop owns one PTY. Session changes invalidate pending reads and completion baselines. */
export function startTurnStatusPoll(opts: TurnStatusOpts, io: TurnStatusIo): () => void {
  let disposed = false
  let primed = false
  let session: TurnSession | null = null
  let baseline: string | null = null
  let paneHash = ""
  let changed = false
  let stable = 0
  let published: ChatTabTurnState | null = null
  let lastMtime = 0
  let delay = TURN_STATUS_POLL_MS
  let timer: ReturnType<typeof setTimeout> | undefined

  async function publish(state: ChatTabTurnState): Promise<void> {
    if (disposed || state === published) return
    published = state
    await io.setTurnState(state)
  }

  function screenState(text: string): ChatTabTurnState | null {
    if (!opts.screenManifest) return "unknown"
    switch (classifyScreen(opts.screenManifest, text)) {
      case "working":
        return "running"
      case "blocked":
        return "needs_input"
      case "idle":
        return "idle"
      default:
        return published === null ? "unknown" : null
    }
  }

  async function poll(): Promise<void> {
    try {
      if (!(await io.sessionAttached()) || disposed) return
      const current = opts.session()
      const text = await io.capturePane()
      if (disposed || !sameSession(current, opts.session())) return
      const markerMode = opts.detector.supportsCompletionMarkers() && current !== null
      const scan = markerMode ? await opts.detector.latestActivityInFile(current.transcriptPath) : null
      if (disposed || !sameSession(current, opts.session())) return
      const hash = createHash("sha1").update(text).digest("hex")
      const reset = !primed || !sameSession(session, current)
      if (reset) {
        session = current
        baseline = scan?.marker?.id ?? null
        paneHash = hash
        changed = false
        stable = 0
        lastMtime = scan?.mtimeMs ?? 0
        primed = true
        published = null
        await publish(markerMode ? (scan ? "idle" : "unknown") : (screenState(text) ?? "unknown"))
        delay = TURN_STATUS_POLL_MS
        return
      }

      if (hash !== paneHash) {
        paneHash = hash
        changed = true
        stable = 0
        if (markerMode) await publish("running")
      } else if (changed) {
        stable++
      }

      if (!markerMode) {
        const state = screenState(text)
        if (state !== null) await publish(state)
      } else if (scan && changed && stable >= 2 && scan.marker && scan.marker.id !== baseline) {
        baseline = scan.marker.id
        changed = false
        stable = 0
        await publish("done")
      }

      const mtime = scan?.mtimeMs ?? 0
      delay = nextTurnStatusPollDelay(delay, mtime > lastMtime, published)
      lastMtime = mtime
    } catch {
      // A failed scoped read is unknown evidence, never a sibling's completion.
      delay = TURN_STATUS_POLL_MS
    } finally {
      if (!disposed) timer = setTimeout(() => void poll(), delay)
    }
  }

  void poll()
  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
  }
}
