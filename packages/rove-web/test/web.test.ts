import { describe, expect, test } from "bun:test"
import type { TaskRow } from "rove-bridge/protocol"
import { en } from "../src/i18n/en.ts"
import { zh } from "../src/i18n/zh.ts"
import { activityGlyph, groupByProject } from "../src/rail.ts"
import { tokenFromInput } from "../src/token-input.ts"

const TOKEN = "a".repeat(43)

describe("pasted link", () => {
  test("takes the token from a full link, a bare token, or neither", () => {
    expect(tokenFromInput(` http://127.0.0.1:7878/#token=${TOKEN} `)).toBe(TOKEN)
    expect(tokenFromInput(TOKEN)).toBe(TOKEN)
    // The phone pairing URL carries the token in the query, which the page never reads.
    expect(tokenFromInput(`ws://127.0.0.1:7878/?token=${TOKEN}`)).toBeNull()
    expect(tokenFromInput("http://127.0.0.1:7878/#token=short")).toBeNull()
  })
})

function leaves(tree: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === "string") out[path] = value
    else Object.assign(out, leaves(value, path))
  }
  return out
}

test("zh carries every en key, non-empty, with the same placeholders", () => {
  const e = leaves(en)
  const z = leaves(zh)
  expect(Object.keys(z).sort()).toEqual(Object.keys(e).sort())
  const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join()
  for (const key of Object.keys(e)) {
    expect(z[key].trim().length).toBeGreaterThan(0)
    expect(holes(z[key])).toBe(holes(e[key]))
  }
})

function row(id: string, repo: string, order: number): TaskRow {
  return {
    id,
    title: id,
    branch: "",
    repo,
    kind: "managed",
    status: "backlog",
    group: "idle",
    rank: 0,
    activity: null,
    engine: null,
    pr: null,
    report: null,
    deleting: false,
    order,
  }
}

describe("rail", () => {
  test("groups by project in the daemon's manual order, projects by their first task", () => {
    const groups = groupByProject([row("b1", "/w/beta", 2), row("a1", "/w/alpha", 1), row("b0", "/w/beta", 0)])
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.id)])).toEqual([
      ["beta", ["b0", "b1"]],
      ["alpha", ["a1"]],
    ])
  })

  test("uses the TUI's glyphs: ? waits on you, ! needs you, ● unseen turn, ○ quiet", () => {
    expect(activityGlyph("permission_needed", 0).glyph).toBe("?")
    for (const s of ["rate_limited", "error", "dead"]) expect(activityGlyph(s, 0).glyph).toBe("!")
    expect(activityGlyph("turn_complete", 0).glyph).toBe("●")
    expect(activityGlyph(undefined, 0).glyph).toBe("○")
    expect(activityGlyph("running", 0).glyph).not.toBe(activityGlyph("running", 1).glyph)
  })
})
