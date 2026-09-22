/**
 * `kobe feedback` (`parseFeedbackArgs` + `runFeedbackSubcommand`) and the
 * underlying `submitFeedback` gh-GraphQL flow. submitFeedback already takes
 * an injectable `deps.spawn` / `deps.repoSlug`, so the network/gh boundary
 * is exercised with a scripted fake — no real `gh` runs.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  submitFeedback: vi.fn(),
}))

vi.mock("../../src/lib/feedback.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/feedback.ts")>()
  return { ...actual, submitFeedback: mocks.submitFeedback }
})

import { parseFeedbackArgs, runFeedbackSubcommand } from "../../src/cli/feedback-cmd.ts"

let outSpy: MockInstance<typeof process.stdout.write>
let errSpy: MockInstance<typeof process.stderr.write>
let exitSpy: MockInstance<typeof process.exit>
let logSpy: MockInstance<typeof console.log>

beforeEach(() => {
  mocks.submitFeedback.mockReset().mockReturnValue({ number: 12, url: "https://github.com/x/y/discussions/12" })
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`)
  }) as never)
})

afterEach(() => {
  outSpy.mockRestore()
  errSpy.mockRestore()
  logSpy.mockRestore()
  exitSpy.mockRestore()
})

function err(): string {
  return errSpy.mock.calls.map((c) => String(c[0])).join("")
}

describe("parseFeedbackArgs", () => {
  it("rejects an unexpected argument with exit 2", () => {
    expect(() => parseFeedbackArgs(["positional"])).toThrow("exit 2")
    expect(err()).toContain('unexpected argument "positional"')
  })
})

describe("runFeedbackSubcommand", () => {
  it("--help prints usage and submits nothing", async () => {
    await runFeedbackSubcommand(["--help"])
    expect(outSpy.mock.calls.join("")).toContain("Usage: kobe feedback")
    expect(mocks.submitFeedback).not.toHaveBeenCalled()
  })

  it("submits title/body/category and prints the created Discussion", async () => {
    await runFeedbackSubcommand(["--title", "T", "--body", "B", "--category", "ideas"])
    expect(mocks.submitFeedback).toHaveBeenCalledWith({ title: "T", body: "B", categorySlug: "ideas" })
    expect(logSpy.mock.calls.join("")).toContain("created Discussion #12: https://github.com/x/y/discussions/12")
  })

  it("--body-file reads the body from disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kobe-feedback-"))
    try {
      const file = join(dir, "body.md")
      writeFileSync(file, "from a file", "utf8")
      await runFeedbackSubcommand(["--title", "T", "--body-file", file])
      expect(mocks.submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ title: "T", body: "from a file" }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("submitFeedback (real module, scripted gh)", () => {
  // Import the REAL implementation — the vi.mock above only swapped the
  // export the CLI wrapper consumes; importOriginal gives us the actual fn.
  async function realSubmit() {
    const actual = await vi.importActual<typeof import("../../src/lib/feedback.ts")>("../../src/lib/feedback.ts")
    return actual.submitFeedback
  }

  it("surfaces gh graphql errors by message", async () => {
    const submit = await realSubmit()
    const spawn = vi.fn().mockReturnValueOnce({
      status: 1,
      stdout: JSON.stringify({ errors: [{ message: "Bad credentials" }] }),
      stderr: "",
    })
    expect(() => submit({ title: "T", body: "B" }, { spawn: spawn as never, repoSlug: () => "o/r" })).toThrow(
      "Bad credentials",
    )
  })

  it("rejects a blank title/body before spawning anything", async () => {
    const submit = await realSubmit()
    const spawn = vi.fn()
    expect(() => submit({ title: "  ", body: "B" }, { spawn: spawn as never, repoSlug: () => "o/r" })).toThrow(
      "feedback title is required",
    )
    expect(spawn).not.toHaveBeenCalled()
  })
})
