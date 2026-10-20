import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parseFlags } from "../../src/cli/api/flags.ts"
import { forwardParams, takeMachineFlag } from "../../src/cli/api/forward-cli.ts"
import { findVerb } from "../../src/cli/api/verbs.ts"

describe("rove api --machine", () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  it("is a transport flag in both spellings, never a verb flag", () => {
    expect(takeMachineFlag(["--machine", "narwhal", "--task-id", "t1"])).toEqual({
      machine: "narwhal",
      rest: ["--task-id", "t1"],
    })
    expect(takeMachineFlag(["--machine=narwhal", "--pretty"])).toEqual({ machine: "narwhal", rest: ["--pretty"] })
  })

  it("sends a prompt file's text, since the other machine cannot read this one's files", () => {
    dir = mkdtempSync(join(tmpdir(), "rove-fwd-"))
    const file = join(dir, "prompt.md")
    writeFileSync(file, "fix the flaky test\n")
    const verb = findVerb("add")!
    const { flags } = parseFlags(["--repo", "/srv/rove", "--prompt-file", file])
    expect(forwardParams(verb, flags)).toEqual({ repo: "/srv/rove", prompt: "fix the flaky test\n" })
  })
})
