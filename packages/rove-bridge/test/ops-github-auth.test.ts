import { describe, expect, test } from "bun:test"
import { githubAuthOps } from "../src/ops/github-auth.ts"
import { BridgeError } from "../src/protocol.ts"
import { fakeApi } from "./task-ops-harness.ts"

const refuse = (code: string) => () => {
  throw new BridgeError(code, `refused ${code}`)
}

const call = (op: string, args: Record<string, unknown>, replies: Record<string, unknown> = {}) => {
  const { api, calls } = fakeApi(replies)
  const spec = githubAuthOps[op]
  if (!spec) throw new Error(`no op ${op}`)
  return spec.run(args, { api }).then((result) => ({ result, calls }))
}

describe("github.status", () => {
  test("runs on the named machine, else here, and passes the verb's object through", async () => {
    const status = { account: "octo", gh: "2.92.0" }
    const remote = await call("github.status", { machine: "narwhal" }, { "github-status": status })
    expect(remote.result).toEqual({ status })
    expect(remote.calls).toEqual([{ verb: "github-status", argv: [], machine: "narwhal" }])
    const here = await call("github.status", {}, { "github-status": status })
    expect(here.calls).toEqual([{ verb: "github-status", argv: [] }])
  })

  test("a machine that cannot answer is a reason, never a throw", async () => {
    const reasons = {
      MACHINE_UNREACHABLE: "offline",
      MACHINE_VERSION_SKEW: "outdated",
      UNKNOWN_VERB: "outdated",
      INBOUND_DENIED: "denied",
      RPC_ERROR: "failed",
    }
    for (const [code, reason] of Object.entries(reasons)) {
      const { result } = await call("github.status", { machine: "narwhal" }, { "github-status": refuse(code) })
      expect(result).toEqual({ status: null, reason, message: `refused ${code}` })
    }
  })
})

describe("github.sync", () => {
  test("names the target with --to and routes nowhere: the verb itself runs here, on the hub", async () => {
    const { result, calls } = await call("github.sync", { machine: "narwhal" }, { "github-sync": { account: "octo" } })
    expect(result).toEqual({ ok: true, result: { account: "octo" } })
    expect(calls).toEqual([{ verb: "github-sync", argv: ["--to=narwhal"] }])
  })

  test("needs a machine, and a refusal comes back as a value", async () => {
    await expect(githubAuthOps["github.sync"]?.run({}, { api: fakeApi().api })).rejects.toMatchObject({
      code: "BAD_ARGS",
    })
    const { result } = await call(
      "github.sync",
      { machine: "narwhal" },
      { "github-sync": refuse("MACHINE_UNREACHABLE") },
    )
    expect(result).toEqual({ ok: false, reason: "offline", message: "refused MACHINE_UNREACHABLE" })
  })
})

describe("github.login", () => {
  test("starts or cancels the device flow on the machine named", async () => {
    const start = await call("github.login", { machine: "narwhal" }, { "github-login": { state: "pending" } })
    expect(start.calls).toEqual([{ verb: "github-login", argv: [], machine: "narwhal" }])
    const cancel = await call("github.login", { cancel: true }, { "github-login": { cancelled: true } })
    expect(cancel.calls).toEqual([{ verb: "github-login", argv: ["--cancel=true"] }])
  })
})
