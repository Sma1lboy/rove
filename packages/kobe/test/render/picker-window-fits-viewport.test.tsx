/** @jsxImportSource @opentui/react */
/**
 * Both branch pickers must fit the terminal they are drawn in.
 *
 * They share `windowAround` + `pickerVisibleRows`, and the dialog card is
 * capped at the viewport with nothing to scroll it — so a window sized
 * independently of the height pushes the card's own bottom rows off the
 * screen. This mounts the REAL dialogs at a short and a tall viewport: the
 * pure test cannot see whether a component actually calls the helper, and an
 * uncalled helper renders exactly like the bug.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BranchPickerDialogView } from "../../src/tui-react/component/branch-picker-dialog"
import { NewTaskDialogView } from "../../src/tui-react/component/new-task-dialog/dialog"
import { PICKER_MAX_VISIBLE } from "../../src/tui/component/new-task-dialog/state"
import { act, renderComponent, settle } from "./harness"

/** More branches than any window will show, so the cap is what bounds it. */
function repoWithBranches(count: number): string {
  const repo = mkdtempSync(join(tmpdir(), "kobe-picker-"))
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", { cwd: repo })
  for (let i = 0; i < count; i++) execSync(`git branch feature/branch-name-${i}`, { cwd: repo })
  return repo
}

/** Picker rows in a frame: the cursor row (`▸ `) plus its indented siblings,
 *  excluding the `↑/↓ N more` overflow lines, which are chrome, not entries. */
const branchRows = (frame: string): number =>
  frame.split("\n").filter((l) => /^\s+(▸ )?(main|feature\/)/.test(l)).length

test("the set-branch dialog shrinks its picker on a short terminal", async () => {
  const repo = repoWithBranches(20)
  async function rowsAt(height: number): Promise<{ rows: number; frame: string }> {
    const { frame } = await renderComponent(
      <BranchPickerDialogView currentBranch="" repo={repo} onSubmit={() => {}} onCancel={() => {}} />,
      { width: 100, height, providers: { dialog: true } },
    )
    const text = await frame()
    return { rows: branchRows(text), frame: text }
  }

  const short = await rowsAt(24)
  const tall = await rowsAt(40)
  expect(tall.rows).toBeGreaterThan(short.rows) // the window followed the height
  expect(short.rows).toBeGreaterThanOrEqual(2) // still a list, still scrollable
  // The overflow line stays honest about what is hidden, at both heights.
  expect(short.frame).toContain("more")
  expect(tall.frame).toContain("more")
})

/**
 * The clone tab's parent-dir picker, over a directory WE build — the machine's
 * real `/` would make the row count depend on the host.
 */
function dirWithChildren(count: number): string {
  const parent = mkdtempSync(join(tmpdir(), "kobe-clonetab-"))
  for (let i = 0; i < count; i++) mkdirSync(join(parent, `child-${String(i).padStart(2, "0")}`))
  return parent
}

async function cloneTabFrame(height: number, parent: string): Promise<string> {
  // Own KV home per mount: `KVProvider` reads `$KOBE_HOME_DIR`, and the clone
  // tab persists its parent dir there.
  process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-clonehome-"))
  const { frame, mockInput } = await renderComponent(
    <NewTaskDialogView
      defaultRepo={tmpdir()}
      savedRepos={[]}
      defaultCloneParent={`${parent}/`}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
    { width: 100, height, providers: { kv: true, dialog: true } },
  )
  act(() => mockInput.pressKey("]", { ctrl: true })) // → For New Repo
  await settle()
  act(() => mockInput.pressTab()) // → parent dir (the tab selector holds focus on open)
  await settle()
  // `typeText` is ASYNC — `act(() => …)` around it leaves the promise
  // unawaited, and the resulting act-scope leak makes EVERY later render test
  // in the run read a stale frame (105 phantom failures when this file landed
  // mid-suite). Await the promise inside an async act instead.
  await act(async () => {
    await mockInput.typeText("c") // browse the children we just made
  })
  await settle(400)
  return await frame()
}

/** Picker rows: the indented `<name>/` entries, excluding the `↓ N more`
 *  overflow line and the muted "(remembered …)" hint above the list. */
const dirRows = (frame: string): number => frame.split("\n").filter((l) => /child-\d\d\//.test(l)).length

test("the clone tab's parent-dir picker fits a 24-row terminal", async () => {
  // Same fixed window, one tab over — `use-clone-state` owns this one.
  const text = await cloneTabFrame(24, dirWithChildren(20))
  expect(text).toContain("Create") // the card's own bottom row survived
  // The window SHRANK: the default cap is 8, and 24 rows leaves room for far
  // fewer. Asserting only "some rows and an overflow line" would pass with the
  // fixed cap too, since 20 children overflow either way.
  const shown = dirRows(text)
  expect(shown).toBeGreaterThanOrEqual(1) // still a usable list
  expect(shown).toBeLessThan(PICKER_MAX_VISIBLE) // …but not the desktop window
  // …and the overflow line accounts for every entry the window hides. The
  // typed `c` is consumed as the path prefix being browsed, so the list is
  // the 19 siblings of the one the cursor sits on.
  const hidden = Number(text.match(/↓ (\d+) more/)?.[1] ?? "0")
  expect(shown + hidden).toBe(19)
})

// Scope note, so the next reader does not over-trust the clone test above:
// at 24 rows the clone card is short enough that Yoga clamps its picker to one
// row on its own, so that test does NOT discriminate whether `use-clone-state`
// passes the cap — removing the argument renders an identical frame. It pins
// the user-visible contract (a usable list, an honest overflow count, and a
// reachable Create button); the CAP ITSELF is pinned by the set-branch test
// above, which drives the same helper at two heights and does go red when the
// window stops following the viewport.
