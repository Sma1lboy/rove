/** @jsxImportSource @opentui/react */
/**
 * A freeze-restored conversation must not read as a quiet one.
 *
 * The pty host thaws a dead session with its scrollback intact and marks it
 * `restored`; opening such a tab silently re-runs the recorded launch
 * command. The row used to wear `○` — the one glyph that means "nothing to
 * do here". The daemon now folds the host's session list into the row
 * status (`attention`, reason `restored`), so the task row draws what it is told.
 */

import { afterEach, expect, test } from "bun:test"
import type { BoxRenderable } from "@opentui/core"
import type { TabStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import type { TreeRowShared } from "../../src/tui-react/panes/sidebar/tree-row-shell"
import { WorktreeTreeRow } from "../../src/tui-react/panes/sidebar/tree-rows"
import { resetRowStatusForTests } from "../../src/tui-react/workspace/row-status-sync"
import { DEFAULT_GLYPHS } from "../../src/tui/lib/glyphs"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { renderComponent, settle } from "./harness"

const { idle: NO_STATE_GLYPH, attention: ATTENTION_GLYPH } = DEFAULT_GLYPHS

const TASK: Task = {
  id: toTaskId("alpha"),
  title: "alpha",
  repo: "/repos/rove",
  branch: "feat/alpha",
  worktreePath: "/wt/alpha",
  kind: "task",
  status: "in_progress",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
}

function shared(): TreeRowShared {
  return {
    width: 30,
    cursorIndex: -1,
    activeRowId: null,
    selectedTaskId: null,
    rowEls: new Map<number, BoxRenderable>(),
    onPress: () => {},
    branchTick: 0,
  }
}

async function glyphOf(status: TabStatus): Promise<string> {
  resetRowStatusForTests({ alpha: { task: status, tabs: { "tab-1": status } } })
  const { frame } = await renderComponent(
    <WorktreeTreeRow rowId="alpha" flatIndex={0} task={TASK} shared={shared()} />,
    { width: 30, height: 4 },
  )
  await settle(90)
  return await frame()
}

afterEach(() => resetRowStatusForTests())

test("a restored tab wears the attention glyph, a quiet one does not", async () => {
  // Both rows carry NO engine activity, which is exactly the case the bug hid
  // in: only the host knows the session is a corpse awaiting respawn.
  const quiet = await glyphOf({ kind: "idle", since: 0, alive: true, restored: false, tracked: false })
  const restored = await glyphOf({
    kind: "attention",
    reason: "restored",
    since: 0,
    alive: false,
    restored: true,
    tracked: false,
  })

  expect(quiet).toContain(NO_STATE_GLYPH)
  expect(quiet).not.toContain(ATTENTION_GLYPH)
  expect(restored).toContain(ATTENTION_GLYPH)
  expect(restored).not.toContain(NO_STATE_GLYPH)
})
