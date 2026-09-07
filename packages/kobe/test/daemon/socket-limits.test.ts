import { connect } from "node:net"
import { join } from "node:path"
import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { startPtyHostServer } from "@sma1lboy/kobe-daemon/daemon/pty-server"
import { afterEach, expect, it } from "vitest"
import { type DaemonHarness, bootDaemonHarness, fakeOrchestrator, waitFor } from "./harness.ts"

let h: DaemonHarness | undefined
afterEach(async () => {
  await h?.close()
})

it.each(["daemon", "pty"])(
  "%s disconnects an oversized isolated request while healthy clients still work",
  async (kind) => {
    h = await bootDaemonHarness()
    const path = kind === "daemon" ? h.socketPath : join(h.dir, "pty.sock")
    const host =
      kind === "pty"
        ? await startPtyHostServer({
            socketPath: path,
            pidPath: join(h.dir, "pty.pid"),
            freezeDir: join(h.dir, "freeze"),
          })
        : undefined
    const bad = connect(path)
    const good = new KobeDaemonClient(path)
    try {
      bad.on("error", () => {})
      await new Promise<void>((resolve) => bad.once("connect", resolve))
      bad.write(Buffer.alloc(16 * 1024 * 1024, 120))
      expect(await waitFor(() => bad.destroyed)).toBe(true)
      await expect(good.request(kind === "daemon" ? "daemon.status" : "pty.list")).resolves.toBeDefined()
    } finally {
      bad.destroy()
      good.close()
      await host?.close()
    }
  },
)

it("accepts large legal requests, UTF-8 splits, and consecutive frames on the daemon socket", async () => {
  h = await bootDaemonHarness()
  const raw = await h.rawSocket()
  const bytes = Buffer.from(
    `${JSON.stringify({ type: "request", id: "large", name: "daemon.status", payload: { text: `任务🚀${"x".repeat(4 * 1024 * 1024)}` } })}\n${JSON.stringify({ type: "request", id: "next", name: "daemon.status" })}\n`,
  )
  const split = bytes.indexOf(Buffer.from("任务")) + 1
  raw.socket.write(bytes.subarray(0, split))
  raw.socket.write(bytes.subarray(split))
  expect((await raw.nextFrame((f) => f.id === "large")).error).toBeUndefined()
  expect((await raw.nextFrame((f) => f.id === "next")).error).toBeUndefined()
})

it("the daemon disconnects a stalled reader whose queued RPC responses exceed the budget", async () => {
  h = await bootDaemonHarness({
    orchestrator: fakeOrchestrator({
      listTasks: () => [
        {
          id: "large",
          title: "x".repeat(1024 * 1024),
          repo: "/repo",
          branch: "large",
          worktreePath: "/wt/large",
          status: "backlog",
          createdAt: "",
          updatedAt: "",
        },
      ],
    }),
  })
  const slow = await h.rawSocket()
  slow.socket.pause()
  for (let i = 0; i < 20; i++) slow.request("task.list", {}, `rpc-${i}`)
  expect(await waitFor(() => h?.server.clients.size === 0, 3000)).toBe(true)
  const healthy = h.client()
  await expect(healthy.request("daemon.status")).resolves.toBeDefined()
})
