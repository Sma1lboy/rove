/** @jsxImportSource @opentui/react */
/**
 * The Existing tab's repo field shows a NAME, with the directory demoted to
 * muted text at the row's right edge — while the value it submits stays a
 * full path.
 *
 * The split is only worth having if both halves hold at once, and the two
 * halves fail in opposite directions:
 *   - render only → the field could show a bare name and SUBMIT a bare name,
 *     which resolves to nothing (or, with ~100 flat repos under one parent,
 *     to the wrong one).
 *   - submit only → the path could still be sitting in the editable cell,
 *     which is the thing being changed.
 * So each test below reads the frame AND the submitted value.
 *
 * Real `git init` temp dirs because the tab validates the path and reads its
 * branches synchronously; a fake path renders the error state instead of the
 * fields.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NewTaskDialogView } from "../../src/tui-react/component/new-task-dialog/dialog"
import type { NewTaskInput } from "../../src/tui/component/new-task-dialog/state"
import { act, renderComponent, settle } from "./harness"

/** A repo whose PARENT path is long enough to crowd the row. */
function repoUnderLongParent(name: string): string {
  const parent = mkdtempSync(join(tmpdir(), "kobe-reponame-with-a-deliberately-long-parent-path-"))
  const dir = join(parent, name)
  execSync(`mkdir -p ${dir}`, { shell: "/bin/sh" })
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", { cwd: dir })
  return dir
}

function repo(name: string): string {
  const parent = mkdtempSync(join(tmpdir(), "kobe-reponame-"))
  const dir = join(parent, name)
  execSync(
    `mkdir -p ${dir} && git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init`,
    {
      cwd: parent,
      shell: "/bin/sh",
    },
  )
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", { cwd: dir })
  return dir
}

async function mount(defaultRepo: string, savedRepos: readonly string[] = [], width = 100) {
  const submitted: NewTaskInput[] = []
  const handle = await renderComponent(
    <NewTaskDialogView
      defaultRepo={defaultRepo}
      savedRepos={savedRepos}
      onSubmit={(v) => submitted.push(v)}
      onCancel={() => {}}
    />,
    { width, height: 40, providers: { kv: true, dialog: true } },
  )
  await settle()
  return { ...handle, submitted }
}

/** Where a string sits in the frame — the anchor a click needs. */
function locate(frameText: string, needle: string): { x: number; y: number } {
  const lines = frameText.split("\n")
  for (let y = 0; y < lines.length; y++) {
    const x = lines[y]?.indexOf(needle) ?? -1
    if (x >= 0) return { x, y }
  }
  throw new Error(`not on screen: ${needle}`)
}

/** Tab `times` stops along the field chain: tabs → engine → repo → baseRef. */
async function pressTab(handle: { mockInput: { pressTab: () => void } }, times: number) {
  for (let i = 0; i < times; i++) {
    act(() => handle.mockInput.pressTab())
    await settle()
  }
}

/** Stops from the dialog's opening field (`tabs`) to each input. */
const TO_REPO = 2
const TO_BASE_REF = 3

test("a resolved repo shows its NAME, not its path, and still submits the path", async () => {
  const dir = repo("quokka")
  const h = await mount(dir)
  const f = await h.frame()

  // The name is on screen and the full path is NOT sitting in the field.
  expect(f).toContain("quokka")
  // The directory is still visible — demoted, not deleted. It may be clipped
  // at the card edge (it is the half designed to give way), so assert its
  // head, which is the part that always renders.
  const parent = dir.slice(0, dir.lastIndexOf("/") + 1)
  expect(f).toContain(parent.slice(0, 40))

  // …and the value that leaves the dialog is the whole path. Enter on the
  // branch field is the commit.
  await pressTab(h, TO_BASE_REF)
  act(() => h.mockInput.pressEnter())
  await settle()
  expect(h.submitted).toHaveLength(1)
  expect(h.submitted[0]?.repo).toBe(dir)
})

test("a basename shared by two saved repos keeps the PATH — it identifies nothing", async () => {
  const a = repo("app")
  const b = repo("app")
  const h = await mount(a, [a, b])

  // Showing a name is only worth it when the name says WHICH repo. With two
  // saved `app`s it doesn't, so the field falls back to the path rather than
  // displaying a label that matches both. (~100 flat repos under one parent
  // makes this the ordinary case, not a corner.)
  expect(await h.frame()).toContain(a.slice(0, 40))

  // And it still submits the repo it was opened on, not the other `app`.
  await pressTab(h, TO_BASE_REF)
  act(() => h.mockInput.pressEnter())
  await settle()
  expect(h.submitted[0]?.repo).toBe(a)
  expect(h.submitted[0]?.repo).not.toBe(b)
})

