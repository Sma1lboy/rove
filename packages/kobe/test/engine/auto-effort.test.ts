/**
 * Auto effort (`engine/auto-effort.ts`): the tier table's read rules and the
 * gate. The gate is the load-bearing half — a tier that passes here and dies
 * at launch is the exact "accepted everywhere, dropped at spawn" failure the
 * effort/model gates exist to prevent.
 */

import { describe, expect, it } from "vitest"
import {
  DEFAULT_AUTO_EFFORT,
  autoEffortKey,
  describeTierBlock,
  readAutoEffortTable,
  tierBlock,
} from "../../src/engine/auto-effort.ts"

const from = (state: Record<string, unknown>) => (key: string) => state[key]

describe("readAutoEffortTable", () => {
  it("is the shipped table when nothing is persisted", () => {
    expect(readAutoEffortTable(from({}))).toEqual(DEFAULT_AUTO_EFFORT)
  })

  it("overlays persisted fields per tier, and an empty model/effort means none", () => {
    const table = readAutoEffortTable(
      from({
        [autoEffortKey("deep", "engine")]: "codex",
        [autoEffortKey("deep", "effort")]: "xhigh",
        [autoEffortKey("deep", "model")]: "",
      }),
    )
    expect(table?.deep).toEqual({ engine: "codex", effort: "xhigh" })
    expect(table?.swift).toEqual(DEFAULT_AUTO_EFFORT.swift)
  })

  it("is unconfigured (null) when any tier's engine is blanked — never guessed", () => {
    expect(readAutoEffortTable(from({ [autoEffortKey("standard", "engine")]: "" }))).toBeNull()
  })
})

describe("tierBlock", () => {
  const deps = (over: Partial<Parameters<typeof tierBlock>[1]> = {}) => ({
    engineIds: new Set(["claude", "codex", "copilot"]),
    accountKind: () => null,
    ...over,
  })

  it("passes a target whose engine is listed, login unknown, and fields its engine carries", () => {
    expect(tierBlock({ engine: "claude", model: "opus" }, deps())).toBeNull()
    expect(tierBlock({ engine: "codex", effort: "high" }, deps())).toBeNull()
  })

  it("blocks an engine engine-list does not name", () => {
    expect(tierBlock({ engine: "aider" }, deps())).toEqual({ kind: "engine", engine: "aider" })
  })

  it("blocks a detected logged-out engine, but lets an undetectable one through", () => {
    expect(tierBlock({ engine: "claude" }, deps({ accountKind: () => "none" }))).toEqual({
      kind: "account",
      engine: "claude",
    })
    expect(tierBlock({ engine: "claude" }, deps({ accountKind: () => null }))).toBeNull()
  })

  it("blocks a model on an engine with no model flag, and an effort its engine never declared", () => {
    expect(tierBlock({ engine: "copilot", model: "gpt-5" }, deps())).toMatchObject({ kind: "model" })
    expect(tierBlock({ engine: "claude", effort: "high" }, deps())).toMatchObject({ kind: "effort", levels: [] })
    expect(describeTierBlock(tierBlock({ engine: "codex", effort: "turbo" }, deps())!)).toMatch(/none, low, medium/)
  })
})
