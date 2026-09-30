import type { Cast } from "./pty-cast.mjs"
import type { Scrollback } from "./pty-scrollback.mjs"

export type PtyMode = "engine" | "shell"

export interface PtyLaunchSpec {
  cwd: string
  command: string[]
}

export interface PtyLike {
  onData(cb: (data: string) => void): void
  onExit(cb: () => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  pause?(): void
  resume?(): void
}

export interface PtySocketLike {
  OPEN: number
  readyState: number
  bufferedAmount?: number
  send(data: string): void
  close(code?: number, reason?: string): void
  on(event: "message", cb: (raw: { toString(): string }) => void): void
  on(event: "close", cb: () => void): void
}

export interface PtySessionManagerOptions {
  fetchSpec(taskId: string, mode: PtyMode): Promise<PtyLaunchSpec>
  spawnPty(
    command: string,
    args: string[],
    options: {
      name: string
      cols: number
      rows: number
      cwd: string
      env: NodeJS.ProcessEnv | Record<string, string>
    },
  ): PtyLike
  createScrollback(cap: number): Scrollback
  scrollbackCap: number
  env: NodeJS.ProcessEnv | Record<string, string> | (() => NodeJS.ProcessEnv | Record<string, string>)
  setTimeoutFn?: (cb: () => void, ms: number) => unknown
  clearTimeoutFn?: (handle: unknown) => void
  setIntervalFn?: (cb: () => void, ms: number) => unknown
  clearIntervalFn?: (handle: unknown) => void
  submitDelays?: {
    spawnedPasteMs: number
    existingPasteMs: number
    enterMs: number
  }
  maxSessions?: number
  /** Kill a session after this long with no attached socket. */
  detachGraceMs?: number
  backpressure?: {
    highWaterBytes: number
    lowWaterBytes: number
    drainPollMs: number
  }
  /** Record every tab as an asciicast (film capture). Absent → no recording. */
  createCast?: ((opts: { cols: number; rows: number }) => Cast) | null
}

export interface AttachSocketInput {
  ws: PtySocketLike
  tabId: string
  taskId: string
  mode: PtyMode
  cols: number
  rows: number
}

export interface SendTextInput {
  tabId: string
  taskId: string | null
  text: string
}

export interface PtySessionManager {
  attachSocket(input: AttachSocketInput): Promise<unknown>
  closeSession(tabId: string): boolean
  ensureSession(tabId: string, taskId: string, mode: PtyMode, cols: number, rows: number): Promise<unknown>
  sendText(input: SendTextInput): Promise<{ sent: boolean; spawned: boolean; missing?: boolean }>
  /** Append a marker to the tab's recording; false when it has none. */
  markCast(tabId: string, label: string): boolean
  /** The tab's recording as asciicast v2, removed from the manager; null when none. */
  takeCast(tabId: string): string | null
  shutdown(): void
  sessionCount(): number
  pendingSpawnCount(): number
}

export function createPtySessionManager(options: PtySessionManagerOptions): PtySessionManager

export function pickEvictableTab(
  sessions: Iterable<[string, { sockets: { size: number } }]>,
): string | null

/** Only the buffer-state fields are read, so the helpers accept any socket-ish
 *  object (the live `ws` socket and test doubles both satisfy this). */
export interface PtyBufferSocket {
  OPEN: number
  readyState: number
  bufferedAmount?: number
}

export function shouldPausePty(
  sockets: Iterable<PtyBufferSocket>,
  highWaterBytes: number,
): boolean

export function shouldResumePty(
  sockets: Iterable<PtyBufferSocket>,
  lowWaterBytes: number,
): boolean
