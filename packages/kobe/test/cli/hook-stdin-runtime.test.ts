/**
 * The hook's stdin payload has to survive the runtime the PUBLISHED CLI
 * actually runs under.
 *
 * `Bun.stdin.text()` was the only reader, and the npm bin is
 * `#!/usr/bin/env node` over a plain bundle — so in every released build the
 * bare `Bun` reference threw, the caller's catch swallowed it, and each hook
 * fired with an empty payload: no session id, no failure class, no cwd.
 * Nothing looked broken, because a hook inside a Rove tab still had
 * `KOBE_TASK_ID` in its environment to fall back on.
 *
 * Vitest runs under node, so "there is no Bun global here" is the real
 * condition rather than a simulated one.
 */

import { PassThrough } from "node:stream"
import { afterEach, describe, expect, it, vi } from "vitest"
import { readStdinText } from "../../src/cli/hook-cmd.ts"

/** Stand in for `process.stdin`: a pipe (isTTY undefined) carrying `text`. */
function pipedStdin(text: string): PassThrough {
  const stream = new PassThrough()
  stream.end(text)
  return stream
}

const realStdin = process.stdin

function useStdin(stream: unknown): void {
  Object.defineProperty(process, "stdin", { value: stream, configurable: true })
}

afterEach(() => {
  useStdin(realStdin)
  vi.unstubAllGlobals()
})

describe("readStdinText", () => {
  it("reads a piped payload with no Bun global — the published CLI's runtime", async () => {
    expect((globalThis as { Bun?: unknown }).Bun).toBeUndefined()
    useStdin(pipedStdin('{"session_id":"s1","cwd":"/repo"}'))
    expect(await readStdinText()).toBe('{"session_id":"s1","cwd":"/repo"}')
  })

  it("returns empty for an empty pipe rather than hanging", async () => {
    useStdin(pipedStdin(""))
    expect(await readStdinText()).toBe("")
  })

  // A hook is always spawned with a pipe. A person typing `rove hook` by hand
  // gets "" immediately instead of a terminal that looks frozen.
  it("does not wait on a TTY", async () => {
    const tty = new PassThrough() as PassThrough & { isTTY?: boolean }
    tty.isTTY = true // never ended: a read would hang if it were attempted
    useStdin(tty)
    expect(await readStdinText()).toBe("")
  })
})
