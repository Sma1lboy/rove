/** `rove api routine-respond`: payload shape, the unknown-run rejection, the size cap. */

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ROUTINE_RESPONSE_MAX_CHARS } from "@sma1lboy/kobe-daemon/daemon/contracts"
import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime } from "./api-handler-fixtures.ts"

describe("routine-respond", () => {
  it("sends the file's bytes for the named run", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "rove-respond-")), "r.md")
    writeFileSync(file, "## done\n`x` $(nope)\n")
    const client = new FakeClient({ "automation.respond": () => ({ run: { id: "r1" } }) })
    await invokeVerb("routine-respond", ["--run", "r1", "--prompt-file", file], { client, runtime: stubRuntime() })
    expect(client.requests[0]?.payload).toEqual({ runId: "r1", text: "## done\n`x` $(nope)\n" })
  })

  it("an unknown run id is RUN_NOT_FOUND", async () => {
    const client = new FakeClient({ "automation.respond": () => ({ run: null }) })
    await expectApiError(
      () => invokeVerb("routine-respond", ["--run", "nope", "--text", "hi"], { client, runtime: stubRuntime() }),
      "RUN_NOT_FOUND",
    )
  })

  it("refuses a response over the cap instead of truncating it", async () => {
    const client = new FakeClient()
    await expectApiError(
      () =>
        invokeVerb("routine-respond", ["--run", "r1", "--text", "x".repeat(ROUTINE_RESPONSE_MAX_CHARS + 1)], {
          client,
          runtime: stubRuntime(),
        }),
      "RESPONSE_TOO_LARGE",
    )
    expect(client.requests).toEqual([])
  })
})
