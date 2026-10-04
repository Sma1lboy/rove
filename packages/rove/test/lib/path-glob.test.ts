import { describe, expect, it } from "vitest"
import { globToRegExp, matchPathGlob } from "../../src/lib/path-glob.ts"

describe("globToRegExp", () => {
  it("treats `*` as any run except a slash", () => {
    const re = globToRegExp("*.ts")
    expect(re.test("a.ts")).toBe(true)
    expect(re.test("a/b.ts")).toBe(false)
  })

  it("lets an interior `**` match zero intervening directories", () => {
    const re = globToRegExp("src/**/task.ts")
    expect(re.test("src/task.ts")).toBe(true) // zero directories between
    expect(re.test("src/a/task.ts")).toBe(true)
    expect(re.test("src/a/b/task.ts")).toBe(true)
    expect(re.test("srctask.ts")).toBe(false) // separator is still required
    expect(re.test("src/task.tsx")).toBe(false) // still anchored
  })

  it("lets a leading `**/` match zero or more leading directories", () => {
    const re = globToRegExp("**/task.ts")
    expect(re.test("task.ts")).toBe(true)
    expect(re.test("a/task.ts")).toBe(true)
    expect(re.test("a/b/task.ts")).toBe(true)
  })

  it("treats `?` as a single non-slash char", () => {
    const re = globToRegExp("?.ts")
    expect(re.test("a.ts")).toBe(true)
    expect(re.test("ab.ts")).toBe(false)
    expect(re.test("/.ts")).toBe(false)
  })

  it("escapes regex metacharacters so they match literally", () => {
    const re = globToRegExp("a.b+c")
    expect(re.test("a.b+c")).toBe(true)
    expect(re.test("axbxc")).toBe(false)
  })
})

describe("matchPathGlob", () => {
  it("falls back to matching the basename", () => {
    expect(matchPathGlob("feature-*", "/work/feature-login")).toBe(true)
  })

  it("matches a nested `**` filter against a worktree directly under the prefix", () => {
    // A globstar that required at least one intervening directory would fail
    // to match `/work/src/login`.
    expect(matchPathGlob("/work/**/login", "/work/login")).toBe(true)
    expect(matchPathGlob("/work/**/login", "/work/feature/login")).toBe(true)
  })
})
