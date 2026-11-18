import { afterEach, describe, expect, it, vi } from "vitest"
import { PipeTaskPty } from "../../src/tui/panes/terminal/pty-pipe"
import type { TaskPtyLike, TerminalRow } from "../../src/tui/panes/terminal/pty-types"

const children: TaskPtyLike[] = []

afterEach(() => {
  for (const child of children.splice(0)) child.kill()
})

function withOuterTerminalIdentity<T>(run: () => T): T {
  const program = process.env.TERM_PROGRAM
  const version = process.env.TERM_PROGRAM_VERSION
  process.env.TERM_PROGRAM = "iTerm.app"
  process.env.TERM_PROGRAM_VERSION = "3.6.11"
  try {
    return run()
  } finally {
    if (program === undefined) Reflect.deleteProperty(process.env, "TERM_PROGRAM")
    else process.env.TERM_PROGRAM = program
    if (version === undefined) Reflect.deleteProperty(process.env, "TERM_PROGRAM_VERSION")
    else process.env.TERM_PROGRAM_VERSION = version
  }
}

function rowsText(rows: readonly TerminalRow[]): string {
  return rows.map((row) => row.map((chunk) => chunk.text).join("")).join("\n")
}

const settled = { timeout: 3000 }

describe("PipeTaskPty child environment", () => {
  it("does not leak the outer terminal identity through the pipe fallback", async () => {
    const pty = withOuterTerminalIdentity(
      () =>
        new PipeTaskPty({
          taskId: "pipe-env",
          cwd: process.cwd(),
          command: [
            "/bin/sh",
            "-c",
            `printf '\\033]2;env-probe\\007program=%s version=%s\\n' "\${TERM_PROGRAM-unset}" "\${TERM_PROGRAM_VERSION-unset}"; exec cat`,
          ],
          cols: 60,
          rows: 8,
        }),
    )
    children.push(pty)

    let latest: readonly TerminalRow[] = []
    const titles: string[] = []
    let exits = 0
    pty.onData((rows) => {
      latest = rows
    })
    pty.onTitleChange((title) => titles.push(title))
    pty.onExit(() => exits++)

    await vi.waitFor(() => expect(rowsText(latest)).toContain("program=unset version=unset"), settled)
    await vi.waitFor(() => expect(titles).toContain("env-probe"), settled)

    pty.write("echo-through-pipe\r")
    await vi.waitFor(() => expect(rowsText(latest)).toContain("echo-through-pipe"), settled)
    pty.resize(72, 9)
    expect(pty.captureCursor()).toBeNull()
    expect(pty.wheel()).toBe(false)

    pty.kill()
    expect(pty.killed).toBe(true)
    expect(exits).toBe(1)
  })
})
