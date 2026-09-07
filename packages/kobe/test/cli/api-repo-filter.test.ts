/**
 * `collect --repo` / `digest --repo` answered `{"tasks": []}` — the same
 * answer a project with nothing running gives — when a repo path stopped
 * resolving. `resolveRepoRoot` returns its INPUT unchanged on git failure, so
 * a repo that moved compares unequal against every spelling, including its
 * own recorded one, and every task was silently filtered out. A coordinator
 * reading `collect` as its fan-in signal concluded the round was empty.
 *
 * Two honest outcomes replace it, both pinned here: an error when the TARGET
 * cannot be resolved, and `unresolvableRepos` beside the answer when a task's
 * repo cannot be.
 */

import { describe, expect, it } from "vitest"
import { repoFilter } from "../../src/cli/api/handler-helpers.ts"
import { ApiError } from "../../src/cli/api/types.ts"
import { stubRuntime } from "./api-handler-fixtures.ts"

/** Every listed path resolves to itself; anything else is unreadable. */
function runtimeWhere(readable: readonly string[]) {
  return stubRuntime({
    resolveRepoRoot: async (path) => path,
    isUsableRepo: async (path) => readable.includes(path),
  })
}

describe("repoFilter", () => {
  it("refuses when the --repo target itself does not resolve", async () => {
    await expect(repoFilter(runtimeWhere([]), "/repos/gone", [])).rejects.toBeInstanceOf(ApiError)
    await expect(repoFilter(runtimeWhere([]), "/repos/gone", [])).rejects.toThrow("/repos/gone")
  })

  it("names the task repos it could not resolve instead of dropping them", async () => {
    const filter = await repoFilter(runtimeWhere(["/repos/new"]), "/repos/new", ["/repos/old", "/repos/old"])
    expect(filter.matches("/repos/old")).toBe(false)
    expect(filter.unresolvableRepos).toEqual(["/repos/old"])
  })

  it("matches a resolvable repo and reports nothing unresolvable", async () => {
    const filter = await repoFilter(runtimeWhere(["/repos/a", "/repos/b"]), "/repos/a", ["/repos/a", "/repos/b"])
    expect(filter.matches("/repos/a")).toBe(true)
    expect(filter.matches("/repos/b")).toBe(false)
    expect(filter.unresolvableRepos).toEqual([])
  })
})
