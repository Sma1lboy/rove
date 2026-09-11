/**
 * The generated pi/omp extension is a BUILD ARTIFACT, so this drives it the
 * way the CLIs do: evaluate the rendered source, hand its default export a
 * fake `pi` API, and fire events at it. Asserting on the spawned argv (not on
 * the source text) is the difference between "the file says turn-start" and
 * "the engine reports turn-start".
 *
 * Evaluated with `new Function` rather than written to disk and imported: the
 * module has no imports (it only uses the `pi` API it is handed), and Vite
 * will not serve a file outside the project root — which is exactly what a
 * temp-dir import is on Windows, where the path arrives as
 * `C:/Users/RUNNER~1/…/Temp/…` and `loadAndTransform` answers "Does the file
 * exist?" for a file that plainly does.
 */

import { describe, expect, it } from "vitest"
import { renderPiExtensionSource } from "../../src/engine/pi-local/extension-source.ts"

interface ExecCall {
  readonly command: string
  readonly args: readonly string[]
}

interface FakePi {
  readonly api: Record<string, unknown>
  readonly execs: ExecCall[]
  fire(event: string, payload?: unknown, ctx?: unknown): Promise<void>
  registered(): readonly string[]
}

function fakePi(): FakePi {
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>()
  const execs: ExecCall[] = []
  const api = {
    on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler])
    },
    exec(command: string, args: string[]) {
      execs.push({ command, args })
      return Promise.resolve({ stdout: "", stderr: "", code: 0 })
    },
  }
  return {
    api,
    execs,
    registered: () => [...handlers.keys()],
    async fire(event, payload = {}, ctx = {}) {
      for (const handler of handlers.get(event) ?? []) await handler(payload, ctx)
      // Let the fire-and-forget spawns settle before assertions read `execs`.
      await Promise.resolve()
    },
  }
}

/** The CLI's own hook context shape, reduced to what the extension reads. */
const CONTEXT = {
  cwd: "/repo/worktree",
  sessionManager: {
    getSessionId: () => "sess-1",
    getSessionFile: () => "/home/u/.omp/agent/sessions/-x/2026-01-01_sess-1.jsonl",
  },
}

function payloadOf(call: ExecCall): Record<string, unknown> {
  const flag = call.args.indexOf("--payload")
  return JSON.parse(call.args[flag + 1] as string) as Record<string, unknown>
}

/**
 * Evaluate the rendered module and return its default export.
 *
 * The only edit to the artifact is the export form — everything else runs
 * verbatim, so the consts and helpers the handlers close over come along.
 */
function loadFactory(source: string): (pi: unknown) => void {
  return new Function(`${source.replace("export default ", "return ")}`)() as (pi: unknown) => void
}

