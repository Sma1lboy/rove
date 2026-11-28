/** @jsxImportSource @opentui/react */
/**
 * Render contract for the New task folder picker popover:
 *   - Clean search input (`Search folders...`) with `No folder`, `Recent`, and `Open folder…`.
 *   - Unique basenames render cleanly without full path clutter; duplicate basenames
 *     show their parent directory muted so each row stays distinguishable and submits its own path.
 *   - `Open folder…` opens the in-TUI folder browser starting at the active folder's parent,
 *     marks git repos, and lets the user pick a sibling or nested folder directly.
 *   - Typing a path directly in the search box still browses subdirectories verbatim.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NewTaskDialogView } from "../../src/tui-react/component/new-task-dialog/dialog"
import { type Field, type NewTaskInput, nextField } from "../../src/tui/component/new-task-dialog/state"
import { act, isolateHome, renderComponent, settle } from "./harness"

isolateHome()

/** A repo whose PARENT path is long enough to crowd the row. */
function repoUnderLongParent(name: string): string {
  const parent = mkdtempSync(join(tmpdir(), "rove-reponame-with-a-deliberately-long-parent-path-"))
  const dir = join(parent, name)
  mkdirSync(dir, { recursive: true })
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", { cwd: dir })
  return dir
}

function repo(name: string, parentDir?: string): string {
  const parent = parentDir ?? mkdtempSync(join(tmpdir(), "rove-reponame-"))
  const dir = join(parent, name)
  mkdirSync(dir, { recursive: true })
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
    { width, height: 48, providers: { kv: true, dialog: true } },
  )
  await settle()
  return { ...handle, submitted }
}

async function pressTab(handle: { mockInput: { pressTab: () => void } }, times: number) {
  for (let i = 0; i < times; i++) {
    act(() => handle.mockInput.pressTab())
    await settle()
  }
}

function stopsTo(target: Field, extrasVisible = false): number {
  let field: Field = "prompt"
  for (let i = 1; i <= 24; i++) {
    field = nextField(field, "existing", {
      intentVisible: false,
      extrasVisible,
      effortVisible: true,
      modelVisible: true,
      tierVisible: false,
    })
    if (field === target) return i
  }
  throw new Error(`the focus chain never reaches ${target}`)
}

async function commit(h: { mockInput: { pressEnter: () => void } }) {
  for (let i = 0; i < 2; i++) {
    act(() => h.mockInput.pressEnter())
    await settle()
  }
}

async function click(h: Awaited<ReturnType<typeof mount>>, needle: string) {
  const lines = (await h.frame()).split("\n")
  const hit = lines.flatMap((line, y) => (line.includes(needle) ? [{ x: line.indexOf(needle), y }] : []))[0]
  if (!hit) throw new Error(`not on screen: ${needle}`)
  await h.mockMouse.click(hit.x + 1, hit.y)
  await settle()
}

const TO_REPO = stopsTo("repo")
const TO_BASE_REF = stopsTo("baseRef")

test("a resolved repo shows its clean NAME with ✓ in Recent, and submits the full path", async () => {
  const dir = repo("quokka")
  const h = await mount(dir)
  expect(await h.frame()).toContain("quokka")
  await pressTab(h, TO_REPO)
  const f = await h.frame()
  expect(f).toContain("REPO")
  expect(f).toContain("Search folders...")
  expect(f).toContain("quokka")
  expect(f).toContain("✓")
  expect(f).toContain("+ Open folder…")
  // Unique basename stays clean — no noisy parent path dumped beside it.
  const parent = dir.slice(0, dir.lastIndexOf("/") + 1)
  expect(f).not.toContain(parent.slice(0, 30))

  await pressTab(h, TO_BASE_REF - TO_REPO)
  await commit(h)
  expect(h.submitted).toHaveLength(1)
  expect(h.submitted[0]).toMatchObject({ repo: dir })
  act(() => h.destroy())
})

test("duplicate basenames show their parent directories and submit the chosen path unambiguously", async () => {
  const a = repo("app")
  const b = repo("app")
  const h = await mount(a, [a, b])

  await pressTab(h, TO_REPO)
  const f = await h.frame()
  // Both share the basename `app`, so their parent dirs render muted to tell them apart.
  expect(f).toContain("app")
  expect(f).toContain(a.slice(0, 20))

  // Pick the second `app` (cursor starts on `a` at index 1, so one Down lands on `b`).
  act(() => h.mockInput.pressArrow("down"))
  await settle()
  act(() => h.mockInput.pressEnter())
  await settle()
  // Extra repos stop sits before baseRef; walk to baseRef and commit.
  await pressTab(h, 1)
  await commit(h)
  expect(h.submitted).toHaveLength(1)
  expect(h.submitted[0]).toMatchObject({ repo: b })
  act(() => h.destroy())
})

