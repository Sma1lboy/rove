import { describe, expect, mock, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { createBridgeApi } from "../src/ops/api.ts"

describe("a request made while the daemon is restarting", () => {
  test("goes through once the daemon is back", async () => {
    const refused = Object.assign(new Error("connect ENOENT /x/daemon.sock"), { code: "ENOENT", syscall: "connect" })
    const client = {
      request: mock().mockRejectedValueOnce(refused).mockRejectedValueOnce(refused).mockResolvedValue({ ok: true }),
    } as never
    expect(await createBridgeApi(client).rpc<{ ok: boolean }>("task.list")).toEqual({ ok: true })
  })

  test("says the daemon is away, not a socket path, when it stays down", async () => {
    const client = new RoveDaemonClient(join(tmpdir(), `rove-no-daemon-${process.pid}.sock`))
    const err = await createBridgeApi(client, undefined, 0)
      .verb("delete", ["--task-id", "T1", "--wait"])
      .catch((e: unknown) => e)
    expect(err).toMatchObject({ code: "DAEMON_UNREACHABLE" })
    expect((err as Error).message).not.toContain(".sock")
  })
})
