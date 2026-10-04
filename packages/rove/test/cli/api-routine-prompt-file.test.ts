/**
 * `rove api routine-create` / `routine-update` prompt sourcing: the same
 * `--prompt` / `--prompt-file` contract `send` and `add` have, pinned here so
 * a scheduled prompt with backticks in it survives the shell. Same technique
 * as api-handlers.test.ts: `invokeVerb` against a recording fake daemon.
 */

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime } from "./api-handler-fixtures.ts"

describe("routine verbs take --prompt-file", () => {
  // A scheduled prompt that names its own reply command (`rove api send …`)
  // has the same shell problem as `send`: backticks in a double-quoted
  // --prompt are command substitution. The file route is the one that fits
  // both verbs, so routines take it too.
  it("routine-create ships the file's bytes verbatim", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rove-routine-prompt-"))
    const file = join(dir, "prompt.md")
    const body = "each morning reply via `rove api send --task-id t1` and $(echo no)\n"
    writeFileSync(file, body)
    const client = new FakeClient({ "automation.create": () => ({ ok: true }) })
    await invokeVerb(
      "routine-create",
      ["--repo", process.cwd(), "--name", "n", "--schedule", "0 9 * * *", "--prompt-file", file],
      { client, runtime: stubRuntime() },
    )
    expect((client.requests[0]?.payload as { prompt: string }).prompt).toBe(body)
  })

  it("routine-update reads the file, and leaves the prompt alone when neither flag is given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rove-routine-prompt-"))
    const file = join(dir, "prompt.md")
    writeFileSync(file, "new `text`\n")
    const client = new FakeClient({ "automation.update": () => ({ ok: true }) })
    await invokeVerb("routine-update", ["--id", "r1", "--prompt-file", file], { client, runtime: stubRuntime() })
    await invokeVerb("routine-update", ["--id", "r1", "--name", "renamed"], { client, runtime: stubRuntime() })
    expect(client.requests.map((r) => r.payload)).toEqual([
      { id: "r1", prompt: "new `text`\n" },
      { id: "r1", name: "renamed" },
    ])
  })

  it("routine-create with neither --prompt nor --prompt-file is MISSING_FLAG", async () => {
    await expectApiError(
      () =>
        invokeVerb("routine-create", ["--repo", process.cwd(), "--name", "n", "--schedule", "0 9 * * *"], {
          client: new FakeClient(),
          runtime: stubRuntime(),
        }),
      "MISSING_FLAG",
    )
  })
})
