import { expect, it } from "vitest"
import { writeFrame } from "../../../kobe-daemon/src/daemon/client-connection.ts"
import { ClientWriter } from "../../../kobe-daemon/src/daemon/client-writer.ts"
import type { DaemonFrame } from "../../../kobe-daemon/src/daemon/protocol.ts"

it("a slow consumer recovers final full snapshots without losing commands, per-task state or ordered bytes", () => {
  const received: DaemonFrame[] = []
  let drain = () => {}
  let paused = true
  let destroyed = false
  const writer = new ClientWriter(
    {
      write: (line) => {
        received.push(JSON.parse(line))
        return !paused
      },
      once: (_event, cb) => {
        drain = cb
      },
      destroy: () => {
        destroyed = true
      },
    },
    { highWaterMark: 32 * 1024 },
  )
  const client = { writer }
  const send = (frame: DaemonFrame) => writeFrame(client, frame)
  send({ type: "response", id: "initial", payload: {} })
  send({ type: "event", name: "task.snapshot", payload: { tasks: ["old"] } })
  send({ type: "event", name: "task.snapshot", payload: { tasks: ["FINAL"] } })
  const ordered: DaemonFrame[] = [
    ...Array.from(
      { length: 30 },
      (_, i): DaemonFrame => ({ type: "event", name: "engine-state", payload: { taskId: `t${i}`, state: "idle" } }),
    ),
    ...(
      [
        "session.deliver",
        "task.jobs",
        "issue.snapshot",
        "keybindings",
        "notice.event",
        "tab.open",
        "tab.close",
        "engine.lifecycle",
        "ui.prompt",
        "pty.data",
        "pty.exit",
        "daemon.stopping",
      ] as const
    ).flatMap((name): DaemonFrame[] => [
      { type: "event", name, payload: { value: 1 } },
      { type: "event", name, payload: { value: 2 } },
    ]),
    { type: "response", id: "rpc", payload: "done" },
  ]
  for (const frame of ordered) send(frame)
  for (let i = 0; i < 1000; i++) send({ type: "event", name: "worktree.changes", payload: { changes: { latest: i } } })
  expect(destroyed).toBe(false)
  paused = false
  drain()
  expect(received).toEqual([
    { type: "response", id: "initial", payload: {} },
    { type: "event", name: "task.snapshot", payload: { tasks: ["FINAL"] } },
    ...ordered,
    { type: "event", name: "worktree.changes", payload: { changes: { latest: 999 } } },
  ])
  expect(writer.pendingBytes).toBe(0)
})
