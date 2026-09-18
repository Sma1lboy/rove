/**
 * The two list-verb parsers in `engine/model-lists.ts`, pinned against the
 * real output shapes captured on 2026-09-17 (`pi --list-models` 0.x table,
 * `omp models --json`). A column shift or a renamed JSON key is what would
 * silently turn a catalog into an empty suggestion list.
 */

import { describe, expect, it } from "vitest"
import { parseOmpModelJson, parsePiModelTable } from "../../src/engine/model-lists.ts"

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
