/** A failed engine must not read as a successful one through `rove api`:
 *  what `add` resolved, what `collect` reports for a turn that died on screen,
 *  and what `send` says when it pastes into a failed session. */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { protocolEntry } from "../../src/engine/engine-presets.ts"
import { screenErrorLine } from "../../src/engine/screen-state.ts"
import { FakeClient, recordingDelivery, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const screen = vi.hoisted(() => ({ error: undefined as string | undefined }))
vi.mock("../../src/cli/api/engine-screen.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/cli/api/engine-screen.ts")>()),
  engineScreenError: async () => screen.error,
}))

beforeEach(() => {
  screen.error = undefined
})

/** A daemon whose activity dump holds one task in `state`. */
function daemonWith(state: string, detail?: Record<string, unknown>) {
  const task = taskFixture({ vendor: "codex", command: "codex" })
  return new FakeClient({
    "task.get": () => ({ task }),
    "debug.inspect": () => ({
      activity: { tasks: { t1: { state, at: Date.now() - 1000, ...(detail ? { detail } : {}) } }, tabs: {} },
    }),
  })
}

describe("add reports what it will launch", () => {
  it("names the resolved engine and warns when the model belongs to another vendor", async () => {
    const client = new FakeClient({
      "task.create": (payload) => ({ taskId: "t1", task: taskFixture(payload as Record<string, unknown>) }),
    })
    const result = await invokeVerb(
      "add",
      ["--repo", "/repo/x", "--command", "codex", "--model", "claude-sonnet-5-5"],
      { client, runtime: stubRuntime() },
    )
    expect(result).toMatchObject({
      engine: { vendor: "codex", command: "codex", model: "claude-sonnet-5-5" },
      warnings: [expect.stringContaining("codex is unlikely to run model")],
    })
  })

  it("stays quiet for a model in the engine's own family", async () => {
    const client = new FakeClient({
      "task.create": (payload) => ({ taskId: "t1", task: taskFixture(payload as Record<string, unknown>) }),
    })
    const result = await invokeVerb("add", ["--repo", "/repo/x", "--command", "codex", "--model", "gpt-5.5"], {
      client,
      runtime: stubRuntime(),
    })
    expect(result).not.toHaveProperty("warnings")
  })
})

describe("collect sees a turn that failed on screen", () => {
  it("reports error with the engine's text instead of idle", async () => {
    screen.error = "■ The 'claude-sonnet-5-5' model is not supported when using Codex with a ChatGPT account."
    const result = (await invokeVerb("collect", ["--task-ids", "t1"], {
      client: daemonWith("idle"),
      runtime: stubRuntime(),
    })) as { tasks: Array<{ activity: Record<string, unknown> }> }
    expect(result.tasks[0]?.activity).toMatchObject({
      state: "error",
      source: "screen",
      detail: { note: screen.error },
    })
  })

  it("leaves a clean idle engine idle", async () => {
    const result = (await invokeVerb("collect", ["--task-ids", "t1"], {
      client: daemonWith("idle"),
      runtime: stubRuntime(),
    })) as { tasks: Array<{ activity: Record<string, unknown> }> }
    expect(result.tasks[0]?.activity).toMatchObject({ state: "idle" })
    expect(result.tasks[0]?.activity).not.toHaveProperty("source")
  })
})

describe("send says what it pasted into", () => {
  it("flags a target that was already in error", async () => {
    const result = await invokeVerb("send", ["--task-id", "t1", "--prompt", "hi", "--plain"], {
      client: daemonWith("error", { failure: "billing", note: "credit balance too low" }),
      runtime: stubRuntime({ deliverPrompt: recordingDelivery().deliver }),
    })
    expect(result).toMatchObject({
      delivered: true,
      targetState: "error",
      targetDetail: { note: "credit balance too low" },
    })
  })

  it("adds nothing for a healthy target", async () => {
    const result = await invokeVerb("send", ["--task-id", "t1", "--prompt", "hi", "--plain"], {
      client: daemonWith("turn_complete"),
      runtime: stubRuntime({ deliverPrompt: recordingDelivery().deliver }),
    })
    expect(result).not.toHaveProperty("targetState")
  })
})

describe("codex's screen error row", () => {
  const errorLine = protocolEntry("codex").errorLine as RegExp
  // codex separates the history from the composer with a blank row.
  const footer = ["", "› Ask Codex to do anything", "", "  ? for shortcuts            100% context left"]

  it("is found at the bottom of the screen", () => {
    const rows = ["› fix the bug", "■ unexpected status 400 Bad Request: model not supported", ...footer]
    expect(screenErrorLine(errorLine, rows)).toBe("■ unexpected status 400 Bad Request: model not supported")
  })

  it("joins the rows a long error wrapped onto", () => {
    // Measured: codex given a claude model under a ChatGPT login draws this.
    const rows = [
      "• Working",
      '■ {"type":"error","status":400,"error":',
      '{"type":"invalid_request_error","message":"The \'claude-sonnet-5-5\' model is not',
      'supported when using Codex with a ChatGPT account."}}',
    ]
    expect(screenErrorLine(errorLine, rows)).toContain("not supported when using Codex with a ChatGPT account")
  })

  it("counts for a turn still claimed as running only when nothing was drawn after it", () => {
    const ended = ["• Working", "■ stream error: model not supported"]
    const retried = [...ended, "", "› try again", "• Working (3s • esc to interrupt)"]
    expect(screenErrorLine(errorLine, ended, { last: true })).toBe("■ stream error: model not supported")
    expect(screenErrorLine(errorLine, retried, { last: true })).toBeUndefined()
  })

  it("is ignored once a later turn has scrolled it off the bottom", () => {
    const later = Array.from({ length: 20 }, (_, i) => `• worked on step ${i}`)
    const rows = ["■ stream disconnected before completion", ...later, ...footer]
    expect(screenErrorLine(errorLine, rows)).toBeUndefined()
  })

  it("does not treat an interrupt notice as an error", () => {
    const rows = ["⚠ Conversation interrupted - tell the model what to do differently.", ...footer]
    expect(screenErrorLine(errorLine, rows)).toBeUndefined()
  })
})
