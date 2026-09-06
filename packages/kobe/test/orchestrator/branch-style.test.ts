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

  it("reads a bare-kebab repo as bare", () => {
    expect(inferBranchStyle(["main", "login-flow", "signup-page", "billing-refactor"])).toEqual({ kind: "bare" })
  })

  it("falls back to bare for an empty repo (no branches)", () => {
    expect(inferBranchStyle([])).toEqual({ kind: "bare" })
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

  it("emits a bare kebab slug in a bare repo", () => {
    expect(deriveConventionBranch("Fix login flow", bare, ID)).toBe("fix-login-flow")
  })

  it("NEVER contains rove/kobe brand tokens", () => {
    for (const style of [typed, bare]) {
      const branch = deriveConventionBranch("rove kobe integration for Rove", style, ID)
      expect(branch).not.toMatch(/rove|kobe/)
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

  it("caps the slug at 32 chars without a trailing hyphen", () => {
    const branch = deriveConventionBranch("fix the very long feature name that exceeds the cap", typed, ID)
    const slug = branch.slice("fix/".length)
    expect(slug.length).toBeLessThanOrEqual(32)
    expect(slug.endsWith("-")).toBe(false)
    expect(branch).not.toContain("--")
  })
})

describe("uniqueBranchName", () => {
  it("returns the base when free", () => {
    expect(uniqueBranchName("feat/login", new Set(["main"]), "01HXABCDEF")).toBe("feat/login")
  })

  it("appends -2 / -3 short suffixes on collision", () => {
    expect(uniqueBranchName("feat/login", new Set(["feat/login"]), "01HXABCDEF")).toBe("feat/login-2")
    expect(uniqueBranchName("feat/login", new Set(["feat/login", "feat/login-2"]), "01HXABCDEF")).toBe("feat/login-3")
  })

  it("falls back to a task-id suffix when -2…-99 are all taken", () => {
    const taken = new Set(["x", ...Array.from({ length: 98 }, (_, i) => `x-${i + 2}`)])
    expect(uniqueBranchName("x", taken, "01HXABCDEF")).toBe("x-abcdef")
  })
})
