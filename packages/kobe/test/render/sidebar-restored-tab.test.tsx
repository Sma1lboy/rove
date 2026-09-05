/** @jsxImportSource @opentui/react */
/**
 * A freeze-restored tab row must not read as a quiet one.
 *
 * The pty host thaws a dead session with its scrollback intact and marks it
 * `restored`; opening such a tab silently re-runs the recorded launch
 * command. The row used to wear `○` — the one glyph that means "nothing to
 * do here" — and the tree had the fact in hand the whole time.
 *
 * Why this mounts `TabTreeRow` rather than adding a `SidebarTree` scene:
 * `restored` reaches the tree through `useHostSessions`, whose poll is
 * disabled under every test runner on purpose (it caches one process-wide
 * pty client and would steal the socket `pty-hosted.test.ts` owns). So the
 * whole-tree path cannot carry the flag in this track, and the row component
 * is the widest boundary a render test can actually drive.
 */

import { expect, test } from "bun:test"
import type { BoxRenderable } from "@opentui/core"
import { TabTreeRow, type TreeRowShared } from "../../src/tui-react/panes/sidebar/tree-rows"
import { ATTENTION_GLYPH, NO_STATE_GLYPH } from "../../src/tui/panes/sidebar/row-view"
import type { TreeTab } from "../../src/tui/panes/sidebar/tree-core"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { renderComponent, settle } from "./harness"

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

function tab(over: Partial<TreeTab> = {}): TreeTab {
  return { id: "tab-1", label: "build", engine: true, ...over } as TreeTab
}

async function glyphOf(t: TreeTab): Promise<string> {
  const { frame } = await renderComponent(
    <TabTreeRow rowId="alpha::tab-1" flatIndex={0} task={TASK} tab={t} shared={shared()} />,
    { width: 30, height: 4 },
  )
  await settle(90)
  return await frame()
}

test("a restored tab wears the attention glyph, a quiet one does not", async () => {
  // Both rows are otherwise identical and carry NO daemon activity, which is
  // exactly the case the bug hid in: with no engine state the row falls back
  // to `○`, so a corpse awaiting respawn looked like an idle tab.
  const quiet = await glyphOf(tab())
  const restored = await glyphOf(tab({ restored: true }))

  expect(quiet).toContain(NO_STATE_GLYPH)
  expect(quiet).not.toContain(ATTENTION_GLYPH)
  expect(restored).toContain(ATTENTION_GLYPH)
  expect(restored).not.toContain(NO_STATE_GLYPH)
})
