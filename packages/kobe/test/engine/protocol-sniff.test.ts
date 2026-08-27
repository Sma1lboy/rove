/**
 * Tier (b) of protocol resolution — naming the engine behind a session whose
 * launch command tier (a) could not name (issue #30).
 *
 * The rule under test is conservatism: evidence identifies, absence of
 * evidence answers null, and AMBIGUOUS evidence also answers null. A wrong
 * protocol is worse than no protocol — it points the history reader and the
 * trust store at another vendor's files — so a glyph two vendors both write
 * must identify neither. Today's built-in vocabularies happen to be disjoint
 * (pinned below), which is what lets a title identify anything at all.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  protocolUpgradeFromLiveSession,
  sniffProtocolFromSessions,
  sniffProtocolFromTitle,
} from "../../src/engine/protocol-sniff.ts"
import { engineEntry } from "../../src/engine/registry.ts"
import { BUILTIN_VENDORS } from "../../src/types/vendor.ts"

describe("sniffProtocolFromTitle", () => {
  it("names the vendor whose status glyph is UNIQUE to it", () => {
    // claude's resting ✳ belongs to no other built-in.
    expect(sniffProtocolFromTitle("✳ refactoring the parser")).toBe("claude")
  })

  it("names codex from a spinner frame only codex declares", () => {
    expect(sniffProtocolFromTitle("⠹ fixing the build")).toBe("codex")
  })

  it("keeps the built-in vocabularies disjoint — the property the sniff rests on", () => {
    // Every glyph today belongs to exactly one engine, which is WHY a title
    // can identify one. The sniff returns null for a shared glyph rather than
    // picking a winner, so a future engine that borrows ✳ or a braille frame
    // degrades this test to a null answer instead of a silent misattribution
    // — but it should fail HERE first, where the cause is visible.
    const owners = new Map<string, string[]>()
    for (const vendor of BUILTIN_VENDORS) {
      for (const glyph of engineEntry(vendor).terminalTitle?.statusPrefixes ?? []) {
        owners.set(glyph, [...(owners.get(glyph) ?? []), vendor])
      }
    }
    const shared = [...owners.entries()].filter(([, vendors]) => vendors.length > 1)
    expect(shared).toEqual([])
  })

  it("stays silent on an undecorated title", () => {
    expect(sniffProtocolFromTitle("bash")).toBeNull()
    expect(sniffProtocolFromTitle("")).toBeNull()
    expect(sniffProtocolFromTitle(null)).toBeNull()
    expect(sniffProtocolFromTitle(undefined)).toBeNull()
  })

  it("treats a title that is ONLY the glyph as a name, not a status", () => {
    // Same conservatism as `stripEngineStatusPrefix`: a session genuinely
    // named "✳" is a name; there is no title left to be decorating.
    expect(sniffProtocolFromTitle("✳")).toBeNull()
  })
})

describe("sniffProtocolFromSessions", () => {
  it("stays silent without a worktree to look under", async () => {
    expect(await sniffProtocolFromSessions(undefined)).toBeNull()
    expect(await sniffProtocolFromSessions("")).toBeNull()
  })

  it("stays silent for a directory no engine has ever written a session for", async () => {
    // Readers are best-effort by contract, so a nonexistent path resolves to
    // "no store answered" rather than throwing.
    expect(await sniffProtocolFromSessions("/nonexistent/worktree-that-no-engine-touched")).toBeNull()
  })
})

describe("protocolUpgradeFromLiveSession", () => {
  // The eligibility rule reads the preset registry (tier a), so the state
  // home is pinned to an empty sandbox — the user's real custom engines
  // must never decide what "generic" means in a test.
  let home: string
  let originalHome: string | undefined

  function writeState(state: Record<string, unknown>): void {
    const dir = join(home, ".config", "rove")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "state.json"), JSON.stringify(state), "utf8")
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kobe-protocol-sniff-"))
    originalHome = process.env.KOBE_HOME_DIR
    process.env.KOBE_HOME_DIR = home
    writeState({})
  })

  afterEach(() => {
    if (originalHome === undefined) {
      // biome-ignore lint/performance/noDelete: the var must be truly unset when it started unset.
      delete process.env.KOBE_HOME_DIR
    } else process.env.KOBE_HOME_DIR = originalHome
    rmSync(home, { recursive: true, force: true })
  })

  const generic = { vendor: "generic", command: "my-wrapper.sh --yolo" }

  it("upgrades a generic record when the walk finds a built-in engine in its tree", () => {
    expect(protocolUpgradeFromLiveSession(generic, { walkVendor: "claude", title: "zsh" })).toEqual({
      command: "my-wrapper.sh --yolo",
      vendor: "claude",
    })
  })

  it("upgrades from the title glyph when the walk sees nothing (renamed binary)", () => {
    // A wrapper that execs a RENAMED claude never matches a process name —
    // the engine's own title vocabulary is the only fingerprint left.
    expect(protocolUpgradeFromLiveSession(generic, { walkVendor: null, title: "✳ refactoring" })).toEqual({
      command: "my-wrapper.sh --yolo",
      vendor: "claude",
    })
  })

  it("refuses when the record already names a built-in protocol", () => {
    // Sniffing must never flip one engine to another — even against
    // apparently contradicting live evidence.
    expect(
      protocolUpgradeFromLiveSession(
        { vendor: "codex", command: "my-wrapper.sh" },
        { walkVendor: "claude", title: "✳ x" },
      ),
    ).toBeNull()
  })

  it("refuses a record with no pinned command — those LAUNCH from `vendor`", () => {
    expect(protocolUpgradeFromLiveSession({ vendor: "my-preset" }, { walkVendor: "claude", title: "✳ x" })).toBeNull()
  })

  it("refuses when tier (a) can already name the command", () => {
    // `claude` resolves deterministically; runtime evidence (even codex's
    // own glyph) must not override a derivable protocol.
    expect(
      protocolUpgradeFromLiveSession({ vendor: "claude", command: "claude" }, { walkVendor: "codex", title: "⠹ x" }),
    ).toBeNull()
  })

  it("refuses when the command is a preset with a DECLARED protocol", () => {
    writeState({ customEngineIds: ["aider"], "engineCommand.aider": "aider", "engineProtocol.aider": "claude" })
    expect(
      protocolUpgradeFromLiveSession({ vendor: "claude", command: "aider" }, { walkVendor: "codex", title: "⠹ x" }),
    ).toBeNull()
  })

  it("stays generic when the evidence names nothing", () => {
    expect(protocolUpgradeFromLiveSession(generic, { walkVendor: null, title: "bash" })).toBeNull()
    expect(protocolUpgradeFromLiveSession(generic, { walkVendor: null, title: "" })).toBeNull()
    // A walk verdict that is not a built-in identifies no protocol either.
    expect(protocolUpgradeFromLiveSession(generic, { walkVendor: "mystery-engine", title: "bash" })).toBeNull()
  })
})
