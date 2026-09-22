/**
 * `state.json` key renames (`src/state/state-key-migration.ts`).
 *
 * The property under test is not "the new name appears" — it is that a
 * configuration someone already had keeps WORKING. `autoEffort.<tier>.engine`
 * shipped in v0.9.207 and `readAutoRoutingTable` reads a tier with no engine
 * as "the feature is off", so a rename that dropped the value would have
 * switched auto routing off silently, for exactly the users who had bothered
 * to configure it. The last case here asserts that end to end rather than
 * asserting about keys.
 *
 * Isolation is the same as the other state tests: `KOBE_HOME_DIR` points at a
 * per-test tmpdir, so the operator's real `~/.config/rove/state.json` is never
 * read or written.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readAutoRoutingTable } from "../../src/engine/auto-routing.ts"
import { getPersistedString } from "../../src/state/repos.ts"
import { migrateRenamedStateKeys } from "../../src/state/state-key-migration.ts"

let tmpHome: string
let originalHome: string | undefined

function statePath(): string {
  return path.join(tmpHome, ".config", "rove", "state.json")
}

function writeDisk(blob: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true })
  fs.writeFileSync(statePath(), JSON.stringify(blob), "utf8")
}

function readDisk(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(statePath(), "utf8")) as Record<string, unknown>
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "rove-key-migration-"))
  originalHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = tmpHome
})

afterEach(() => {
  // biome-ignore lint/performance/noDelete: env cleanup must fully unset when the var was unset before the test (assigning undefined leaves it as the string "undefined"). Same pattern as test/state/store.test.ts.
  if (originalHome === undefined) delete process.env.KOBE_HOME_DIR
  else process.env.KOBE_HOME_DIR = originalHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

describe("migrateRenamedStateKeys", () => {
  it("moves every autoEffort.* key to autoRouting.* and removes the old name", () => {
    writeDisk({
      "autoEffort.deep.engine": "codex",
      "autoEffort.deep.effort": "xhigh",
      "autoEffort.swift.model": "haiku",
    })
    expect(migrateRenamedStateKeys()).toEqual({ moved: 3, superseded: 0 })
    expect(readDisk()).toEqual({
      "autoRouting.deep.engine": "codex",
      "autoRouting.deep.effort": "xhigh",
      "autoRouting.swift.model": "haiku",
    })
  })

  it("leaves every other key exactly as it found it", () => {
    // The file is shared with every other setting Rove has, written by other
    // processes. A migration that rewrote the whole blob from its own idea of
    // what belongs there is the lost-update bug `store.ts` exists to prevent.
    writeDisk({ savedRepos: ["/repo/a"], "autoEffort.deep.engine": "codex", theme: "gruvbox" })
    migrateRenamedStateKeys()
    expect(readDisk()).toEqual({ savedRepos: ["/repo/a"], "autoRouting.deep.engine": "codex", theme: "gruvbox" })
  })

  it("does not write at all when there is nothing to move", () => {
    writeDisk({ "autoRouting.deep.engine": "codex" })
    const before = fs.statSync(statePath()).mtimeMs
    expect(migrateRenamedStateKeys()).toEqual({ moved: 0, superseded: 0 })
    expect(fs.statSync(statePath()).mtimeMs).toBe(before)
  })

  it("survives a missing state file", () => {
    expect(migrateRenamedStateKeys()).toEqual({ moved: 0, superseded: 0 })
    expect(fs.existsSync(statePath())).toBe(false)
  })

  it("leaves a file that is not JSON exactly where it is", () => {
    // Reading through `loadStateFile` here QUARANTINES such a file — that is
    // the store's corrupt-file policy, and it is right for a reader that needs
    // a value. This is not one. It cost a real regression: on the first launch
    // after the `.kobe` → `.rove` layout copy, the copy publishes the legacy
    // blob at this path and the rename then renamed it away, so a migration
    // that had nothing to do destroyed the file the migration before it had
    // just saved (test/behavior/rove-alias.test.ts).
    fs.mkdirSync(path.dirname(statePath()), { recursive: true })
    fs.writeFileSync(statePath(), "legacy prefs", "utf8")
    expect(migrateRenamedStateKeys()).toEqual({ moved: 0, superseded: 0 })
    expect(fs.readFileSync(statePath(), "utf8")).toBe("legacy prefs")
    expect(fs.readdirSync(path.dirname(statePath()))).toEqual(["state.json"])
  })

  it("takes no action on a value that merely mentions the old prefix", () => {
    // The pre-check is a substring test, so this reaches the transaction —
    // which walks real keys, finds none to move, and must not rewrite the file.
    writeDisk({ "engineCommand.claude": 'claude --note "autoEffort.deep.engine"' })
    const before = fs.statSync(statePath()).mtimeMs
    expect(migrateRenamedStateKeys()).toEqual({ moved: 0, superseded: 0 })
    expect(fs.statSync(statePath()).mtimeMs).toBe(before)
  })

  it("is idempotent — a second launch finds nothing left to do", () => {
    writeDisk({ "autoEffort.deep.engine": "codex" })
    expect(migrateRenamedStateKeys()).toEqual({ moved: 1, superseded: 0 })
    expect(migrateRenamedStateKeys()).toEqual({ moved: 0, superseded: 0 })
    expect(readDisk()).toEqual({ "autoRouting.deep.engine": "codex" })
  })

  it("keeps the NEW name when both exist, and still drops the stale twin", () => {
    // Reachable by running an older Rove once after this one: it rewrites the
    // legacy key while the new one is already set. The value under the new
    // name is the one this version's Settings wrote, so it wins — and leaving
    // the loser behind would put a value in every `rove config` dump that no
    // reader consults.
    writeDisk({ "autoEffort.deep.engine": "claude", "autoRouting.deep.engine": "codex" })
    expect(migrateRenamedStateKeys()).toEqual({ moved: 0, superseded: 1 })
    expect(readDisk()).toEqual({ "autoRouting.deep.engine": "codex" })
  })

  it("keeps a configured table CONFIGURED across the rename", () => {
    // The whole point. Without the move, `readAutoRoutingTable` sees a tier
    // whose engine is unset, reads it as the shipped default, and a user who
    // had pointed `deep` at codex silently gets claude back — or, with a
    // blanked engine, loses the feature entirely with nothing printed.
    writeDisk({ "autoEffort.deep.engine": "codex", "autoEffort.deep.effort": "xhigh" })
    migrateRenamedStateKeys()
    expect(readAutoRoutingTable(getPersistedString)?.deep).toEqual({
      engine: "codex",
      model: "fable",
      effort: "xhigh",
    })
  })

  it("carries the OFF switch too — a blanked engine still means off", () => {
    writeDisk({ "autoEffort.standard.engine": "" })
    migrateRenamedStateKeys()
    expect(readAutoRoutingTable(getPersistedString)).toBeNull()
  })
})
