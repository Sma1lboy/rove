import { serializeTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { describe, expect, it } from "vitest"
import { deserializeTask } from "../../src/client/remote-orchestrator-payloads.ts"
import { engineLaunchArgv } from "../../src/engine/engine-presets.ts"
import type { Task } from "../../src/types/task.ts"
import { toTaskId } from "../../src/types/task.ts"

/**
 * `deserializeTask` must faithfully mirror the daemon's `serializeTask`: every
 * field the wire carries and the client `Task` type declares has to survive the
 * round-trip. It used to drop `command`, `position`, `quotaResume`, and
 * `linkedWorkItem`, so a daemon-backed TUI silently launched the vendor default
 * instead of the task's stored custom launch command.
 */
describe("deserializeTask field fidelity", () => {
  const base: Task = {
    id: toTaskId("t1"),
    title: "task",
    repo: "/repo",
    branch: "branch",
    worktreePath: "/wt/task",
    kind: "task",
    status: "backlog",
    archived: false,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  }

  it("round-trips the custom launch command through daemon serialization", () => {
    const task: Task = { ...base, command: "my-claude --dangerously-skip-permissions" }
    const wire = serializeTask(task)
    expect(wire.command).toBe(task.command)
    expect(deserializeTask(wire).command).toBe(task.command)
  })

  it("a deserialized custom command launches that command, not the vendor default", () => {
    const task: Task = { ...base, command: "my-claude --flag", vendor: "claude" }
    const deserialized = deserializeTask(serializeTask(task))
    const argv = engineLaunchArgv({
      command: deserialized.command,
      vendor: deserialized.vendor,
      effort: deserialized.modelEffort,
    })
    // The custom binary leads the argv and its flag survives — not the vendor default.
    expect(argv[0]).toBe("my-claude")
    expect(argv).toContain("--flag")

    const vendorDefault = engineLaunchArgv({ command: undefined, vendor: "claude" })
    expect(vendorDefault[0]).not.toBe("my-claude")
  })

  it("round-trips position, quotaResume, and linkedWorkItem", () => {
    const task: Task = {
      ...base,
      position: 12.5,
      quotaResume: { resumeAt: "2026-08-27T05:00:00.000Z", requestedAt: "2026-08-27T00:00:00.000Z" },
      linkedWorkItem: {
        provider: "github",
        type: "issue",
        number: 42,
        title: "a bug",
        url: "https://github.com/o/r/issues/42",
      },
    }
    const back = deserializeTask(serializeTask(task))
    expect(back.position).toBe(12.5)
    expect(back.quotaResume).toEqual(task.quotaResume)
    expect(back.linkedWorkItem).toEqual(task.linkedWorkItem)
  })
})
