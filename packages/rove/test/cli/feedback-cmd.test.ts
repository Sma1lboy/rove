/**
 * `rove feedback` (`parseFeedbackArgs` + `runFeedbackSubcommand`) and the
 * the output for a filed and an unfiled report. `submitFeedback` itself is
 * covered in `test/lib/feedback.test.ts`; no real `gh` runs here.
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
  mocks.submitFeedback.mockReset().mockReturnValue({ filed: true, number: 12, url: "https://github.com/x/y/issues/12" })
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
    expect(outSpy.mock.calls.join("")).toContain("Usage: rove feedback")
    expect(mocks.submitFeedback).not.toHaveBeenCalled()
  })

  it("submits title/body/kind and prints the filed issue", async () => {
    await runFeedbackSubcommand(["--title", "T", "--body", "B", "--kind", "idea"])
    expect(mocks.submitFeedback).toHaveBeenCalledWith({ title: "T", body: "B", kind: "idea" })
    expect(logSpy.mock.calls.join("")).toContain("filed issue #12: https://github.com/x/y/issues/12")
  })

  it("prints the hint and the prefilled link when gh could not file", async () => {
    mocks.submitFeedback.mockReturnValue({
      filed: false,
      url: "https://github.com/x/y/issues/new?title=T",
      hint: "Run `gh auth login`.",
    })
    await runFeedbackSubcommand(["--title", "T", "--body", "B"])
    const out = logSpy.mock.calls.join("")
    expect(out).toContain("Run `gh auth login`.")
    expect(out).toContain("https://github.com/x/y/issues/new?title=T")
  })

  it("rejects an unknown --kind and the removed --category with exit 2", () => {
    expect(() => parseFeedbackArgs(["--kind", "rant"])).toThrow("exit 2")
    expect(() => parseFeedbackArgs(["--category", "ideas"])).toThrow("exit 2")
  })

  it("--body-file reads the body from disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rove-feedback-"))
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
