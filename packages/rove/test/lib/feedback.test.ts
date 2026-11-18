import type { spawnSync } from "node:child_process"
import { describe, expect, it, vi } from "vitest"
import { environmentBlock, issueCreateArgv, newIssueUrl, submitFeedback } from "../../src/lib/feedback.ts"

const ENV = "---\nReported from Rove:\n- rove: 9.9.9"
const deps = (spawn: unknown) => ({ spawn: spawn as typeof spawnSync, repoSlug: () => "Sma1lboy/rove", env: () => ENV })

describe("submitFeedback", () => {
  it("runs gh issue create with a kind label, the body on stdin plus the env block, and parses the URL", () => {
    const spawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: "https://github.com/Sma1lboy/rove/issues/42\n",
      stderr: "",
    })
    const result = submitFeedback({ title: " A small idea ", body: "Please add the thing.", kind: "idea" }, deps(spawn))
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

  it("maps bug and question to their labels and defaults to bug", () => {
    expect(issueCreateArgv("o/r", "t", "bug")).toContain("bug")
    expect(issueCreateArgv("o/r", "t", "question")).toContain("question")
    const spawn = vi.fn().mockReturnValue({ status: 0, stdout: "https://github.com/o/r/issues/1", stderr: "" })
    submitFeedback({ title: "t", body: "b" }, deps(spawn))
    expect((spawn.mock.calls[0]?.[1] as string[]).includes("bug")).toBe(true)
  })

  it.each([
    ["gh is not installed", { error: new Error("spawnSync gh ENOENT"), status: null, stdout: "", stderr: "" }],
    [
      "gh is not signed in",
      { status: 4, stdout: "", stderr: "To get started with GitHub CLI, please run: gh auth login" },
    ],
    ["gh prints no URL", { status: 0, stdout: "", stderr: "" }],
  ])("returns a prefilled new-issue link when %s", (_why, reply) => {
    const result = submitFeedback(
      { title: "Board lags", body: "It lags & stutters", kind: "bug" },
      deps(vi.fn().mockReturnValue(reply)),
    )
    expect(result.filed).toBe(false)
    const fallback = result as Extract<typeof result, { filed: false }>
    const url = new URL(fallback.url)
    expect(url.origin + url.pathname).toBe("https://github.com/Sma1lboy/rove/issues/new")
    expect(url.searchParams.get("title")).toBe("Board lags")
    expect(url.searchParams.get("labels")).toBe("bug")
    expect(url.searchParams.get("body")).toBe(`It lags & stutters\n\n${ENV}`)
    expect(fallback.hint).toContain("gh auth login")
  })

  it("truncates an oversized body in the prefilled link only", () => {
    const url = new URL(newIssueUrl("o/r", "t", "x".repeat(10_000), "bug"))
    expect(url.searchParams.get("body")?.length).toBeLessThan(4100)
  })

  it("rejects a blank title or body before spawning anything", () => {
    const spawn = vi.fn()
    expect(() => submitFeedback({ title: "  ", body: "B" }, deps(spawn))).toThrow("feedback title is required")
    expect(() => submitFeedback({ title: "T", body: " " }, deps(spawn))).toThrow("feedback body is required")
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
