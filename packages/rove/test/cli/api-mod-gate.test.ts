/** `issue-*` belongs to the Kanban mod and `workitem-*` to the Issues mod: hidden and refused until installed. */

import { afterEach, describe, expect, it, vi } from "vitest"
import { ISSUE_HANDLERS } from "../../../rove-daemon/src/daemon/handlers-issues.ts"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime } from "./api-handler-fixtures.ts"

afterEach(() => vi.unstubAllEnvs())

const board = { repoRoot: "/repo/x", exists: true, nextId: 1, skipped: 0, issues: [] }

async function schemaVerbs(): Promise<string[]> {
  const index = (await invokeVerb("schema", [], { client: null, runtime: stubRuntime() })) as {
    verbs: { name: string }[]
    groups: Record<string, string[]>
  }
  return [...index.verbs.map((v) => v.name), ...Object.keys(index.groups).map((g) => `group:${g}`)]
}

describe("first-party mod verbs", () => {
  it("are refused before reaching the daemon and left out of the schema while not installed", async () => {
    vi.stubEnv("ROVE_TEST_BUILTIN_MODS", "")
    const client = new FakeClient({ "issue.list": () => board })
    await expectApiError(
      () => invokeVerb("issue-list", ["--repo", "/repo/x"], { client, runtime: stubRuntime() }),
      "MOD_NOT_INSTALLED",
    )
    await expectApiError(
      () => invokeVerb("workitem-list", ["--repo", "/repo/x"], { client, runtime: stubRuntime() }),
      "MOD_NOT_INSTALLED",
    )
    expect(client.requests).toEqual([])
    const listed = await schemaVerbs()
    expect(listed.filter((name) => name.startsWith("issue-") || name.startsWith("workitem-"))).toEqual([])
    expect(listed).not.toContain("group:issues")
    expect(listed).toContain("add")
  })

  it("come back with their own mod only", async () => {
    vi.stubEnv("ROVE_TEST_BUILTIN_MODS", "kanban")
    const client = new FakeClient({ "issue.list": () => board })
    expect(await invokeVerb("issue-list", ["--repo", "/repo/x"], { client, runtime: stubRuntime() })).toEqual(board)
    await expectApiError(
      () => invokeVerb("workitem-list", ["--repo", "/repo/x"], { client, runtime: stubRuntime() }),
      "MOD_NOT_INSTALLED",
    )
    expect(await schemaVerbs()).toContain("issue-create")
  })

  it("is enforced by the daemon too, so the web and other machines get the same refusal", async () => {
    vi.stubEnv("ROVE_TEST_BUILTIN_MODS", "")
    const list = ISSUE_HANDLERS.find((handler) => handler.name === "issue.list")
    const ctx = { daemon: {}, issues: { list: async () => board } } as unknown as Parameters<
      NonNullable<typeof list>["handle"]
    >[1]
    await expect(list?.handle({ repoRoot: "/repo/x" }, ctx)).rejects.toThrow(/^MOD_NOT_INSTALLED: the Kanban mod/)
  })
})
