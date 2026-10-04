import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * docs/API.md carries a table titled "Codes the CLI itself raises". A table
 * that claims to be the closed list is only worth reading if it IS one, and it
 * drifted the moment three codes were added without a row — a caller matching
 * on `code` then reads the table, concludes the code cannot happen, and writes
 * no branch for it. So derive the list from the source instead of trusting a
 * human to remember, and let this test be the reminder.
 *
 * Codes the DAEMON raises travel over the socket and are documented in the
 * paragraph above the table; only CLI-raised codes belong here.
 */

const CLI_DIR = resolve(import.meta.dirname, "../../src/cli")
const API_DOC = resolve(import.meta.dirname, "../../../../docs/API.md")

/** `RPC_ERROR` is the daemon's un-named failure, described in prose above the
 *  table precisely because it is the absence of a code, not one of them. */
const NOT_IN_TABLE = new Set(["RPC_ERROR"])

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return tsFiles(p)
    return e.isFile() && e.name.endsWith(".ts") ? [p] : []
  })
}

function raisedCodes(): Set<string> {
  const codes = new Set<string>()
  for (const file of tsFiles(CLI_DIR)) {
    const src = readFileSync(file, "utf8")
    // `new ApiError(<message>, "CODE"` and `fail(<message>, "CODE"` — the two
    // ways this surface refuses. The message argument may span lines and hold
    // one level of nested parens (a template call), which the inner
    // alternation covers.
    for (const m of src.matchAll(/(?:new ApiError|\bfail)\((?:[^()]|\([^()]*\))*?,\s*"([A-Z][A-Z_]*)"/g)) {
      if (!NOT_IN_TABLE.has(m[1]!)) codes.add(m[1]!)
    }
  }
  return codes
}

describe("docs/API.md — codes the CLI itself raises", () => {
  const doc = readFileSync(API_DOC, "utf8")
  const table = doc.slice(doc.indexOf("### Codes the CLI itself raises"))
  const documented = new Set(Array.from(table.matchAll(/^\| `([A-Z][A-Z_]*)` \|/gm), (m) => m[1]!))

  it("finds the codes to check (the scanner itself is not silently empty)", () => {
    const found = raisedCodes()
    expect(found.size).toBeGreaterThan(15)
    expect(found).toContain("MISSING_TARGET")
    expect(documented.size).toBeGreaterThan(15)
  })

  it("lists every code the CLI raises", () => {
    expect([...raisedCodes()].filter((c) => !documented.has(c)).sort()).toEqual([])
  })
})
