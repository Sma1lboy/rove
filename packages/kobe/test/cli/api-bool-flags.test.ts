/**
 * The `--flag false` space form, and the two things that used to make an
 * explicit `false` unreachable: the parser short-circuiting every declared
 * bool flag into a presence flag, and a payload builder folding `false` into
 * "absent" with a bare ternary.
 *
 * Also pins that `add` validates its prompt flags BEFORE it creates anything
 * — the failure mode there was a task left behind an error that carried no
 * taskId to find it with.
 */

import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { parseFlags } from "../../src/cli/api/flags.ts"
import { FakeClient, expectApiError, stubRuntime } from "./api-handler-fixtures.ts"

describe("a bool flag takes the space form", () => {
  const bools = new Set(["force"])

  it("consumes the next argv element when it is a boolean literal", () => {
    for (const [raw, expected] of [
      ["false", "false"],
      ["true", "true"],
      ["0", "0"],
      ["no", "no"],
      ["1", "1"],
      ["yes", "yes"],
    ]) {
      expect([...parseFlags(["--force", raw], bools).flags]).toEqual([["force", expected]])
    }
  })

  // The presence form is what `--force` means on its own; a bool flag must not
  // swallow an unrelated following flag or run off the end of argv.
  it("stays a presence flag when the next element is not a boolean literal", () => {
    expect([...parseFlags(["--force"], bools).flags]).toEqual([["force", "true"]])
    expect([...parseFlags(["--force", "--task-id", "T"], bools).flags]).toEqual([
      ["force", "true"],
      ["task-id", "T"],
    ])
  })

  it("still accepts the = form", () => {
    expect([...parseFlags(["--force=false"], bools).flags]).toEqual([["force", "false"]])
  })
})

describe("routine-update --persistent-session", () => {
  // `bool()` returns `true | false | undefined`, so the old
  // `bool(...) ? { persistentSession: true } : {}` dropped an explicit false
  // and left the routine standing — no CLI path back to a fresh worktree per
  // run. `present()` is what tells "set it false" from "leave it alone".
  it("sends false when explicitly disabled, and omits the key when absent", async () => {
    const client = new FakeClient({ "automation.update": () => ({ ok: true }) })
    await invokeVerb("routine-update", ["--id", "r1", "--persistent-session", "false"], {
      client,
      runtime: stubRuntime(),
    })
    await invokeVerb("routine-update", ["--id", "r1", "--persistent-session"], { client, runtime: stubRuntime() })
    await invokeVerb("routine-update", ["--id", "r1", "--name", "n"], { client, runtime: stubRuntime() })
    expect(client.requests.map((r) => r.payload)).toEqual([
      { id: "r1", persistentSession: false },
      { id: "r1", persistentSession: true },
      { id: "r1", name: "n" },
    ])
  })
})

describe("add validates prompt flags before it creates anything", () => {
  it("rejects --prompt with --prompt-file without issuing task.create", async () => {
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: {} }) })
    await expectApiError(
      () =>
        invokeVerb("add", ["--repo", process.cwd(), "--prompt", "hi", "--prompt-file", "/etc/hosts"], {
          client,
          runtime: stubRuntime(),
        }),
      "BAD_FLAG",
    )
    expect(client.requestNames).not.toContain("task.create")
  })
})
