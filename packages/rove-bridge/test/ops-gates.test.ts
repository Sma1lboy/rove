import { describe, expect, test } from "bun:test"
import { GATE_OPS } from "../src/ops/gates.ts"
import { fakeApi } from "./task-ops-harness.ts"

const answer = (args: Record<string, unknown>, replies: Record<string, unknown> = {}) => {
  const { api, calls } = fakeApi({ "gate.answer": { delivered: true }, ...replies })
  return { run: GATE_OPS["gate.answer"]?.run(args, { api }), calls }
}

describe("gate.answer", () => {
  test("forwards the option and the note to the daemon, attributed to the bridge", async () => {
    const { run, calls } = answer({ gateId: "g-12", option: "b", text: "ship it" })
    expect(await run).toEqual({ delivered: true })
    expect(calls).toEqual([
      { rpc: "gate.answer", payload: { gateId: "g-12", option: "b", text: "ship it", by: "bridge" } },
    ])
  })

  test("free text alone is an answer; an option alone too", async () => {
    const text = answer({ gateId: "g-1", text: "use the second approach" })
    await text.run
    expect(text.calls[0]).toEqual({
      rpc: "gate.answer",
      payload: { gateId: "g-1", text: "use the second approach", by: "bridge" },
    })
    const option = answer({ gateId: "g-1", option: "a" }, { "gate.answer": { delivered: false } })
    expect(await option.run).toEqual({ delivered: false })
    expect(option.calls[0]).toEqual({ rpc: "gate.answer", payload: { gateId: "g-1", option: "a", by: "bridge" } })
  })

  test("an unknown gate keeps the daemon's stable code on the wire", async () => {
    const { api } = fakeApi({
      "gate.answer": () => {
        throw new Error("GATE_NOT_FOUND: no gate g-99")
      },
    })
    await expect(GATE_OPS["gate.answer"]?.run({ gateId: "g-99", option: "a" }, { api })).rejects.toMatchObject({
      name: "BridgeError",
      code: "GATE_NOT_FOUND",
      message: "no gate g-99",
    })
  })

  test("a closed gate and a bad option key are named, not flattened to RPC_ERROR", async () => {
    for (const code of ["GATE_NOT_OPEN", "BAD_OPTION"]) {
      const { api } = fakeApi({
        "gate.answer": () => {
          throw new Error(`${code}: nope`)
        },
      })
      await expect(GATE_OPS["gate.answer"]?.run({ gateId: "g-1", option: "a" }, { api })).rejects.toMatchObject({
        code,
      })
    }
  })

  test("a malformed request never reaches the daemon", async () => {
    for (const args of [
      {},
      { option: "a" },
      { gateId: "g-1" },
      { gateId: "--force", option: "a" },
      { gateId: "g-1", option: "--x" },
      { gateId: "g-1", option: 7 },
      { gateId: "g-1", text: "   " },
      { gateId: "g-1", text: "x".repeat(4001) },
    ]) {
      const { run, calls } = answer(args)
      await expect(run).rejects.toMatchObject({ code: "BAD_ARGS" })
      expect(calls).toEqual([])
    }
  })
})