describe("the generated pi-family extension", () => {
  function load(vendor: "pi" | "omp", toolEvents = false): FakePi {
    const factory = loadFactory(renderPiExtensionSource({ vendor, invocation: ["kobe"], toolEvents }))
    const pi = fakePi()
    factory(pi.api)
    return pi
  }

  it("reports a turn start and a turn end as normalized verbs", async () => {
    const pi = load("omp")
    await pi.fire("turn_start", { type: "turn_start" }, CONTEXT)
    await pi.fire("agent_end", { type: "agent_end", messages: [] }, CONTEXT)

    expect(pi.execs.map((c) => c.args[1])).toEqual(["turn-start", "turn-complete"])
    expect(pi.execs[0]?.command).toBe("kobe")
    expect(pi.execs[0]?.args.slice(2, 5)).toEqual(["--engine", "omp", "--payload"])
  })

  it("carries the session identity and cwd the daemon needs", async () => {
    const pi = load("pi")
    await pi.fire("turn_start", {}, CONTEXT)
    expect(payloadOf(pi.execs[0] as ExecCall)).toEqual({
      session_id: "sess-1",
      transcript_path: "/home/u/.omp/agent/sessions/-x/2026-01-01_sess-1.jsonl",
      cwd: "/repo/worktree",
    })
  })

  it("does not call a scheduled continuation the end of the turn", async () => {
    const pi = load("omp")
    await pi.fire("agent_end", { type: "agent_end", willContinue: true }, CONTEXT)
    expect(pi.execs).toEqual([])
  })

  it("reads a failed and an aborted assistant message as turn edges", async () => {
    const pi = load("omp")
    await pi.fire("message_end", { message: { role: "assistant", stopReason: "error", errorMessage: "429" } }, CONTEXT)
    await pi.fire("message_end", { message: { role: "assistant", stopReason: "aborted" } }, CONTEXT)
    // Ordinary user/assistant traffic is not an edge.
    await pi.fire("message_end", { message: { role: "assistant", stopReason: "stop" } }, CONTEXT)
    await pi.fire("message_end", { message: { role: "user" } }, CONTEXT)

    expect(pi.execs.map((c) => c.args[1])).toEqual(["turn-failed", "turn-interrupted"])
    expect(payloadOf(pi.execs[0] as ExecCall).error_message).toBe("429")
  })

  it("reports a give-up after auto-retries, but not a recovered retry", async () => {
    const pi = load("omp")
    await pi.fire("auto_retry_end", { success: true, attempt: 1 }, CONTEXT)
    await pi.fire("auto_retry_end", { success: false, finalError: "insufficient credits" }, CONTEXT)
    expect(pi.execs.map((c) => c.args[1])).toEqual(["turn-failed"])
    expect(payloadOf(pi.execs[0] as ExecCall).error_message).toBe("insufficient credits")
  })

  it("marks an approval prompt as needing a human, and its resolution as running again", async () => {
    const pi = load("omp")
    await pi.fire("tool_approval_requested", { type: "tool_approval_requested", toolName: "bash" }, CONTEXT)
    expect(payloadOf(pi.execs[0] as ExecCall).waiting).toBe("permission")
    await pi.fire("tool_approval_resolved", { type: "tool_approval_resolved", approved: true }, CONTEXT)
    expect(pi.execs.map((c) => c.args[1])).toEqual(["awaiting-input", "turn-start"])
  })

  it("reports a question tool as needing a human, but only for that tool", async () => {
    const pi = load("omp")
    await pi.fire("tool_call", { toolName: "bash" }, CONTEXT)
    expect(pi.execs).toEqual([])
    await pi.fire("tool_call", { toolName: "ask" }, CONTEXT)
    expect(pi.execs.map((c) => c.args[1])).toEqual(["awaiting-input"])
    expect(payloadOf(pi.execs[0] as ExecCall).waiting).toBe("input")
  })

  it("reports the session end last, and awaits it so it survives exit", async () => {
    const pi = load("pi")
    await pi.fire("session_shutdown", {}, CONTEXT)
    expect(pi.execs.map((c) => c.args[1])).toEqual(["session-end"])
  })

  it("keeps the high-volume tool family out unless the volume gate is on", async () => {
    const off = load("pi")
    await off.fire("tool_call", { toolName: "bash" }, CONTEXT)
    // The ungated tool_call subscription only ever fires for the question
    // tool, so an ordinary call spawns nothing.
    expect(off.execs).toEqual([])

    const on = load("pi", true)
    await on.fire("tool_call", { toolName: "bash" }, CONTEXT)
    await on.fire("tool_result", { toolName: "bash", isError: false }, CONTEXT)
    await on.fire("tool_result", { toolName: "bash", isError: true }, CONTEXT)
    expect(on.execs.map((c) => c.args[1])).toEqual(["tool-pre", "tool-post", "tool-failed"])
    expect(payloadOf(on.execs[0] as ExecCall).tool_name).toBe("bash")
  })

  it("never lets a failing spawn surface as an engine error", async () => {
    const factory = loadFactory(renderPiExtensionSource({ vendor: "omp", invocation: ["kobe"], toolEvents: false }))
    const pi = fakePi()
    factory({
      on: pi.api.on,
      exec: () => {
        throw new Error("spawn failed")
      },
    })
    await expect(pi.fire("turn_start", {}, CONTEXT)).resolves.toBeUndefined()
  })
})
