import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildConflictPrompt, buildConflictPromptForWorktree, renderConflictPrompt } from "@/tui/ops/conflict-prompt"
import { describe, expect, it } from "vitest"

describe("buildConflictPrompt", () => {
  it("names the branch, the base, and every conflicted file", () => {
    const text = buildConflictPrompt({ branch: "feat/x", baseRef: "origin/main", files: ["src/a.ts", "src/b.ts"] })
    expect(text).toContain("The current branch is feat/x. The base is origin/main.")
    expect(text).toContain("There are 2 conflicted files.")
    expect(text).toContain("- `src/a.ts`\n- `src/b.ts`")
    // The merge is in progress and must stay that way — the one instruction
    // that, if lost, turns the resolution into a rebase or an abort.
    expect(text).toContain("Do not abort it, and do not rebase.")
    expect(text).toContain("git commit --no-edit")
    // No leftover holes.
    expect(text).not.toMatch(/\{\{[a-zA-Z]/)
  })

  it("singularises one file", () => {
    const text = buildConflictPrompt({ branch: "b", baseRef: "main", files: ["f.txt"] })
    expect(text).toContain("There is 1 conflicted file.")
  })

  it("says so when git reported no unmerged paths, instead of an empty list", () => {
    const text = buildConflictPrompt({ branch: "b", baseRef: "main", files: [] })
    expect(text).toContain("Git reported no unmerged paths.")
  })

  it("leaves unknown template tokens alone (a repo override may use its own)", () => {
    expect(renderConflictPrompt("{{baseRef}} {{nope}}", { branch: "b", baseRef: "main", files: [] })).toBe(
      "main {{nope}}",
    )
  })
})

describe("buildConflictPromptForWorktree per-repo override", () => {
  const state = { branch: "feat/x", baseRef: "main", files: ["f.txt"] }
  const write = (dir: string, relDir: string, body: string) => {
    mkdirSync(join(dir, relDir), { recursive: true })
    writeFileSync(join(dir, relDir, "conflict-instructions.md"), body)
  }
  const tmp = () => mkdtempSync(join(tmpdir(), "rove-conflict-instructions-"))

  it("reads the canonical .rove/conflict-instructions.md and renders its tokens", async () => {
    const dir = tmp()
    write(dir, ".rove", "merge {{baseRef}} into {{branch}}: {{files}}")
    await expect(buildConflictPromptForWorktree(dir, state)).resolves.toBe("merge main into feat/x: - `f.txt`")
  })

  it("falls back to the legacy .kobe spelling", async () => {
    const dir = tmp()
    write(dir, ".kobe", "legacy")
    await expect(buildConflictPromptForWorktree(dir, state)).resolves.toBe("legacy")
  })

  it("falls back to the built-in template when the only file is whitespace", async () => {
    const dir = tmp()
    write(dir, ".rove", "  \n")
    await expect(buildConflictPromptForWorktree(dir, state)).resolves.toBe(buildConflictPrompt(state))
  })
})
