/**
 * "Continue this conversation" on a WRAPPER preset (owner report 2026-09-02).
 *
 * A custom engine registered before `engineProtocol.<id>` existed — the
 * `claudecpa` zsh function that ends up running the real claude binary — has
 * a command and a display name in state.json and nothing else. Every session
 * verb keys on `sessionProtocol(vendor)`, which lands such an id on the empty
 * custom registry entry: no transcript reader (so `forkSourceSessionId` finds
 * zero sessions) and no fork verb, and ctrl+e → continue answered "nothing to
 * continue from" on a tab that had been talking to claude the whole time.
 *
 * The evidence was already recorded: the process-tree walk sees through the
 * wrapper and writes `EngineTab.liveVendor`. These pin the join — resolution
 * AND the launch line it has to produce, because fixing only the dialog moves
 * the same silent failure to spawn time.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { encodeCwd } from "@/engine/claude-code-local/history"
import { addForkTab, liveSourceProtocol, planChatContinuation } from "@/tui-react/workspace/fork-chat-tab"
import {
  type EngineTab,
  type TabsState,
  engineTabArgv,
  initialTabs,
  setTabSessionId,
} from "@/tui/workspace/terminal-tabs-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const WORKTREE = "/repo/wt-claudecpa"
const SESSION = "11111111-2222-3333-4444-555555555555"

/** The reported shape: launched as `claudecpa`, walked to claude, no pin. */
const wrapperTab = (over: Partial<EngineTab> = {}): EngineTab => ({
  kind: "engine",
  id: "tab-1",
  title: null,
  ordinal: 1,
  vendor: "claudecpa",
  liveVendor: "claude",
  ...over,
})

let claudeDir: string
let prevConfigDir: string | undefined

beforeAll(() => {
  // A real claude transcript store, so the history read under test is the
  // real reader rather than a stub that could agree with a broken caller.
  claudeDir = mkdtempSync(join(tmpdir(), "rove-claudecpa-"))
  const projectDir = join(claudeDir, "projects", encodeCwd(WORKTREE))
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, `${SESSION}.jsonl`), '{"type":"user","message":{"role":"user","content":"hi"}}\n')
  prevConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = claudeDir
})

afterAll(() => {
  // Empty restores the real store: the reader falls back on a blank value.
  process.env.CLAUDE_CONFIG_DIR = prevConfigDir ?? ""
  rmSync(claudeDir, { recursive: true, force: true })
})

describe("liveSourceProtocol", () => {
  it("resolves a preset with no declared protocol through the walked live vendor", () => {
    expect(liveSourceProtocol(wrapperTab(), "claudecpa")).toBe("claude")
  })

  it("keeps a declared protocol — walk evidence never re-labels a known engine", () => {
    expect(liveSourceProtocol(wrapperTab({ vendor: "codex", liveVendor: "claude" }), "codex")).toBe("codex")
  })

  it("stays on the id when there is no live evidence, or none that names a protocol", () => {
    expect(liveSourceProtocol(wrapperTab({ liveVendor: null }), "claudecpa")).toBe("claudecpa")
    expect(liveSourceProtocol(wrapperTab({ liveVendor: "other-wrapper" }), "claudecpa")).toBe("claudecpa")
  })
})

describe("continuing a wrapper-preset tab", () => {
  it("finds the wrapped engine's session and forks it", async () => {
    const source = liveSourceProtocol(wrapperTab(), "claudecpa")
    // The picker offers `claudecpa`; picking the id this tab already runs is
    // "continue here", so source and target are the same protocol.
    expect(await planChatContinuation(wrapperTab(), source, source, WORKTREE)).toEqual({
      kind: "fork",
      sessionId: SESSION,
    })
  })

  it("still reports nothing to continue when the id resolves to no protocol", async () => {
    // The pre-fix behaviour, kept as the contract for a genuinely unknown
    // engine: no reader, so no session, so a refusal instead of a blank tab.
    expect(await planChatContinuation(wrapperTab({ liveVendor: null }), "claudecpa", "claudecpa", WORKTREE)).toEqual({
      kind: "no-session",
    })
  })

  it("launches the preset the user picked and resumes-and-forks with the wrapped engine's flags", () => {
    const state: TabsState = { ...initialTabs(), tabs: [wrapperTab()] }
    const forked = setTabSessionId(addForkTab(state, "claudecpa", "claude", SESSION), "tab-2", "new-id")
    const tab = forked.tabs.find((t) => t.id === forked.activeId) as EngineTab
    // The launch stays the preset (its zsh function passes "$@" through);
    // only the protocol — and so the session verbs — is claude's.
    expect(tab.engineCommand).toBe("claudecpa")
    expect(tab.vendor).toBe("claude")
    expect(engineTabArgv(tab, ["claudecpa"], false)).toEqual([
      "claudecpa",
      "--resume",
      SESSION,
      "--fork-session",
      "--session-id",
      "new-id",
    ])
  })

  it("pins no redundant command when the pick already IS its protocol", () => {
    const state: TabsState = { ...initialTabs(), tabs: [wrapperTab()] }
    const tab = addForkTab(state, "claude", "claude", SESSION).tabs.at(-1) as EngineTab
    expect(tab.engineCommand).toBeUndefined()
  })
})