test("typing an ambiguous name refuses to guess, and says so", async () => {
  const a = repo("app")
  const b = repo("app")
  const h = await mount(a, [a, b])

  // Type the bare shared name, then try to create. Resolving it to the
  // alphabetically-first match would silently open the wrong repo.
  await pressTab(h, TO_REPO)
  // ctrl+u clears the line in one keystroke — 80 backspaces is 80 renders and
  // overruns the per-test budget.
  await act(async () => h.mockInput.typeText("\x15"))
  await settle()
  await act(async () => h.mockInput.typeText("app"))
  await settle()

  // Leave the field by CLICKING the next one, because Tab no longer leaves an
  // unfinished name behind — it completes the highlighted row to its full
  // path first, which is a different (and answered) question. The guard is
  // about text that reaches the commit still naming two repos, and this is
  // the route that still gets it there.
  const label = locate(await h.frame(), "FROM BRANCH")
  await h.mockMouse.click(label.x + 1, label.y)
  await settle()
  act(() => h.mockInput.pressEnter())
  await settle()

  expect(h.submitted).toHaveLength(0)
  expect(await h.frame()).toContain("more than one saved repo is named app")
})

test("a path being typed renders VERBATIM — the field does not rewrite mid-keystroke", async () => {
  const dir = repo("typed")
  const h = await mount(dir)

  // Clear the field and type a path that is not (yet) any known repo. An
  // unresolved value must render exactly as typed: splitting a half-typed
  // path would leave the field disagreeing with the keys that produced it,
  // and typing a path is still the only way to reach a repo the saved list
  // has never seen.
  await pressTab(h, TO_REPO)
  await act(async () => h.mockInput.typeText("\x15"))
  await settle()
  const partial = `${dir.slice(0, dir.lastIndexOf("/") + 1)}ty`
  await act(async () => h.mockInput.typeText(partial))
  await settle()
  // The tail of what was typed is on screen verbatim — the field did not
  // swallow the directory half mid-keystroke.
  expect(await h.frame()).toContain(partial.slice(0, 40))

  // Completing it to the real repo submits that full path. Two Tabs, not
  // one: the first finishes the highlighted directory in place (that is the
  // field's own completion), and only the second — with nothing left to
  // finish — moves to the branch field. The trailing slash the walk leaves
  // in the box does not travel with the value.
  await act(async () => h.mockInput.typeText("ped"))
  await settle()
  await pressTab(h, 2)
  act(() => h.mockInput.pressEnter())
  await settle()
  expect(h.submitted[0]?.repo).toBe(dir)
})

test("picker rows right-align their directory tails into one column", async () => {
  // Names of deliberately different lengths: left-aligned-with-a-gap would
  // start each directory at a different column, and the whole point of the
  // change is that they share one right edge.
  const short = repo("a")
  const long = repo("a-much-longer-repo-name")
  // Wide enough that neither tail is clipped — a clipped tail ends where the
  // card ends for reasons that have nothing to do with alignment.
  const h = await mount(short, [short, long], 200)

  // Open the dropdown: focus the repo field, then clear it so both rows show.
  await pressTab(h, TO_REPO)
  await act(async () => h.mockInput.typeText("\x15"))
  await settle()

  const lines = (await h.frame()).split("\n")
  const rows = lines.filter((l) => l.includes("kobe-reponame-") && (l.includes(" a ") || l.includes("a-much-longer")))
  expect(rows.length).toBeGreaterThanOrEqual(2)

  // Every row's directory ends at the same column. `trimEnd().length` is that
  // right edge; equal across rows means one column, not a ragged trail.
  const ends = new Set(rows.map((l) => l.trimEnd().length))
  expect(ends.size).toBe(1)
})

test("a long directory never eats into the name", async () => {
  // Regression, caught in the harness and invisible to every test above: with
  // the input on `flexGrow`, a long directory compressed it below the name's
  // length — and an input narrower than its content scrolls to the cursor, so
  // `fixture-repo` rendered as `ture-repo`. Silent: no ellipsis, nothing that
  // reads as truncation, just a different repo name on screen.
  const dir = repoUnderLongParent("fixture-repo")
  const h = await mount(dir)

  const row = (await h.frame()).split("\n").find((l) => l.includes("ture-repo"))
  expect(row).toBeDefined()
  expect(row).toContain("fixture-repo")
})

test("a full-width row keeps air between the name and the directory", async () => {
  // `paddingLeft` on the muted tail belongs to the box Yoga is shrinking, so
  // on a row wide enough to close the gap it went to zero and the two halves
  // collided — `(current dir)/var/folders/…` reads as one string.
  const dir = repo("fixture-repo")
  const h = await mount(dir, [dir], 72)

  await pressTab(h, TO_REPO)
  await act(async () => h.mockInput.typeText("\x15"))
  await settle()

  const row = (await h.frame()).split("\n").find((l) => l.includes("current dir"))
  expect(row).toBeDefined()
  expect(row).not.toContain("dir)/")
})
