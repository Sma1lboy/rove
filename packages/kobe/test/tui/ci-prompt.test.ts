import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type CIFailingCheck, buildCIPrompt, buildCIPromptForWorktree, renderCIPrompt } from "@/tui/ops/ci-prompt"
import { describe, expect, it } from "vitest"

const check = (over: Partial<CIFailingCheck> = {}): CIFailingCheck => ({
  jobName: "render-track",
  conclusion: "FAILURE",
  url: "https://github.com/acme/demo/actions/runs/1/job/2",
  tail: "coverage floor not met\nexit 1",
  ...over,
})

describe("buildCIPrompt", () => {
  it("names the branch, the PR and the failing job, and fences the log verbatim", () => {
    const text = buildCIPrompt({ branch: "feat/x", prNumber: 4242, checks: [check()], totalFailing: 1 })
    expect(text).toContain("The current branch is feat/x.")
    expect(text).toContain("The pull request is #4242.")
    expect(text).toContain("The failing job is render-track (failure).")
    expect(text).toContain("### render-track — https://github.com/acme/demo/actions/runs/1/job/2")
    expect(text).toContain("```\ncoverage floor not met\nexit 1\n```")
    // No leftover holes.
    expect(text).not.toMatch(/\{\{[a-zA-Z]/)
  })

  it("pluralises the job list and reports the checks the cap dropped", () => {
    const text = buildCIPrompt({
      branch: "b",
      checks: [check(), check({ jobName: "behavior", conclusion: "TIMED_OUT" })],
      totalFailing: 5,
    })
    expect(text).toContain("The failing jobs are render-track (failure), behavior (timed_out).")
    expect(text).toContain("3 further failing check(s) are not shown.")
  })

  it("says an empty tail is unavailable rather than rendering an empty fence", () => {
    const text = buildCIPrompt({ branch: "b", checks: [check({ tail: "" })] })
    expect(text).toContain("(no log available")
    expect(text).not.toContain("```\n\n```")
  })

  it("states the absence of a PR number instead of printing #undefined", () => {
    const text = buildCIPrompt({ branch: "b", checks: [check()] })
    expect(text).toContain("There is no PR number recorded.")
    expect(text).not.toContain("undefined")
  })

  it("degrades to a sentence when nothing failing was reported", () => {
    const text = buildCIPrompt({ branch: "b", checks: [] })
    expect(text).toContain("No failing job was reported.")
  })

  it("leaves unknown template tokens alone (a repo override may use its own)", () => {
    expect(renderCIPrompt("{{branch}} {{nope}}", { branch: "b", checks: [] })).toBe("b {{nope}}")
  })
})

/**
 * The `.rove/` → `.kobe/` template fallback, which had no coverage here at all
 * while `loadTemplate` accepted a whitespace-only file as a real template and
 * blanked the prompt. All three readers now share `lib/repo-config-file.ts`.
 */
describe("buildCIPromptForWorktree per-repo override", () => {
  const state = { branch: "feat/x", checks: [check()] }
  const write = (dir: string, relDir: string, body: string) => {
    mkdirSync(join(dir, relDir), { recursive: true })
    writeFileSync(join(dir, relDir, "ci-instructions.md"), body)
  }
  const tmp = () => mkdtempSync(join(tmpdir(), "rove-ci-instructions-"))

  it("reads the canonical .rove/ci-instructions.md", async () => {
    const dir = tmp()
    write(dir, ".rove", "canonical")
    await expect(buildCIPromptForWorktree(dir, state)).resolves.toBe("canonical")
  })

  it("falls back to the legacy .kobe spelling", async () => {
    const dir = tmp()
    write(dir, ".kobe", "legacy")
    await expect(buildCIPromptForWorktree(dir, state)).resolves.toBe("legacy")
  })

  it("does not let a whitespace-only canonical file shadow the legacy one", async () => {
    const dir = tmp()
    write(dir, ".rove", "\n   \n")
    write(dir, ".kobe", "legacy")
    await expect(buildCIPromptForWorktree(dir, state)).resolves.toBe("legacy")
  })

  it("falls back to the built-in template when the only file is whitespace", async () => {
    const dir = tmp()
    write(dir, ".rove", "  \n")
    await expect(buildCIPromptForWorktree(dir, state)).resolves.toBe(buildCIPrompt(state))
  })
})
