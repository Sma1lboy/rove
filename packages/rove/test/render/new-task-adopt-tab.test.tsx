/** @jsxImportSource @opentui/react */
/**
 * The new-task dialog's Adopt tab (`component/new-task-dialog/tab-adopt.tsx`)
 * — discovered worktrees, the path-glob filter, and multi-select.
 *
 * The tab is reachable only through `ctrl+]` twice, so nothing else mounts
 * it: it was the one body of the three that had no render test at all, which
 * is how it could adopt the house dialog grammar and still be the only tab
 * whose filter field had no well. These drive the REAL tab switch rather
 * than rendering `AdoptTab` directly, because a body that renders correctly
 * and cannot be reached is the failure this file is for.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NewTaskDialogView } from "../../src/tui-react/component/new-task-dialog/dialog"
import type { AdoptableWorktree } from "../../src/types/worktree"
import { type RenderHandle, act, renderComponent, settle } from "./harness"

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "kobe-adopt-"))
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", { cwd: dir })
  return dir
}

const WORKTREES: readonly AdoptableWorktree[] = [
  {
    path: "/tmp/wt/alpha",
    branch: "feature/alpha",
    head: "a1b2c3d",
    dirty: false,
    kobeManaged: true,
    lastActivityMs: 2,
  },
  { path: "/tmp/wt/beta", branch: "feature/beta", head: "d4e5f6a", dirty: true, kobeManaged: false, lastActivityMs: 1 },
]

/** Mount, then `ctrl+]` twice: Existing → For New Repo → Adopt Worktree. */
async function onAdoptTab(dir: string): Promise<RenderHandle> {
  process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-adopthome-"))
  const handle = await renderComponent(
    <NewTaskDialogView
      defaultRepo={dir}
      savedRepos={[]}
      discoverAdoptable={async () => WORKTREES}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
    { width: 100, height: 44, providers: { kv: true, dialog: true } },
  )
  for (let i = 0; i < 2; i++) {
    await act(async () => {
      handle.mockInput.pressKey("]", { ctrl: true })
    })
    await settle()
  }
  await settle(400)
  return handle
}

test("the tab lists the discovered worktrees behind a framed, capitalised filter", async () => {
  const { frame } = await onAdoptTab(repo())
  const text = await frame()
  expect(text).toContain("Adopt Worktree")
  // DialogSection + DialogField — the same grammar the other two tabs wear
  // (docs/design/dialogs.md), rounded because DialogField spreads FRAME.
  expect(text).toContain("FILTER (PATH GLOB)")
  expect(text).toContain("╭")
  expect(text).not.toContain("┌")
  // Both worktrees, each with its unselected checkbox and its tags.
  expect(text).toContain("feature/alpha")
  expect(text).toContain("feature/beta")
  expect(text).toContain("[ ]")
  expect(text).toContain("dirty")
  expect(text).toContain("external")
})

test("enter on the cursor row selects it, and the hint counts what is selected", async () => {
  const { frame, mockInput } = await onAdoptTab(repo())
  await frame()
  await act(async () => {
    mockInput.pressEnter()
  })
  await settle()
  const text = await frame()
  expect(text).toContain("[x]") // the row toggled
  expect(text).toContain("1") // …and the footer says how many
})
