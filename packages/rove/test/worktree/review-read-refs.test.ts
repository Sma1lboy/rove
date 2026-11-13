/** `worktreeRefs` / `checkRef` / `worktreeDiffFile --base`: comparing a worktree against a ref picked by hand. */
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { checkRef, worktreeDiffFile, worktreeRefs } from "../../src/worktree/review-read.ts"

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" })

/** main (a.ts = 1) <- tag v1 <- feature (a.ts = 2); worktree on feature with a.ts = 3 uncommitted. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "rove-refs-"))
  git(dir, "init", "-q", "-b", "main")
  writeFileSync(join(dir, "a.ts"), "export const a = 1\n")
  git(dir, "add", ".")
  git(dir, "commit", "-q", "-m", "one")
  git(dir, "tag", "v1")
  git(dir, "checkout", "-q", "-b", "feature")
  writeFileSync(join(dir, "a.ts"), "export const a = 2\n")
  git(dir, "commit", "-qam", "two")
  git(dir, "checkout", "-q", "-b", "other", "main")
  writeFileSync(join(dir, "b.ts"), "b\n")
  git(dir, "add", ".")
  git(dir, "commit", "-q", "-m", "other work")
  git(dir, "checkout", "-q", "feature")
  writeFileSync(join(dir, "a.ts"), "export const a = 3\n")
  return dir
}

describe("worktree refs", () => {
  test("lists branches, tags and the branch's recent commits", async () => {
    const refs = await worktreeRefs(repo())
    expect(refs.branches).toEqual(expect.arrayContaining(["main", "feature", "other"]))
    expect(refs.tags).toEqual(["v1"])
    expect(refs.commits.map((c) => c.subject)).toEqual(["two", "one"])
  })

  test("a ref must be a commit in the repository and never an option", async () => {
    const dir = repo()
    expect(await checkRef(dir, "v1")).toBe("v1")
    expect(await checkRef(dir, "nope")).toBeNull()
    expect(await checkRef(dir, "--output=/tmp/x")).toBeNull()
    expect(await checkRef(dir, "")).toBeNull()
  })
})

describe("worktreeDiffFile with an explicit base", () => {
  test("the whole task diffs against the chosen ref, uncommitted work included", async () => {
    const dir = repo()
    const vsTag = await worktreeDiffFile(dir, "a.ts", "task", undefined, { base: "v1" })
    expect(vsTag).toMatchObject({ kind: "diff", text: expect.stringContaining("-export const a = 1") })
    expect(vsTag).toMatchObject({ text: expect.stringContaining("+export const a = 3") })
    const vsFeature = await worktreeDiffFile(dir, "a.ts", "task", undefined, { base: "HEAD" })
    expect(vsFeature).toMatchObject({ kind: "diff", text: expect.stringContaining("-export const a = 2") })
  })

  test("an unknown ref is refused as BAD_REF, and a base outside the task scope as BAD_ARGS", async () => {
    const dir = repo()
    await expect(worktreeDiffFile(dir, "a.ts", "task", undefined, { base: "nope" })).rejects.toMatchObject({
      code: "BAD_REF",
    })
    await expect(worktreeDiffFile(dir, "a.ts", "branch", undefined, { base: "v1" })).rejects.toMatchObject({
      code: "BAD_ARGS",
    })
  })
})