test("Open folder… browses sibling directories and picks an unsaved git repo directly", async () => {
  const parent = mkdtempSync(join(tmpdir(), "rove-siblings-"))
  const first = repo("alpha", parent)
  const sibling = repo("beta-sibling", parent)
  const h = await mount(first, [first])

  await pressTab(h, TO_REPO)
  await click(h, "Open folder…")
  const browseFrame = await h.frame()
  // Starts in `alpha`'s parent directory, listing sibling `beta-sibling/` with a git badge.
  expect(browseFrame).toContain("beta-sibling/")
  expect(browseFrame).toContain("git")
  expect(browseFrame).toContain("← Back")

  await click(h, "beta-sibling/")
  expect(await h.frame()).toContain("beta-sibling")
  // Picking `beta-sibling` advanced directly to `baseRef`; Enter picks branch, second Enter commits.
  await commit(h)
  expect(h.submitted).toHaveLength(1)
  expect(h.submitted[0]).toMatchObject({ repo: sibling })
  act(() => h.destroy())
})

test("Open folder… steps in with l, steps back with h, confirms with enter, and accepts a pasted filepath", async () => {
  const root = mkdtempSync(join(tmpdir(), "rove-hl-"))
  const outer = join(root, "group")
  const nested = repo("nested-app", outer)
  const pasted = repo("pasted-app", root)
  const h = await mount("", [])

  await pressTab(h, TO_REPO)
  await click(h, "+ Open folder…")
  // Paste a quoted filepath into Open folder… and confirm with Enter.
  await act(async () => h.mockInput.typeText(`"${pasted}"`))
  await settle()
  act(() => h.mockInput.pressEnter())
  await settle()
  expect(await h.frame()).toContain("pasted-app")

  // Reopen Open folder… from `pasted-app`: lands in `root` with `group/` listed and key hint shown.
  await click(h, "pasted-app")
  await click(h, "+ Open folder…")
  const rootFrame = await h.frame()
  expect(rootFrame).toContain("h/← back · l/→ open · enter select · esc return")
  expect(rootFrame).toContain("group/")
  // Move up from `pasted-app/` to `group/`, step IN with `l`, step BACK with `h`, step IN again with `l`, then confirm with Enter.
  act(() => h.mockInput.pressArrow("up"))
  await settle()
  act(() => h.mockInput.pressKey("l"))
  await settle()
  expect(await h.frame()).toContain("nested-app/")
  act(() => h.mockInput.pressKey("h"))
  await settle()
  expect(await h.frame()).toContain("▸ group/")
  act(() => h.mockInput.pressKey("l"))
  await settle()
  act(() => h.mockInput.pressEnter())
  await settle()
  await commit(h)
  expect(h.submitted).toHaveLength(1)
  expect(h.submitted[0]).toMatchObject({ repo: nested })
  act(() => h.destroy())
})

test("pasting a full path with a trailing slash or file:// URI confirms that exact folder, not its first child", async () => {
  const dir = repo("pasted-with-children")
  mkdirSync(join(dir, "src"), { recursive: true })
  const h = await mount("", [])

  await pressTab(h, TO_REPO)
  // Trailing slash lists `src/` below the input, yet Enter without arrowing down must pick `dir` itself.
  await act(async () => h.mockInput.typeText(`${dir}/`))
  await settle()
  act(() => h.mockInput.pressEnter())
  await settle()
  await commit(h)
  expect(h.submitted).toHaveLength(1)
  expect(h.submitted[0]).toMatchObject({ repo: dir })

  // A Linux file:// URI pasted directly into Search folders... resolves and submits cleanly too.
  await click(h, "pasted-with-children")
  const dir2 = repo("from-file-uri")
  await act(async () => h.mockInput.typeText(`file://${dir2}`))
  await settle()
  act(() => h.mockInput.pressEnter())
  await settle()
  await commit(h)
  expect(h.submitted[1]).toMatchObject({ repo: dir2 })
  act(() => h.destroy())
})

test("a path being typed renders verbatim and submits that path after Tab completion", async () => {
  const dir = repo("typed")
  const h = await mount(dir)

  await pressTab(h, TO_REPO)
  const partial = `${dir.slice(0, dir.lastIndexOf("/") + 1)}ty`
  await act(async () => h.mockInput.typeText(partial))
  await settle()
  const f = await h.frame()
  expect(f).toContain("typed/")
  expect(f).toContain(partial.slice(-24))

  await act(async () => h.mockInput.typeText("ped"))
  await settle()
  await pressTab(h, 2)
  await commit(h)
  expect(h.submitted[0]).toMatchObject({ repo: dir })
  act(() => h.destroy())
})

test("a long directory never eats into the name", async () => {
  const dir = repoUnderLongParent("fixture-repo")
  const h = await mount(dir)

  const row = (await h.frame()).split("\n").find((l) => l.includes("ture-repo"))
  expect(row).toBeDefined()
  expect(row).toContain("fixture-repo")
  act(() => h.destroy())
})
