/** @jsxImportSource @opentui/react */
/**
 * Tab in the Existing tab's repo field COMPLETES before it advances.
 *
 * The bug this pins: every key that could finish a suggestion also left the
 * field. Enter picked-and-advanced, Tab advanced, and the dropdown's whole
 * reason for existing — "keep going, one level at a time" — had no key. You
 * saw `academic…` under your `a`, pressed the key that finishes things in
 * every shell you own, and landed on `from branch` with `a` still in the
 * repo box.
 *
 * So the contract has two halves and they only mean something together:
 *   - complete-only → a Tab that finishes the name but never advances traps
 *     focus, and the field costs an extra keystroke forever.
 *   - advance-only → the old bug.
 * Each test below therefore presses Tab twice and asserts what BOTH presses
 * did, not just the first.
 *
 * Real `git init` temp dirs, same as the sibling repo-name-field tests: the
 * tab validates the path and reads its branches synchronously.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NewTaskDialogView } from "../../src/tui-react/component/new-task-dialog/dialog"
import type { NewTaskInput } from "../../src/tui/component/new-task-dialog/state"
import { act, renderComponent, settle } from "./harness"

function repo(name: string): string {
  const parent = mkdtempSync(join(tmpdir(), "kobe-tabcomplete-"))
  const dir = join(parent, name)
  mkdirSync(dir)
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", { cwd: dir })
  return dir
}

async function mount(defaultRepo: string, savedRepos: readonly string[] = []) {
  const submitted: NewTaskInput[] = []
  const handle = await renderComponent(
    <NewTaskDialogView
      defaultRepo={defaultRepo}
      savedRepos={savedRepos}
      onSubmit={(v) => submitted.push(v)}
      onCancel={() => {}}
    />,
    { width: 200, height: 40, providers: { kv: true, dialog: true } },
  )
  await settle()
  return { ...handle, submitted }
}

async function pressTab(handle: { mockInput: { pressTab: () => void } }, times = 1) {
  for (let i = 0; i < times; i++) {
    act(() => handle.mockInput.pressTab())
    await settle()
  }
}

/** Stops from the dialog's opening field (`tabs`) to the repo input. */
const TO_REPO = 2

/** Focus the repo field and empty it — ctrl+u, because 80 backspaces is 80
 *  renders and overruns the per-test budget. */
async function focusEmptyRepo(h: Awaited<ReturnType<typeof mount>>) {
  await pressTab(h, TO_REPO)
  await act(async () => h.mockInput.typeText("\x15"))
  await settle()
}

test("browse mode: each Tab walks one directory deeper, in place", async () => {
  const parent = mkdtempSync(join(tmpdir(), "kobe-tabwalk-"))
  mkdirSync(join(parent, "level1"))
  mkdirSync(join(parent, "level1", "level2"))
  const h = await mount(repo("origin"))

  // A path with a trailing slash puts the picker in browse mode, listing the
  // one subdirectory under it.
  await focusEmptyRepo(h)
  await act(async () => h.mockInput.typeText(`${parent}/`))
  await settle()
  expect(await h.frame()).toContain("level1/")

  // First Tab: the suggestion lands IN the field, with the trailing slash
  // that re-points the picker at what's inside it.
  await pressTab(h)
  expect(await h.frame()).toContain("/level1/")
  // …and the dropdown is now showing that directory's children, which is the
  // half that proves focus never left.
  expect(await h.frame()).toContain("level2/")

  // Second Tab: another step, not a repeat.
  await pressTab(h)
  expect(await h.frame()).toContain("/level1/level2/")
  act(() => h.destroy())
})

test("saved mode: Tab finishes the name, the NEXT Tab leaves the field", async () => {
  const zephyr = repo("zephyr")
  const other = repo("mongoose")
  const h = await mount(repo("origin"), [zephyr, other])

  // A prefix that is not a repo on its own. Under the old behavior this
  // stayed `zeph` and the dialog carried an unresolvable value forward.
  await focusEmptyRepo(h)
  await act(async () => h.mockInput.typeText("zeph"))
  await settle()

  await pressTab(h)
  expect(await h.frame()).toContain("zephyr")

  // Nothing left to complete, so the second Tab means what it always meant.
  // Enter on `from branch` is the tab's create — if the FIRST Tab had
  // advanced instead of completing, focus would sit on Create with `zeph` in
  // the repo box and this would fail validation rather than submit.
  await pressTab(h)
  act(() => h.mockInput.pressEnter())
  await settle()
  expect(h.submitted).toHaveLength(1)
  expect(h.submitted[0]?.repo).toBe(zephyr)
  act(() => h.destroy())
})

test("Tab still advances when the dropdown has nothing to offer", async () => {
  // The guard is the picker's own render condition: no visible suggestion,
  // no completion, and the key keeps its old job. Without this the field
  // would swallow Tab and trap focus whenever a query matched nothing.
  const dir = repo("solo")
  const h = await mount(dir)

  await focusEmptyRepo(h)
  await act(async () => h.mockInput.typeText("no-such-repo-anywhere"))
  await settle()

  await pressTab(h)
  act(() => h.mockInput.pressEnter())
  await settle()
  // Focus reached `from branch`, whose Enter commits — and the invalid repo
  // is refused there, on screen, instead of the key vanishing.
  expect(h.submitted).toHaveLength(0)
  expect(await h.frame()).toContain("no-such-repo-anywhere")
  act(() => h.destroy())
})

test("the Clone tab's parent dir walks the same way — one key, both path fields", async () => {
  // Same drill-down picker, two tabs apart. A Tab that walked the repo field
  // but not this one would be worse than a Tab that walked neither: the key
  // would mean two things inside one dialog.
  const parent = mkdtempSync(join(tmpdir(), "kobe-tabwalk-clone-"))
  mkdirSync(join(parent, "level1"))
  mkdirSync(join(parent, "level1", "level2"))
  const h = await mount(repo("origin"))

  // → on the mode selector switches to "For New Repo"; Tab then walks
  // engine → git url → parent dir.
  act(() => h.mockInput.pressArrow("right"))
  await settle()
  await pressTab(h, 3)
  await act(async () => h.mockInput.typeText("\x15"))
  await settle()
  await act(async () => h.mockInput.typeText(`${parent}/`))
  await settle()

  await pressTab(h)
  expect(await h.frame()).toContain("/level1/")
  await pressTab(h)
  expect(await h.frame()).toContain("/level1/level2/")
  act(() => h.destroy())
})
