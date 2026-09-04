/** @jsxImportSource @opentui/react */
/**
 * The Existing tab's "open the project" choice, through the real
 * dialog entry point.
 *
 * The flow-level tests (`test/tui/create-task-flow-open-project.test.ts`) pin
 * what `mode: "open"` DOES once submitted. What they cannot see is whether the
 * dialog ever produces it: `NewTaskDialog.show` is what wires `mainRepos` from
 * the caller's options down to the view-model, and a dropped prop there would
 * leave every one of those tests green while the choice never appeared on
 * screen. So these drive the mounted dialog and read the frame.
 *
 * The repos are real `git init` temp dirs because the tab reads branches and
 * validates the path synchronously — a fake path renders the error state
 * instead of the fields.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useEffect, useRef } from "react"
import { NewTaskDialog } from "../../src/tui-react/component/new-task-dialog"
import { useDialog } from "../../src/tui-react/ui/dialog"
import type { NewTaskInput } from "../../src/tui/component/new-task-dialog/state"
import { act, renderComponent, settle } from "./harness"

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "kobe-openproj-"))
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", { cwd: dir })
  return dir
}

/**
 * Mount the dialog the way a host does — through `NewTaskDialog.show` on a
 * live dialog stack, which is the wiring under test.
 */
function Harness(props: {
  repo: string
  saved?: readonly string[]
  mainRepos?: ReadonlySet<string>
  onSubmit: (v: NewTaskInput) => void
}) {
  const dialog = useDialog()
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    void NewTaskDialog.show(dialog, props.repo, props.saved ?? [props.repo], { mainRepos: props.mainRepos }).then(
      (result) => {
        if (result) props.onSubmit(result)
      },
    )
  }, [dialog, props.repo, props.saved, props.mainRepos, props.onSubmit])
  // DialogProvider renders the stack itself; this component only opens it.
  return <box />
}

async function mount(dir: string, mainRepos?: ReadonlySet<string>, saved?: readonly string[]) {
  const submitted: NewTaskInput[] = []
  const handle = await renderComponent(
    <Harness repo={dir} saved={saved} mainRepos={mainRepos} onSubmit={(v) => submitted.push(v)} />,
    {
      width: 100,
      height: 40,
      providers: { kv: true, dialog: true },
    },
  )
  await settle()
  return { ...handle, submitted }
}

test("a repo with a project checkout offers the choice", async () => {
  const dir = repo()
  const { frame } = await mount(dir, new Set([dir]))
  expect(await frame()).toContain("the project itself")
})

test("a repo with no project checkout does not", async () => {
  // The second option would resolve to nothing here, so the row is absent
  // rather than present-and-inert.
  const dir = repo()
  const { frame } = await mount(dir, new Set())
  expect(await frame()).not.toContain("the project itself")
})

test("omitting mainRepos entirely leaves the tab as it was", async () => {
  // A caller that passes no `mainRepos` gets the tab unchanged.
  const dir = repo()
  const { frame } = await mount(dir)
  const text = await frame()
  expect(text).not.toContain("the project itself")
  expect(text).toContain("FROM BRANCH")
})

/** Tab from the opening focus (`tabs`) to the intent row: engine, repo, intent. */
async function tabToIntent(mockInput: { pressTab: () => void }): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      mockInput.pressTab()
    })
    await settle()
  }
}

test("the intent row is reachable by keyboard, and choosing the project drops the branch field", async () => {
  // Opening a checkout forks from nothing, so a base branch would be a field
  // whose value is discarded — worse than absent.
  //
  // Driven through Tab + arrow rather than a click: the row was mouse-only at
  // first (no `Field` stop, so Tab walked straight past it and `right` cycled
  // the DIALOG tab instead), and a click-driven test passed against that.
  const dir = repo()
  const { frame, mockInput } = await mount(dir, new Set([dir]))
  expect(await frame()).toContain("FROM BRANCH")

  await tabToIntent(mockInput)
  await act(async () => {
    mockInput.pressArrow("right")
  })
  await settle()

  const text = await frame()
  expect(text).not.toContain("FROM BRANCH")
  // Still on the Existing tab — `right` must not have cycled the tab strip.
  expect(text).toContain("the project itself")
})

test("tab from the project intent lands on Create, not the hidden branch field", async () => {
  // The branch field is gone under this intent, so the walk has to skip its
  // stop too. Without the skip, focus parks on an input that is not on screen
  // and every following keystroke is typed into nothing — the same class of
  // dead end as the intent row having no stop at all, one field further on.
  const dir = repo()
  const { frame, mockInput } = await mount(dir, new Set([dir]))
  await tabToIntent(mockInput)
  await act(async () => {
    mockInput.pressArrow("right")
  })
  await settle()

  await act(async () => {
    mockInput.pressTab()
  })
  await settle()
  // The focused Create button is the only field marker still on screen.
  expect(await frame()).toContain("▸ [ Create ]")
})

test("picking a different repo resets the intent back to a task worktree", async () => {
  // The choice is per-repo, so it must not survive a repo change. Driven
  // through the PICKER (Enter on the dropdown), which is the route that used
  // to skip the reset: three call sites wrote `setRepo` directly, so typing
  // reset the intent and picking did not. Everything goes through
  // `changeRepo` now.
  const a = repo()
  const b = repo()
  const { frame, mockInput } = await mount(a, new Set([a, b]), [a, b])

  await tabToIntent(mockInput)
  await act(async () => {
    mockInput.pressArrow("right")
  })
  await settle()
  // The intent chips carry selection in their border colour, which a frame
  // dump cannot see — so read the intent off its CONSEQUENCE instead: the
  // project intent forks from nothing, so it hides the branch field.
  expect(await frame()).not.toContain("FROM BRANCH")

  // Back to the repo field (intent → confirm → tabs → engine → repo), then
  // pick the other saved repo out of the dropdown.
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      mockInput.pressTab()
    })
    await settle()
  }
  await act(async () => {
    mockInput.pressArrow("down")
  })
  await settle()
  await act(async () => {
    mockInput.pressEnter()
  })
  await settle()

  // Reset to the task worktree — the branch field is back.
  expect(await frame()).toContain("FROM BRANCH")
})

test("left returns to the task intent and the branch field comes back", async () => {
  const dir = repo()
  const { frame, mockInput } = await mount(dir, new Set([dir]))
  await tabToIntent(mockInput)
  await act(async () => {
    mockInput.pressArrow("right")
  })
  await settle()
  expect(await frame()).not.toContain("FROM BRANCH")

  await act(async () => {
    mockInput.pressArrow("left")
  })
  await settle()
  expect(await frame()).toContain("FROM BRANCH")
})
