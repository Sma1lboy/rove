import { createServer } from "node:net"
import { join } from "node:path"
import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { ClientWriter } from "@sma1lboy/kobe-daemon/daemon/client-writer"
import {
  DAEMON_PROTOCOL_VERSION,
  MIN_COMPATIBLE_PROTOCOL_VERSION,
  frameToLine,
} from "@sma1lboy/kobe-daemon/daemon/protocol"
import { expect, it } from "vitest"
import { LineReceiver } from "../../../kobe-daemon/src/daemon/line-receiver.ts"
import { RemoteOrchestrator } from "../../src/client/remote-orchestrator.ts"
import { bootDaemonHarness, waitFor } from "./harness.ts"

it.each(["pane", "gui"] as const)(
  "the real %s client rejects outstanding RPCs and reconnects with final subscribe replay after overflow",
  async (role) => {
    const h = await bootDaemonHarness()
    const path = join(h.dir, "slow.sock")
    let subscriptions = 0
    let overflows = 0
    const raw = createServer((socket) => {
      let blocked = false
      const writer = new ClientWriter(
        {
          write: (line) => {
            socket.write(line)
            return !blocked
          },
          once: (event, listener) => {
            if (!blocked) socket.once(event, listener)
          },
          destroy: () => socket.destroy(),
        },
        {
          highWaterMark: 1024,
          onOverflow: () => {
            overflows++
            socket.destroy()
          },
        },
      )
      const receiver = new LineReceiver()
      socket.on("error", () => {})
      socket.on("data", (chunk: Buffer) =>
        receiver.push(chunk, (line) => {
          const request = JSON.parse(line)
          if (request.name === "task.ensureWorktree") {
            blocked = true
            writer.write(frameToLine({ type: "event", name: "active-task", payload: { taskId: null } }))
            for (let i = 0; i < 100; i++)
              writer.write(frameToLine({ type: "response", id: `other-${i}`, payload: "x".repeat(1024) }))
            return
          }
          const payload =
            request.name === "hello"
              ? {
                  tasks: [],
                  protocolVersion: DAEMON_PROTOCOL_VERSION,
                  minProtocolVersion: MIN_COMPATIBLE_PROTOCOL_VERSION,
                }
              : {}
          writer.write(frameToLine({ type: "response", id: request.id, payload }))
          if (request.name === "subscribe") {
            subscriptions++
            writer.write(
              frameToLine({
                type: "event",
                name: "task.snapshot",
                payload: {
                  tasks:
                    subscriptions === 1
                      ? []
                      : [
                          {
                            id: "final",
                            title: "FINAL",
                            repo: "/repo",
                            branch: "final",
                            worktreePath: "/wt/final",
                            status: "backlog",
                            createdAt: "",
                            updatedAt: "",
                          },
                        ],
                },
              }),
              "task.snapshot",
            )
          }
        }),
      )
    })
    await new Promise<void>((resolve) => raw.listen(path, resolve))
    const client = new KobeDaemonClient(path)
    const orch = new RemoteOrchestrator(client, { role, ensureReachable: async () => {} })
    try {
      await orch.init()
      // Blocking RPCs have no deadline; rejection must come from the connection close.
      await expect(client.request("task.ensureWorktree", { id: "pending" })).rejects.toThrow("connection closed")
      expect(overflows).toBe(1)
      expect(await waitFor(() => orch.listTasks()[0]?.title === "FINAL", 3000)).toBe(true)
      expect(subscriptions).toBe(2)
      expect(orch.connectionStateSignal()()).toBe("online")
    } finally {
      orch.dispose()
      await new Promise<void>((resolve) => raw.close(() => resolve()))
      await h.close()
    }
  },
)
