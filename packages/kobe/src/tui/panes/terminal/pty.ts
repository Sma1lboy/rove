/**
 * Terminal pane backends (`KOBE_TERMINAL_BACKEND`):
 *   - `hosted` (default, `pty-hosted.ts`): PTY lives in the standalone pty-host,
 *     so a session survives TUI exits AND daemon restarts, with scrollback.
 *   - `bun-pty`: Bun's native PTY in the TUI process.
 *   - `pipe`: for old Bun builds / unsupported platforms; no emulator, parsed via `sgr.ts`.
 *
 * The PTY backends feed headless xterm (`pty-xterm-base.ts`), whose cell grid
 * renders DIRECTLY to `Chunk[]` rows. Never re-serialize cells to ANSI and
 * re-parse: that round-trip is where render bugs lived.
 */

import { embeddedTerminalEnv } from "@sma1lboy/kobe-daemon/daemon/pty-env"
import { HostedTaskPty } from "./pty-hosted"
import { MockTaskPty } from "./pty-mock"
import { PipeTaskPty } from "./pty-pipe"
import { type TaskPtyLike, type TaskPtyOpts, resolveArgv } from "./pty-types"
import { XtermTaskPty } from "./pty-xterm-base"

export type {
  CursorPos,
  ParkedScreen,
  TaskPtyLike,
  TaskPtyOpts,
  TerminalRow,
  TerminalSnapshotWindow,
} from "./pty-types"

/* Bun PTY backend: a local child that dies with the TUI process. */

export class BunTerminalTaskPty extends XtermTaskPty {
  private readonly proc: ReturnType<typeof Bun.spawn>

  constructor(opts: TaskPtyOpts) {
    super(opts)
    this.proc = Bun.spawn(resolveArgv(opts), {
      cwd: opts.cwd,
      env: embeddedTerminalEnv(process.env, {
        TERM: "xterm-256color",
        COLUMNS: String(this.cols),
        LINES: String(this.rows),
        BASH_SILENCE_DEPRECATION_WARNING: "1",
        KOBE_TERMINAL_PTY: "1",
      }),
      terminal: {
        cols: this.cols,
        rows: this.rows,
        name: "xterm-256color",
        data: (_terminal, data) => this.feed(data),
        exit: () => this.markDead(false),
      },
    })
    void this.proc.exited.then(
      () => this.markDead(false),
      () => this.markDead(false),
    )
    this.proc.unref?.()
    if (opts.initialInput) this.transportWrite(opts.initialInput)
  }

  get shellPid(): number | null {
    return this.proc.pid ?? null
  }

  protected transportWrite(data: string): void {
    this.proc.terminal?.write(data)
  }

  protected transportResize(cols: number, rows: number): void {
    this.proc.terminal?.resize(cols, rows)
  }

  protected transportKill(): void {
    try {
      this.proc.terminal?.close()
    } catch {
      /* best effort */
    }
    try {
      this.proc.kill("SIGTERM")
    } catch {
      /* best effort */
    }
  }
}

export function createTaskPty(opts: TaskPtyOpts): TaskPtyLike {
  const backend = process.env.KOBE_TERMINAL_BACKEND ?? "hosted"
  if (backend === "mock") return new MockTaskPty(opts)
  if (backend === "pipe") return new PipeTaskPty(opts)
  if (backend === "bun-pty") return new BunTerminalTaskPty(opts)
  if (backend === "hosted") return new HostedTaskPty(opts)
  throw new Error(`unknown terminal backend: ${backend}`)
}

export type TaskPty = TaskPtyLike
