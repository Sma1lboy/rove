/** `issue-list --status/--search`: an agent asks for the cards it needs instead of the whole board. */

import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime } from "./api-handler-fixtures.ts"

const board = {
  repoRoot: "/repo/x",
  exists: true,
  nextId: 5,
  skipped: 0,
  issues: [
    { id: 1, title: "Fix login redirect", status: "open", created: "2026-10-01", body: "" },
    { id: 2, title: "Cache warmup", status: "doing", created: "2026-10-02", body: "Login page is slow", taskId: "t1" },
    { id: 3, title: "Old idea", status: "hold", created: "2026-10-03", body: "" },
    { id: 4, title: "Ship docs", status: "done", created: "2026-10-04", body: "" },
  ],
}

async function ids(argv: string[]): Promise<{ ids: number[]; result: typeof board }> {
  const client = new FakeClient({ "issue.list": () => board })
  const result = (await invokeVerb("issue-list", ["--repo", "/repo/x", ...argv], {
    client,
    runtime: stubRuntime(),
  })) as typeof board
  return { ids: result.issues.map((i) => i.id), result }
}

describe("issue-list filters", () => {
  it("without filters returns the daemon's board untouched", async () => {
    expect((await ids([])).result).toEqual(board)
  })

  it("--status keeps any of a comma list", async () => {
    expect((await ids(["--status", "open,doing"])).ids).toEqual([1, 2])
  })

  it("--search matches title or body, ignoring case, and ANDs with --status", async () => {
    expect((await ids(["--search", "LOGIN"])).ids).toEqual([1, 2])
    expect((await ids(["--search", "login", "--status", "doing"])).ids).toEqual([2])
  })

  it("keeps nextId and skipped describing the whole board", async () => {
    const { result } = await ids(["--status", "done"])
    expect(result).toMatchObject({ nextId: 5, skipped: 0, issues: [board.issues[3]] })
  })

  it("rejects an unknown status before asking the daemon", async () => {
    const client = new FakeClient({})
    await expectApiError(
      () => invokeVerb("issue-list", ["--repo", "/repo/x", "--status", "closed"], { client, runtime: stubRuntime() }),
      "BAD_FLAG",
    )
    expect(client.requests).toEqual([])
  })
})
