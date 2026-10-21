import { describe, expect, test, vi } from "vitest"

const calls: Array<[string, string, Record<string, unknown>]> = []
vi.mock("../../src/machines/forward.ts", () => ({
  requireMachine: (alias: string) => ({ alias }),
  forwardVerb: async (entry: { alias: string }, verb: string, params: Record<string, unknown>) => {
    calls.push([entry.alias, verb, params])
    if (verb === "worktree-diff")
      return {
        ok: true,
        result: {
          base: "main",
          files: [
            { path: "a.ts", status: "M", added: 2, deleted: 1, scope: "branch" },
            { path: "b.ts", status: "?", added: null, deleted: null, scope: "working" },
          ],
        },
      }
    if (verb === "worktree-diff-file") return { ok: false, error: { code: "NO_BASE", message: "no base" } }
    return { ok: true, result: { files: ["a.ts", "b.ts"] } }
  },
}))

const { remoteChanges, remoteFiles, remotePreview } = await import("../../src/machines/remote-worktree.ts")

describe("reading a worktree on another machine", () => {
  test("files and one scope of changes come from that machine's verbs", async () => {
    expect(await remoteFiles("mac", "T1")).toEqual(["a.ts", "b.ts"])
    const branch = await remoteChanges("mac", "T1", "branch")
    expect(branch.base).toBe("main")
    expect(branch.entries).toEqual([{ path: "a.ts", status: "M", added: 2, deleted: 1 }])
    expect((await remoteChanges("mac", "T1", "working")).entries.map((e) => e.path)).toEqual(["b.ts"])
    expect(calls.map(([alias, verb]) => `${alias}:${verb}`)).toEqual([
      "mac:worktree-files",
      "mac:worktree-diff",
      "mac:worktree-diff",
    ])
  })

  test("a preview with a base asks for the branch scope, and a refusal surfaces as an error", async () => {
    await expect(remotePreview("mac", "T1", "a.ts", "main")).rejects.toThrow("no base")
    expect(calls.at(-1)?.[2]).toEqual({ "task-id": "T1", path: "a.ts", scope: "branch" })
  })
})
