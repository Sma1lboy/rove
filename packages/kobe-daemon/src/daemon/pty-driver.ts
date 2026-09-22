/**
 * How a PTY child gets spawned — the PTY host's one runtime-specific seam,
 * kept narrow so ring buffer, OSC titles, park/replay and sweep stay
 * single-implementation on every platform.
 *
 *   - `bunTerminalDriver` — `Bun.spawn(..., { terminal })`; macOS and Linux.
 *   - `nodePtyDriver` — `node-pty` (ConPTY); Windows only, and under NODE:
 *     from Bun, writes to the ConPTY input pipe fail with `ERR_SOCKET_CLOSED`,
 *     and Bun's `terminal` option is rejected on Windows. Hence a separate
 *     node PTY host there.
 */

import { taskkillProcessTree } from "./process-tree.ts"

/** How a PTY child ended. `code` XOR `signal` for a normal wait; both
 *  null when the runtime could not tell. */
export interface PtyExit {
  readonly code: number | null
  readonly signal: string | null
}

/** The slice of a spawned PTY child that `PtyHost` actually drives. */
export interface PtyChild {
  readonly pid: number
  /** Never rejects meaningfully; an unknowable status resolves `{code:null,signal:null}`. */
  readonly exited: Promise<PtyExit>
  write(data: string): void
  resize(cols: number, rows: number): void
  /** Release the pty handle once exited. Must tolerate being called twice. */
  close(): void
  kill(signal: NodeJS.Signals): void
  /**
   * End the child AND its descendants; resolves with one signal-log line.
   * Only where no process group exists to signal (node-pty on Windows).
   * `terminatePtyChild` runs it BEFORE `kill()`, while the tree is walkable.
   */
  readonly endTree?: () => Promise<string>
}

export interface PtySpawnRequest {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  readonly cols: number
  readonly rows: number
  /** Raw child output. `PtyHost` normalises to Buffer. */
  onData(data: string | Uint8Array): void
}

export type PtyDriver = (request: PtySpawnRequest) => PtyChild

const TERMINAL_NAME = "xterm-256color"

/** The terminal handle Bun hangs off a spawned proc. Absent once it exits. */
export interface BunTerminalHandle {
  write(data: string): void
  resize(cols: number, rows: number): void
  close(): void
}

/** The slice of `Bun.spawn`'s result this driver drives. */
export interface BunTerminalProc {
  readonly pid: number
  readonly exited: Promise<unknown>
  /** Set once the child exits (null when signal-killed) — Bun's Subprocess. */
  readonly exitCode?: number | null
  /** Set once the child exits from a signal — Bun's Subprocess. */
  readonly signalCode?: string | null
  readonly terminal?: BunTerminalHandle
  kill(signal: NodeJS.Signals): void
}

export interface BunTerminalOptions {
  cwd: string
  env: Record<string, string | undefined>
  terminal: { cols: number; rows: number; name: string; data: (terminal: unknown, data: Uint8Array) => void }
}

export type BunTerminalSpawn = (argv: string[], options: BunTerminalOptions) => BunTerminalProc

/** `spawn` is injectable because `Bun` isn't a global under the test runner. */
export function bunTerminalDriver(spawn?: BunTerminalSpawn): PtyDriver {
  const spawnTerminal =
    spawn ??
    // biome-ignore lint/suspicious/noExplicitAny: `terminal` is absent from Bun's public SpawnOptions type.
    ((argv, options) => (Bun.spawn as any)(argv, options) as BunTerminalProc)
  return (request) => {
    const proc = spawnTerminal([...request.argv], {
      cwd: request.cwd,
      env: request.env,
      terminal: {
        cols: request.cols,
        rows: request.rows,
        name: TERMINAL_NAME,
        data: (_terminal: unknown, data: Uint8Array) => request.onData(data),
      },
    })
    return {
      pid: proc.pid,
      // Read the properties AFTER settle: only they carry the signal.
      exited: proc.exited.then(
        () => ({ code: proc.exitCode ?? null, signal: proc.signalCode ?? null }),
        () => ({ code: null, signal: null }),
      ),
      // The handle vanishes on exit; a late write must not throw past the host.
      write: (data) => proc.terminal?.write(data),
      resize: (cols, rows) => proc.terminal?.resize(cols, rows),
      close: () => proc.terminal?.close(),
      kill: (signal) => proc.kill(signal),
    }
  }
}

/** The slice of node-pty's child this driver drives. */
export interface NodePtyChild {
  readonly pid: number
  onData(listener: (data: string) => void): unknown
  onExit(listener: (event: { exitCode: number }) => void): unknown
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

/** node-pty's `spawn`, narrowed to what this driver passes it. */
export type NodePtySpawn = (
  file: string,
  args: readonly string[],
  options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
) => NodePtyChild

/**
 * Async: node-pty is a napi module loaded only where needed, not in every
 * Bun daemon. `spawn` is injectable to test without the native binding.
 */
export async function nodePtyDriver(
  spawn?: NodePtySpawn,
  endTree: (pid: number, shellFile?: string) => Promise<string> = taskkillProcessTree,
): Promise<PtyDriver> {
  const spawnPty = spawn ?? ((await import("node-pty")).spawn as unknown as NodePtySpawn)
  return (request) => {
    const [file, ...args] = request.argv
    const child = spawnPty(file ?? "", args, {
      name: TERMINAL_NAME,
      cols: request.cols,
      rows: request.rows,
      cwd: request.cwd,
      env: Object.fromEntries(
        Object.entries(request.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
    })
    let settle: (exit: PtyExit) => void = () => {}
    const exited = new Promise<PtyExit>((resolve) => {
      settle = resolve
    })
    child.onData((data) => request.onData(data))
    // ConPTY has no signals — the exit code is the whole story here.
    child.onExit(({ exitCode }) => settle({ code: exitCode, signal: null }))
    return {
      pid: child.pid,
      exited,
      write: (data) => child.write(data),
      resize: (cols, rows) => child.resize(cols, rows),
      // Handle lives with the child; `kill()` after exit throws.
      close: () => {},
      // Every kill is TerminateProcess on the shell alone (SIGTERM = SIGKILL).
      // `endTree` reaches descendants; the shell path lets a Git Bash tree be
      // read from MSYS's own table.
      kill: () => child.kill(),
      endTree: () => endTree(child.pid, file),
    }
  }
}
