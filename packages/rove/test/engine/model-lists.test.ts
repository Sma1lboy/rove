/**
 * The list-verb parsers in `engine/model-lists.ts`, pinned against the real
 * output shapes captured on 2026-09-17 (`pi --list-models` 0.x table,
 * `omp models --json`), plus the catalog cache: a second `engine-list` must
 * not spawn `pi` again, and an upgraded binary must not answer from the old
 * catalog.
 */

import { chmodSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { listPiModels, parseOmpModelJson, parsePiModelTable } from "../../src/engine/model-lists.ts"

describe("parsePiModelTable", () => {
  it("skips the header and keys each row by provider/model, labelled by the bare model", () => {
    const table = [
      "provider    model                      context  max-out  thinking  images",
      "cliproxy    claude-fable-5             1M       128K     yes       yes   ",
      "openai      gpt-5.3-codex-spark        128K     32K      yes       yes   ",
      "",
    ].join("\n")
    expect(parsePiModelTable(table)).toEqual([
      { id: "cliproxy/claude-fable-5", label: "claude-fable-5" },
      { id: "openai/gpt-5.3-codex-spark", label: "gpt-5.3-codex-spark" },
    ])
  })
})

describe("parseOmpModelJson", () => {
  it("reads `selector` as the id and `name` as the label", () => {
    const json = JSON.stringify({
      models: [
        {
          provider: "anthropic",
          id: "claude-opus-4-8",
          selector: "anthropic/claude-opus-4-8",
          name: "Claude Opus 4.8",
        },
        { provider: "x", id: "nameless", selector: "x/nameless" },
        { provider: "bad" },
      ],
    })
    expect(parseOmpModelJson(json)).toEqual([
      { id: "anthropic/claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "x/nameless" },
    ])
  })

  it("rejects a payload with no models array rather than answering an empty catalog", () => {
    expect(() => parseOmpModelJson("{}")).toThrow(/models/)
  })
})

describe("listPiModels", () => {
  const before = { PATH: process.env.PATH, ROVE_HOME_DIR: process.env.ROVE_HOME_DIR }
  let binDir = ""

  /** A `pi` on PATH that prints `model` and stamps its own mtime. */
  function fakePi(model: string, mtimeSeconds: number): void {
    const script = `#!/bin/sh\nprintf 'provider model\\np ${model}\\n'\n`
    writeFileSync(join(binDir, "pi"), script, { mode: 0o755 })
    chmodSync(join(binDir, "pi"), 0o755)
    utimesSync(join(binDir, "pi"), mtimeSeconds, mtimeSeconds)
  }

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), "rove-pi-bin-"))
    process.env.PATH = `${binDir}:${before.PATH ?? ""}`
    process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-pi-home-"))
  })

  afterEach(() => {
    process.env.PATH = before.PATH
    process.env.ROVE_HOME_DIR = before.ROVE_HOME_DIR
  })

  it("answers from the cache until the binary changes", async () => {
    fakePi("m1", 1_700_000_000)
    expect(await listPiModels()).toEqual([{ id: "p/m1", label: "m1" }])

    // Same binary identity, new output: the cache must answer, not the probe.
    fakePi("m2", 1_700_000_000)
    expect(await listPiModels()).toEqual([{ id: "p/m1", label: "m1" }])

    // An engine upgrade moves the mtime: the old catalog must not survive.
    fakePi("m2", 1_700_000_100)
    expect(await listPiModels()).toEqual([{ id: "p/m2", label: "m2" }])
  })

  it("does not cache a failed probe as an empty catalog", async () => {
    writeFileSync(join(binDir, "pi"), "#!/bin/sh\nexit 3\n", { mode: 0o755 })
    chmodSync(join(binDir, "pi"), 0o755)
    await expect(listPiModels()).rejects.toThrow()
    await expect(listPiModels()).rejects.toThrow()
  })
})
