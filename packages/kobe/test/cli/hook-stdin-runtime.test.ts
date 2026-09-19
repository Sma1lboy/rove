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

  it("prefers Bun's own reader when running under Bun", async () => {
    const text = vi.fn(async () => '{"from":"bun"}')
    vi.stubGlobal("Bun", { stdin: { text } })
    useStdin(pipedStdin('{"from":"node"}'))
    expect(await readStdinText()).toBe('{"from":"bun"}')
    expect(text).toHaveBeenCalledOnce()
  })
})

/**
 * Some engines write their one JSON object and then WAIT for the hook to exit
 * without closing the pipe. Reading to EOF never returns for those, the
 * caller's 500 ms race wins, and the payload that was already in the buffer is
 * discarded — the hook fires carrying no session id and no cwd, which looks
 * exactly like no hook at all.
 */
describe("readStdinText with a completeness predicate", () => {
  /** A pipe that delivers `text` and is never closed by its writer. */
  function unclosedStdin(text: string): PassThrough {
    const stream = new PassThrough()
    stream.write(text)
    return stream
  }

  const completeJson = (text: string): boolean => {
    try {
      JSON.parse(text)
      return true
    } catch {
      return false
    }
  }

  it("returns the payload from a writer that never closes the pipe", async () => {
    useStdin(unclosedStdin('{"sessionId":"s1","cwd":"/repo"}'))
    expect(await readStdinText(completeJson)).toBe('{"sessionId":"s1","cwd":"/repo"}')
  })

  it("keeps reading while the document is still arriving in pieces", async () => {
    const stream = new PassThrough()
    stream.write('{"sessionId":')
    setTimeout(() => stream.write('"s1"}'), 5)
    useStdin(stream)
    expect(await readStdinText(completeJson)).toBe('{"sessionId":"s1"}')
  })

  // Without the predicate the same stream is what it always was: a read that
  // only ends at EOF. This is the behaviour every closing writer still gets.
  it("still reads a closing writer to EOF, predicate or not", async () => {
    useStdin(pipedStdin('{"session_id":"s1"}'))
    expect(await readStdinText(completeJson)).toBe('{"session_id":"s1"}')
    useStdin(pipedStdin('{"session_id":"s1"}'))
    expect(await readStdinText()).toBe('{"session_id":"s1"}')
  })

  it("does not stop early on text that is not yet a document", async () => {
    useStdin(pipedStdin("not json at all"))
    expect(await readStdinText(completeJson)).toBe("not json at all")
  })

  // An empty buffer is not a document either — a writer that has sent nothing
  // yet must not end the read on its first empty chunk.
  it("does not treat an empty or blank buffer as complete", async () => {
    const stream = new PassThrough()
    stream.write("")
    stream.write("   ")
    setTimeout(() => stream.end('{"sessionId":"s1"}'), 5)
    useStdin(stream)
    expect(await readStdinText(completeJson)).toBe('   {"sessionId":"s1"}')
  })
})
