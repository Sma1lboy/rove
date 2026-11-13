import { describe, expect, it, vi } from "vitest"
import { environmentBlock, issueCreateArgv, newIssueUrl, submitFeedback } from "../../src/lib/feedback.ts"

const ENV = "---\nReported from Rove:\n- rove: 9.9.9"
const ok = (stdout: string) => ({ ok: true, stdout, stderr: "" })
const deps = (run: ReturnType<typeof vi.fn>) => ({ run, repoSlug: () => "Sma1lboy/rove", env: () => ENV })

describe("submitFeedback", () => {
  it("runs gh issue create with a kind label, the body on stdin plus the env block, and parses the URL", async () => {
    const spawn = vi.fn().mockResolvedValue(ok("https://github.com/Sma1lboy/rove/issues/42\n"))
    const result = await submitFeedback(
      { title: " A small idea ", body: "Please add the thing.", kind: "idea" },
      deps(spawn),
    )
    expect(result).toEqual({ filed: true, url: "https://github.com/Sma1lboy/rove/issues/42", number: 42 })
    expect(spawn).toHaveBeenCalledOnce()
    const [cmd, argv, opts] = spawn.mock.calls[0] as [string, string[], { input: string }]
    expect(cmd).toBe("gh")
    expect(argv).toEqual([
      "issue",
      "create",
      "-R",
      "Sma1lboy/rove",
      "--title",
      "A small idea",
      "--label",
      "enhancement",
      "--body-file",
      "-",
    ])
    expect(opts.input).toBe(`Please add the thing.\n\n${ENV}`)
  })

  it("maps bug and question to their labels and defaults to bug", async () => {
    expect(issueCreateArgv("o/r", "t", "bug")).toContain("bug")
    expect(issueCreateArgv("o/r", "t", "question")).toContain("question")
    const spawn = vi.fn().mockResolvedValue(ok("https://github.com/o/r/issues/1"))
    await submitFeedback({ title: "t", body: "b" }, deps(spawn))
    expect((spawn.mock.calls[0]?.[1] as string[]).includes("bug")).toBe(true)
  })

  it.each([
    ["gh is not installed", { ok: false, error: "spawn gh ENOENT", stdout: "", stderr: "" }],
    [
      "gh is not signed in",
      { ok: false, stdout: "", stderr: "To get started with GitHub CLI, please run: gh auth login" },
    ],
    ["gh prints no URL", ok("")],
  ])("returns a prefilled new-issue link when %s", async (_why, reply) => {
    const result = await submitFeedback(
      { title: "Board lags", body: "It lags & stutters", kind: "bug" },
      deps(vi.fn().mockResolvedValue(reply)),
    )
    if (result.filed) throw new Error("expected a fallback")
    const url = new URL(result.url)
    expect(url.origin + url.pathname).toBe("https://github.com/Sma1lboy/rove/issues/new")
    expect(url.searchParams.get("title")).toBe("Board lags")
    expect(url.searchParams.get("labels")).toBe("bug")
    expect(url.searchParams.get("body")).toBe(`It lags & stutters\n\n${ENV}`)
    expect(result.hint).toContain("gh auth login")
  })

  it("truncates an oversized body in the prefilled link only", () => {
    const url = new URL(newIssueUrl("o/r", "t", "x".repeat(10_000), "bug"))
    expect(url.searchParams.get("body")?.length).toBeLessThan(4100)
  })

  it("rejects a blank title or body before spawning anything", async () => {
    const spawn = vi.fn()
    await expect(submitFeedback({ title: "  ", body: "B" }, deps(spawn))).rejects.toThrow("feedback title is required")
    await expect(submitFeedback({ title: "T", body: " " }, deps(spawn))).rejects.toThrow("feedback body is required")
    expect(spawn).not.toHaveBeenCalled()
  })
})

describe("environmentBlock", () => {
  it("names the rove version, OS and default engine", () => {
    const block = environmentBlock()
    expect(block).toMatch(/- rove: \S+/)
    expect(block).toMatch(/- os: \S+/)
    expect(block).toMatch(/- default engine: \S+/)
  })
})
