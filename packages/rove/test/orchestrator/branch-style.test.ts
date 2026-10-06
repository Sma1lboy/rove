import { describe, expect, it } from "vitest"
import { deriveConventionBranch, inferBranchStyle, uniqueBranchName } from "../../src/orchestrator/branch-style.ts"

describe("inferBranchStyle", () => {
  it("reads an all-feat/ repo as typed with feat as the default prefix", () => {
    const style = inferBranchStyle(["main", "feat/login", "feat/signup", "feat/billing"])
    expect(style).toEqual({ kind: "typed", defaultPrefix: "feat" })
  })

  it("picks the DOMINANT prefix in a mixed typed repo", () => {
    const style = inferBranchStyle(["main", "fix/a", "fix/b", "fix/c", "feat/x", "chore/deps"])
    expect(style).toEqual({ kind: "typed", defaultPrefix: "fix" })
  })

  it("ignores non-conventional prefixes (user/, backup/, legacy rove/)", () => {
    // None of these vote; only `main` votes bare → bare.
    expect(inferBranchStyle(["main", "alice/spike", "backup/old", "rove/task-abc123"])).toEqual({ kind: "bare" })
  })

  it("breaks a typed-vs-bare tie toward typed (main always votes bare)", () => {
    expect(inferBranchStyle(["main", "feat/x"])).toEqual({ kind: "typed", defaultPrefix: "feat" })
  })
})

describe("deriveConventionBranch", () => {
  const typed = { kind: "typed", defaultPrefix: "feat" } as const
  const bare = { kind: "bare" } as const
  const ID = "01K9ZZZZZZZZZZZZZZZABC123"

  it("applies the repo's default prefix in a typed repo", () => {
    expect(deriveConventionBranch("Add login flow", typed, ID)).toBe("feat/add-login-flow")
  })

  it("lifts a leading type word out of the title as the prefix", () => {
    expect(deriveConventionBranch("Fix login flow", typed, ID)).toBe("fix/login-flow")
    expect(deriveConventionBranch("docs update quickstart", typed, ID)).toBe("docs/update-quickstart")
  })

  it("never contains the brand name", () => {
    for (const style of [typed, bare]) {
      const branch = deriveConventionBranch("rove rove integration for Rove", style, ID)
      expect(branch).not.toMatch(/rove/)
    }
  })

  it("falls back to the TASK ID when the title has no slug-able chars", () => {
    // Not the bare constant `task`: that made every such title collide, and
    // `uniqueBranchName` then numbered them `task`, `task-2`, `task-3`.
    expect(deriveConventionBranch("!!!", bare, ID)).toBe("task-abc123")
    expect(deriveConventionBranch("", typed, ID)).toBe("feat/task-abc123")
  })

  it("gives non-Latin titles distinct, id-keyed branches instead of task/task-2", () => {
    // The bug this fixes: `slugTokens` keeps only [a-z0-9], so a Chinese,
    // Japanese, or emoji title kebab-cases to nothing. Two such tasks must
    // still get two DIFFERENT branch names.
    const zh = deriveConventionBranch("修复中文标题的分支推导", bare, "01AAAAAAAAAAAAAAAAA111111")
    const emoji = deriveConventionBranch("😀😀😀", bare, "01BBBBBBBBBBBBBBBBB222222")
    const ja = deriveConventionBranch("ログイン画面を直す", bare, "01CCCCCCCCCCCCCCCCC333333")
    expect([zh, emoji, ja]).toEqual(["task-111111", "task-222222", "task-333333"])
    expect(new Set([zh, emoji, ja]).size).toBe(3)
  })

  it("still slugs the Latin part of a mixed-script title", () => {
    // Mixed titles are NOT pushed onto the id fallback — a readable token
    // survives, so the branch keeps saying something.
    expect(deriveConventionBranch("修复 login flow", bare, ID)).toBe("login-flow")
    expect(deriveConventionBranch("fix 中文标题", typed, ID)).toBe("fix/task-abc123")
  })

  it("ends at the last whole word when the cap falls inside a token", () => {
    const title = "the very long feature name redesign"
    expect(deriveConventionBranch(title, bare, ID)).toBe("the-very-long-feature-name")
    expect(deriveConventionBranch(`fix ${title}`, typed, ID)).toBe("fix/the-very-long-feature-name")
  })

  it("hard-caps a single overlong word at 32 chars", () => {
    const title = "abcdefghijklmnopqrstuvwxyz0123456789"
    expect(deriveConventionBranch(title, bare, ID)).toBe("abcdefghijklmnopqrstuvwxyz012345")
    expect(deriveConventionBranch(`fix ${title}`, typed, ID)).toBe("fix/abcdefghijklmnopqrstuvwxyz012345")
  })

  it("keeps whole tokens that fit exactly at the cap", () => {
    expect(deriveConventionBranch("the very long feature name fixes more", bare, ID)).toBe(
      "the-very-long-feature-name-fixes",
    )
  })
})

describe("uniqueBranchName", () => {
  it("falls back to a task-id suffix when -2…-99 are all taken", () => {
    const taken = new Set(["x", ...Array.from({ length: 98 }, (_, i) => `x-${i + 2}`)])
    expect(uniqueBranchName("x", taken, "01HXABCDEF")).toBe("x-abcdef")
  })

  it("skips a name that an existing branch uses as a folder (git can't hold fix and fix/login)", () => {
    expect(uniqueBranchName("fix", new Set(["main", "fix/login"]), "01HXABCDEF")).toBe("fix-2")
  })

  it("flattens a name nested under an existing branch (git can't hold feat and feat/x)", () => {
    expect(uniqueBranchName("feat/login", new Set(["main", "feat"]), "01HXABCDEF")).toBe("feat-login")
    expect(uniqueBranchName("feat/login", new Set(["feat", "feat-login"]), "01HXABCDEF")).toBe("feat-login-2")
  })
})
