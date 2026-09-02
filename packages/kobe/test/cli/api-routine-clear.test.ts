/**
 * `routine-update`'s clear-by-empty convention: `--precheck ''` and
 * `--base-branch ''` must reach the daemon as an explicit `null`, which its
 * `automation.update` handler reads as "clear this field". Folding the empty
 * value into "absent" (VerbArgs.str drops `""`) drops the clear silently on
 * the wire and leaves the existing value in place.
 */

import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, stubRuntime } from "./api-handler-fixtures.ts"

const ok = () => ({ automation: { id: "r1" } })

async function updatePayload(argv: readonly string[]): Promise<Record<string, unknown>> {
  const client = new FakeClient({ "automation.update": ok })
  await invokeVerb("routine-update", argv, { client, runtime: stubRuntime() })
  const call = client.requests.find((r) => r.name === "automation.update")
  expect(call).toBeDefined()
  return call?.payload as Record<string, unknown>
}

describe("routine-update clear-by-empty", () => {
  it("sends precheck: null when --precheck is empty so the daemon clears it", async () => {
    const payload = await updatePayload(["--id", "r1", "--precheck", ""])
    expect("precheck" in payload).toBe(true)
    expect(payload.precheck).toBeNull()
  })

  it("sends baseRef: null when --base-branch is empty so the daemon clears it", async () => {
    const payload = await updatePayload(["--id", "r1", "--base-branch", ""])
    expect("baseRef" in payload).toBe(true)
    expect(payload.baseRef).toBeNull()
  })

  it("still sends the precheck command and timeout when --precheck has a value", async () => {
    const payload = await updatePayload(["--id", "r1", "--precheck", "bun test", "--precheck-timeout", "30"])
    expect(payload.precheck).toEqual({ command: "bun test", timeoutSeconds: 30 })
  })

  it("still sends a non-empty base ref verbatim", async () => {
    const payload = await updatePayload(["--id", "r1", "--base-branch", "main"])
    expect(payload.baseRef).toBe("main")
  })

  it("omits precheck and baseRef entirely when neither flag is passed", async () => {
    const payload = await updatePayload(["--id", "r1", "--name", "renamed"])
    expect("precheck" in payload).toBe(false)
    expect("baseRef" in payload).toBe(false)
  })
})
