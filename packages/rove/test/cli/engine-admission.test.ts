import { Socket } from "node:net"
import { PtyHost } from "@sma1lboy/rove-daemon/daemon/pty-host"
import type { PtySessionInfo } from "@sma1lboy/rove-daemon/daemon/pty-host"
import { describe, expect, it } from "vitest"
import { ClientWriter } from "../../../rove-daemon/src/daemon/client-writer.ts"
import { type PtyRequest, dispatchPtyRequest } from "../../../rove-daemon/src/daemon/pty-server-verbs.ts"
import { countLiveEngineSessions, openAdmittedEngine } from "../../src/cli/api/engine-admission.ts"
import { normalizeWindowsArgs } from "../../src/engine/win-process-snapshot.ts"

const session: PtySessionInfo = {
  key: "a::tab-1",
  alive: true,
  pid: 100,
  command: ["/bin/sh", "-ilc", "claude"],
  title: "",
}

describe.each(["sh", "bash", "zsh", "fish", "dash", "ash", "ksh", "mksh"])("%s admission", (shell) => {
  it.each([
    `/bin/${shell}`,
    `-${shell}`,
    normalizeWindowsArgs(`"C:\\Program Files\\Git\\bin\\${shell.toUpperCase()}.EXE"`),
    normalizeWindowsArgs(`${shell}.exe`),
  ])("releases an exited engine's slot in %s but retains pending and running engines", async (args) => {
    const existing = { ...session, command: [args, "-ilc", "claude"] }
    expect(await countLiveEngineSessions([existing], async () => `100 1 ${args}`)).toBe(0)
    expect(await countLiveEngineSessions([existing], async () => `100 1 ${args} -ilc sleep 10\n101 100 sleep 10`)).toBe(
      1,
    )
    expect(await countLiveEngineSessions([existing], async () => `100 1 ${args}\n101 100 claude`)).toBe(1)
  })
})

it.each([
  ["root is absent from the snapshot", "999 1 ps", 1],
  ["probe returns no rows", "", 1],
])("counts slots when %s", async (_label, text, count) => {
  expect(await countLiveEngineSessions([session], async () => text)).toBe(count)
})

it("keeps slots occupied when the process probe fails", async () => {
  expect(
    await countLiveEngineSessions([session], async () => {
      throw new Error("ps failed")
    }),
  ).toBe(1)
})

it("does not bypass admission on an older host", async () => {
  const rpc = { request: async <T>() => ({ sessions: [] }) as T }
  await expect(
    openAdmittedEngine(
      rpc,
      { key: "t::tab-1", cwd: "/tmp", defaultColors: undefined },
      {
        maxLiveEngines: 1,
        taskId: "t",
        retryArgs: [],
      },
    ),
  ).rejects.toMatchObject({ code: "ENGINE_ADMISSION_UNAVAILABLE" })
})

describe("atomic host admission", () => {
  it("admits only one competing client at limit one, including a pending engine", async () => {
    let launches = 0
    const host = new PtyHost({
      driver: () => {
        launches++
        return { pid: 100, exited: new Promise(() => {}), write() {}, resize() {}, close() {}, kill() {} }
      },
    })
    const socket = new Socket()
    const client = { socket, writer: new ClientWriter(socket) }
    const rpc = {
      request: async <T>(name: string, payload?: unknown): Promise<T> =>
        dispatchPtyRequest({ type: "request", id: "test", name, payload } as PtyRequest, client, {
          ptys: host,
          writeFrame() {},
          requestStop() {},
        }) as T,
    }
    const results = await Promise.allSettled(
      ["one", "two"].map((taskId) =>
        openAdmittedEngine(
          rpc,
          {
            key: `${taskId}::tab-1`,
            cwd: "/tmp",
            command: ["/bin/sh", "-ilc", "sleep 10; claude"],
            defaultColors: undefined,
          },
          {
            maxLiveEngines: 1,
            taskId,
            retryArgs: [],
            snapshot: async () => "100 1 /bin/sh -ilc sleep 10; claude\n101 100 sleep 10",
          },
        ),
      ),
    )
    expect(launches).toBe(1)
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "ENGINE_LIMIT" } })
    socket.destroy()
  })
})
