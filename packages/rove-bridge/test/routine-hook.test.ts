import { describe, expect, test } from "bun:test"
import type { BridgeApi } from "../src/ops/types.ts"
import { routineHook } from "../src/routine-hook.ts"

function fakeApi(verdict: string) {
  const calls: { name: string; payload: unknown }[] = []
  const api = {
    verb: async () => {
      throw new Error("unused")
    },
    rpc: async (name: string, payload?: unknown) => {
      calls.push({ name, payload })
      return { verdict, event: verdict === "fired" ? "issues.opened Sma1lboy/rove#7" : undefined }
    },
  } as unknown as BridgeApi
  return { api, calls }
}

const post = (path: string, init: RequestInit = {}) =>
  new Request(`http://127.0.0.1:7890${path}`, { method: "POST", body: "{}", ...init })

describe("routineHook", () => {
  test("leaves other paths alone", async () => {
    const { api, calls } = fakeApi("fired")
    expect(await routineHook(api, post("/"), () => {})).toBeNull()
    expect(await routineHook(api, post("/hooks/routines/a/b"), () => {})).toBeNull()
    expect(calls).toEqual([])
  })

  test("relays the body and GitHub's headers unread to the daemon", async () => {
    const { api, calls } = fakeApi("fired")
    const res = await routineHook(
      api,
      post("/hooks/routines/ed1e5768-e752", {
        body: '{"action":"opened"}',
        headers: { "x-github-event": "issues", "x-hub-signature-256": "sha256=ab" },
      }),
      () => {},
    )
    expect(res?.status).toBe(202)
    expect(await res?.text()).toBe("fired issues.opened Sma1lboy/rove#7\n")
    expect(calls).toEqual([
      {
        name: "automation.webhook",
        payload: { id: "ed1e5768-e752", body: '{"action":"opened"}', event: "issues", signature: "sha256=ab" },
      },
    ])
  })

  test("maps each verdict to a status GitHub shows on the delivery", async () => {
    const statusOf = async (verdict: string) =>
      (await routineHook(fakeApi(verdict).api, post("/hooks/routines/x"), () => {}))?.status
    expect(await statusOf("pong")).toBe(200)
    expect(await statusOf("not_found")).toBe(404)
    expect(await statusOf("bad_signature")).toBe(401)
    expect(await statusOf("disabled")).toBe(409)
  })

  test("answers POST only, and 503 when the daemon is down", async () => {
    const { api } = fakeApi("fired")
    expect((await routineHook(api, new Request("http://h/hooks/routines/x"), () => {}))?.status).toBe(405)
    const down = { rpc: async () => Promise.reject(new Error("ECONNREFUSED")) } as unknown as BridgeApi
    expect((await routineHook(down, post("/hooks/routines/x"), () => {}))?.status).toBe(503)
  })
})
