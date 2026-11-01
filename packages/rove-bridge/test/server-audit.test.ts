/**
 * Every destructive action a page or phone sends is written down with when, which device and from where,
 * so "who deleted this task" can be answered and the device revoked; never with the token or other args.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { ROVE_API_VERSION } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { OpTable } from "../src/ops/types.ts"
import { AUTH, TOKEN, connect, start, stopServers, upgradeStatus } from "./server-harness.ts"

afterEach(stopServers)

describe("api.invoke", () => {
  test("serves the verb contract: hello names its version, a refusal keeps its recovery data, a destructive verb is audited", async () => {
    const lines: string[] = []
    const invoked: Array<[string, unknown]> = []
    const h = start({
      log: (line) => lines.push(line),
      invoke: async (verb, params) => {
        invoked.push([verb, params])
        if (verb === "land") {
          return {
            apiVersion: ROVE_API_VERSION,
            ok: false,
            error: { code: "LAND_CONFLICT", message: "conflict", hint: "rebase first", files: ["a.ts"] },
          }
        }
        return { apiVersion: ROVE_API_VERSION, ok: true, result: { tasks: [] } }
      },
    })
    const c = await connect(h.url, AUTH)
    lines.length = 0
    expect((await c.call("hello")).result).toMatchObject({ apiVersion: ROVE_API_VERSION })
    expect(await c.call("api.invoke", { verb: "list", params: { repo: "/r" } })).toMatchObject({
      ok: true,
      result: { tasks: [] },
    })
    expect(await c.call("api.invoke", { verb: "land", params: { "task-id": "T1" } })).toMatchObject({
      ok: false,
      error: { code: "LAND_CONFLICT", message: "conflict", hint: "rebase first", files: ["a.ts"] },
    })
    expect(invoked).toEqual([
      ["list", { repo: "/r" }],
      ["land", { "task-id": "T1" }],
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(
      /^\[rove-bridge\] \d{4}-\d\d-\d\dT[\d:.]+Z api\.invoke land task-id=T1 device=shared-token from=\S+$/,
    )
  })
})

describe("area ops", () => {
  test("a registered area op runs on the authenticated socket; a destructive one is audited by id, never the token", async () => {
    const lines: string[] = []
    const calls: string[] = []
    const areaOps: OpTable = {
      "demo.read": { kind: "read", destructive: false, wraps: "test", run: async () => ({ ok: 1 }) },
      "demo.remove": {
        kind: "write",
        destructive: true,
        wraps: "test",
        run: async (args) => {
          calls.push(String(args.taskId))
          return {}
        },
      },
    }
    const DEVICE_TOKEN = "d".repeat(43)
    const h = start({
      areaOps,
      log: (line) => lines.push(line),
      deviceOf: (presented) => (presented === DEVICE_TOKEN ? "phone-1" : null),
    })
    expect(await upgradeStatus(h.url)).toBe(401)
    const c = await connect(h.url, { Authorization: `Bearer ${DEVICE_TOKEN}` })
    lines.length = 0 // drop the refused-upgrade and device-connected lines above
    expect((await c.call("demo.read")).result).toEqual({ ok: 1 })
    expect(lines).toHaveLength(0)
    await c.call("demo.remove", { taskId: "T7", secret: "s3cret" })
    expect(calls).toEqual(["T7"])
    // When and which paired device: what "who deleted this task" needs, and what a revoke names.
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(
      /^\[rove-bridge\] \d{4}-\d\d-\d\dT[\d:.]+Z demo\.remove taskId=T7 device=phone-1 from=\S+$/,
    )
    expect(lines.join("\n")).not.toContain(TOKEN)
    expect(lines.join("\n")).not.toContain(DEVICE_TOKEN)
    expect(lines.join("\n")).not.toContain("s3cret")
    expect((await c.call("demo.other")).error?.code).toBe("UNKNOWN_OP")
  })
})
