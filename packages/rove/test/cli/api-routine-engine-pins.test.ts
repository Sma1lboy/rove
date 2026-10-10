/**
 * `routine-create` / `routine-update --model --effort`: a pin the routine's
 * engine cannot carry is refused at save time, not at the first unattended
 * firing, and an empty flag clears the pin.
 */

import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, stubRuntime } from "./api-handler-fixtures.ts"

const created = () => ({ automation: { id: "r1" } })

function createArgs(...extra: string[]): string[] {
  return ["--repo", "/repo", "--name", "nightly", "--prompt", "audit", "--schedule", "0 9 * * *", ...extra]
}

describe("routine engine pins", () => {
  it("sends the model and effort a routine's runs launch with", async () => {
    const client = new FakeClient({ "automation.create": created })
    await invokeVerb("routine-create", createArgs("--vendor", "codex", "--model", "gpt-5.5", "--effort", "high"), {
      client,
      runtime: stubRuntime(),
    })
    expect(client.requests[0]?.payload).toMatchObject({ vendor: "codex", model: "gpt-5.5", effort: "high" })
  })

  it("judges a create without --vendor against the repo's default engine", async () => {
    const client = new FakeClient({ "automation.create": created })
    const runtime = stubRuntime({ defaultVendor: async () => "claude" })
    await expect(invokeVerb("routine-create", createArgs("--effort", "high"), { client, runtime })).rejects.toThrow(
      /declares no reasoning effort/,
    )
    expect(client.requests).toEqual([])
  })

  it("judges an update against the routine's stored engine", async () => {
    const client = new FakeClient({
      "automation.list": () => ({ automations: [{ id: "r1", repo: "/repo", vendor: "codex" }] }),
      "automation.update": created,
    })
    const runtime = stubRuntime()
    await expect(
      invokeVerb("routine-update", ["--id", "r1", "--effort", "ultra"], { client, runtime }),
    ).rejects.toThrow(/does not accept effort level "ultra"/)
    await invokeVerb("routine-update", ["--id", "r1", "--effort", "xhigh"], { client, runtime })
    expect(client.requests.find((r) => r.name === "automation.update")?.payload).toEqual({ id: "r1", effort: "xhigh" })
  })

  it.each([
    { flags: ["--vendor", "claude"], code: "BAD_EFFORT" },
    { flags: ["--vendor", ""], code: "BAD_EFFORT" },
    { flags: ["--vendor", "claude", "--model", "sonnet"], code: "BAD_EFFORT" },
    { flags: ["--vendor", "claude", "--model", ""], code: "BAD_EFFORT" },
    { flags: ["--vendor", "bob", "--effort", ""], code: "BAD_MODEL" },
    { flags: ["--vendor", "bob", "--effort", "high"], code: "BAD_MODEL" },
  ])("rejects incompatible retained pins for $flags", async ({ flags, code }) => {
    const client = new FakeClient({
      "automation.list": () => ({
        automations: [{ id: "r1", repo: "/repo", vendor: "codex", model: "gpt-5.5", modelEffort: "high" }],
      }),
      "automation.update": created,
    })
    await expect(
      invokeVerb("routine-update", ["--id", "r1", ...flags], {
        client,
        runtime: stubRuntime({ defaultVendor: async () => "claude" }),
      }),
    ).rejects.toMatchObject({ code })
    expect(client.requests.some((r) => r.name === "automation.update")).toBe(false)
  })

  it.each([
    { vendor: "claude", flags: ["--effort", "ultra"], code: "BAD_EFFORT" },
    { vendor: "bob", flags: ["--model", "gpt-5.5"], code: "BAD_MODEL" },
  ])("checks pins against $vendor when clearing the vendor", async ({ vendor, flags, code }) => {
    const client = new FakeClient({
      "automation.list": () => ({ automations: [{ id: "r1", repo: "/repo", vendor: "codex" }] }),
      "automation.update": created,
    })
    const runtime = stubRuntime({
      defaultVendor: async (repo) => {
        expect(repo).toBe("/repo")
        return vendor
      },
    })
    await expect(
      invokeVerb("routine-update", ["--id", "r1", "--vendor", "", ...flags], {
        client,
        runtime,
      }),
    ).rejects.toMatchObject({ code })
    expect(client.requests.some((r) => r.name === "automation.update")).toBe(false)
  })

  it.each(["claude", ""])("stores the engine a vendor change to '%s' resolves to", async (vendor) => {
    const client = new FakeClient({
      "automation.list": () => ({
        automations: [{ id: "r1", repo: "/repo", vendor: "codex", model: "gpt-5.5", modelEffort: "high" }],
      }),
      "automation.update": created,
    })
    await invokeVerb("routine-update", ["--id", "r1", "--vendor", vendor, "--effort", ""], {
      client,
      runtime: stubRuntime({ defaultVendor: async () => "claude" }),
    })
    expect(client.requests.find((r) => r.name === "automation.update")?.payload).toEqual({
      id: "r1",
      vendor: "claude",
      effort: null,
    })
  })

  it("clears a pin with an empty value", async () => {
    const client = new FakeClient({
      "automation.list": () => ({
        automations: [{ id: "r1", repo: "/repo", vendor: "codex", model: "gpt-5.5", modelEffort: "high" }],
      }),
      "automation.update": created,
    })
    await invokeVerb("routine-update", ["--id", "r1", "--model", "", "--effort", ""], {
      client,
      runtime: stubRuntime(),
    })
    expect(client.requests.find((r) => r.name === "automation.update")?.payload).toEqual({
      id: "r1",
      model: null,
      effort: null,
    })
  })
})
