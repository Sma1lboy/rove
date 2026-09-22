/** Process-wide pty-host socket, frame dispatcher and key → handle route table for `HostedTaskPty`. */

import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { ensurePtyHostReachable } from "@sma1lboy/kobe-daemon/client/pty-process"
import type { PtyDataEventPayload, PtyExitEventPayload } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { defaultShell } from "./pty-types"

/** The slice of a `HostedTaskPty` the dispatcher routes frames into. */
export interface HostedRoute {
  readonly taskId: string
  feedFrame(dataB64: string): void
  remoteExited(pid: number | null | undefined): void
}

/**
 * One connection per process (the host speaks the daemon frame grammar). Spawns
 * the host if none runs: the terminal pane may resurrect an idle-exited host.
 */
let shared: Promise<KobeDaemonClient> | null = null

/**
 * Key → live handles for O(1) routing: the client's `emit()` walks every
 * handler per frame, so one `on()` per tab cost N calls on the busiest path.
 * Handles add themselves on open; `cleanup()` (every detach/kill/park/close
 * path) removes them, so a dead tab never gets a stray chunk.
 *
 * A SET per key: a second viewer of one session is legal, and a single slot
 * let the newcomer steal the route, freezing the first while the child kept
 * streaming. Every handle gets every frame; each keeps its own xterm.
 */
const hostedByKey = new Map<string, Set<HostedRoute>>()

export function routeAdd(handle: HostedRoute): void {
  let set = hostedByKey.get(handle.taskId)
  if (!set) {
    set = new Set()
    hostedByKey.set(handle.taskId, set)
  }
  set.add(handle)
}

/** Returns how many siblings remain. */
export function routeRemove(handle: HostedRoute): number {
  const set = hostedByKey.get(handle.taskId)
  if (!set) return 0
  set.delete(handle)
  if (set.size === 0) hostedByKey.delete(handle.taskId)
  return set.size
}

export function routeCount(key: string): number {
  return hostedByKey.get(key)?.size ?? 0
}

const dispatchInstalled = new WeakSet<KobeDaemonClient>()

/** One map lookup per frame; unknown keys (late frames, other processes) drop silently. */
function installDispatch(client: KobeDaemonClient): void {
  if (dispatchInstalled.has(client)) return
  dispatchInstalled.add(client)
  client.on("pty.data", (frame) => {
    const payload = frame.payload as PtyDataEventPayload
    const handles = hostedByKey.get(payload.key)
    if (handles) for (const handle of handles) handle.feedFrame(payload.data)
  })
  client.on("pty.exit", (frame) => {
    const payload = frame.payload as PtyExitEventPayload
    const handles = hostedByKey.get(payload.key)
    // Copy: remoteExited → cleanup mutates the set mid-iteration.
    if (handles) for (const handle of [...handles]) handle.remoteExited(payload.pid)
  })
}

export function getSharedPtyClient(): Promise<KobeDaemonClient> {
  if (shared) return shared
  const p = (async () => {
    const socketPath = await ensurePtyHostReachable()
    const client = new KobeDaemonClient(socketPath)
    await client.connect()
    installDispatch(client)
    client.onLifecycle("close", () => {
      if (shared === p) shared = null
    })
    return client
  })()
  p.catch(() => {
    if (shared === p) shared = null
  })
  shared = p
  return p
}

/**
 * The shared connection only if one exists; never dials. Under a test runner
 * `getSharedPtyClient()` would cache a client on whatever socket was current and
 * starve the suite owning the real one (as `use-host-sessions.ts` documents).
 * In a live TUI the sidebar's host poll keeps this non-null.
 */
export function peekSharedPtyClient(): Promise<KobeDaemonClient> | null {
  return shared
}

/**
 * `pty.warm`: pre-spawn an idle shell for `cwd` so the next shell-wrapped
 * engine tab skips rc startup. Best-effort; an older host just spawns cold.
 */
export function warmHostedShell(cwd: string, shell: string = defaultShell()): void {
  if ((process.env.KOBE_TERMINAL_BACKEND ?? "hosted") !== "hosted") return
  void getSharedPtyClient()
    .then((client) => client.request("pty.warm", { cwd, shell }))
    .catch(() => {})
}
