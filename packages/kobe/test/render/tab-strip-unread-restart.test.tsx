/** @jsxImportSource @opentui/react */
/**
 * Issue #23 at the render boundary: the tab strip's completion chip must
 * consult the SAME durable `(task, tab) → seen-at` record the sidebar lamp
 * reads (issue #22), so a completion you had already looked at does not come
 * back wearing a fresh ✓ after a restart.
 *
 * A relaunched kobe is exactly this state — no in-process history, and the
 * daemon still publishing the same sticky `turn_complete`. So the strip is
 * mounted through the REAL hook (`useDurableTabSeen`) against a seeded
 * state.json, not handed a precomputed set: the wiring is the thing that
 * broke, and `test/tui-react/completion-seen.test.ts` already owns the fold.
 *
 * The rail's counterpart lives in `sidebar-unread-restart.test.tsx`.
 */

import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChatTabTurnState } from "../../src/engine/turn-detector"
import { TAB_STRIP_MODE_KEY } from "../../src/state/tab-strip"
import { completionSeenKey } from "../../src/tui-react/workspace/completion-seen"
import { TURN_GLYPHS, TabStrip } from "../../src/tui-react/workspace/tab-strip"
import { useDurableTabSeen } from "../../src/tui-react/workspace/use-tab-turn-state"
import type { TerminalTab } from "../../src/tui/workspace/terminal-tabs-core"
import type { HookTabState } from "../../src/tui/workspace/turn-state-merge"
import { renderComponent } from "./harness"

/** The completion's stamp — the daemon republishes it after a restart. */
const AT = 1_760_000_000_000
const DONE = TURN_GLYPHS.done
const IDLE = TURN_GLYPHS.idle

const TABS: readonly TerminalTab[] = [
  { kind: "engine", id: "tab-1", title: "build", ordinal: 1 },
  { kind: "engine", id: "tab-2", title: "review", ordinal: 2 },
]

/** `tab-1` finished; `tab-2` is where you are sitting. */
const HOOK_STATES: ReadonlyMap<string, HookTabState> = new Map([["tab-1", { state: "turn_complete", at: AT }]])

/** The strip defaults to `never`; a restart test needs it actually drawn. */
function seedState(seen: Record<string, number>): void {
  const home = mkdtempSync(join(tmpdir(), "kobe-tab-strip-restart-"))
  mkdirSync(join(home, ".config", "rove"), { recursive: true })
  writeFileSync(
    join(home, ".config", "rove", "state.json"),
    JSON.stringify({ completionSeen: seen, [TAB_STRIP_MODE_KEY]: "always" }),
  )
  process.env.KOBE_HOME_DIR = home
}

/** `tab-2` is active, so `tab-1`'s completion is one you are NOT looking at
 *  — exactly where the chip is meant to speak. */
function Strip() {
  const seenTabs = useDurableTabSeen("alpha", HOOK_STATES, "tab-2")
  return (
    <TabStrip
      tabs={TABS}
      activeId="tab-2"
      turnStates={new Map<string, ChatTabTurnState>([["tab-1", "done"]])}
      onSelect={() => {}}
      vendor="claude"
      liveTitles={new Map()}
      turnVendors={new Map()}
      seenTabs={seenTabs}
    />
  )
}

test("a completion no persisted mark covers still wears the done chip", async () => {
  seedState({ [completionSeenKey("alpha", "tab-1")]: AT - 1 })
  const { frame } = await renderComponent(<Strip />, { width: 80, height: 4, providers: { kv: true } })
  expect(await frame()).toContain(DONE)
})

test("a completion the persisted mark covers reads as consumed across the restart", async () => {
  seedState({ [completionSeenKey("alpha", "tab-1")]: AT })
  const { frame } = await renderComponent(<Strip />, { width: 80, height: 4, providers: { kv: true } })
  const out = await frame()
  expect(out).not.toContain(DONE)
  expect(out).toContain(IDLE)
})
