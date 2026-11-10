/** @jsxImportSource @opentui/react */
/**
 * The Existing tab's "also include" list: the other saved repos, multi-selected with Enter, submitted in
 * pick order after the dialog's repo (the primary). Real `git init` dirs: the tab validates the path.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NewTaskDialogView } from "../../src/tui-react/component/new-task-dialog/dialog"
import { type Field, type NewTaskInput, nextField } from "../../src/tui/component/new-task-dialog/state"
import { act, renderComponent, settle } from "./harness"

function repo(name: string): string {
  const dir = join(mkdtempSync(join(tmpdir(), "rove-extras-")), name)
  execSync(
    `mkdir -p ${dir} && cd ${dir} && git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init`,
    { shell: "/bin/sh" },
  )
  return dir
}

async function mount(defaultRepo: string, savedRepos: readonly string[]) {
  const submitted: NewTaskInput[] = []
  const handle = await renderComponent(
    <NewTaskDialogView
      defaultRepo={defaultRepo}
      savedRepos={savedRepos}
      onSubmit={(v) => submitted.push(v)}
      onCancel={() => {}}
    />,
    { width: 100, height: 70, providers: { kv: true, dialog: true } },
  )
  await settle()
  return { ...handle, submitted }
}

/** Tab stops from the opening field to `target`, counted from the focus chain (claude: model and effort rows). */
function stopsTo(target: Field): number {
  let field: Field = "tabs"
  for (let i = 1; i <= 24; i++) {
    field = nextField(field, "existing", { extrasVisible: true, effortVisible: true, modelVisible: true })
    if (field === target) return i
  }
  throw new Error(`the focus chain never reaches ${target}`)
}

async function press(
  h: { mockInput: { pressTab: () => void; pressEnter: () => void; pressArrow: (d: "down" | "up") => void } },
  key: "tab" | "enter" | "down" | "up",
  times = 1,
) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      if (key === "tab") h.mockInput.pressTab()
      else if (key === "enter") h.mockInput.pressEnter()
      else h.mockInput.pressArrow(key)
    })
    await settle()
  }
}

test("picks submit as extraRepos in pick order; the primary is never offered as an extra", async () => {
  const primary = repo("primary-app")
  const api = repo("alpha-api")
  const docs = repo("beta-docs")
  const h = await mount(primary, [primary, api, docs])

  await press(h, "tab", stopsTo("extras"))
  const frame = await h.frame()
  expect(frame).toContain("ALSO INCLUDE")
  expect(frame).toContain("alpha-api")
  expect(frame).toContain("beta-docs")
  // The primary appears once, in the repo field, not as a candidate row.
  expect(frame.match(/primary-app/g)).toHaveLength(1)

  // Pick docs first, then api: the order of picking is the order sent.
  await press(h, "down")
  await press(h, "enter")
  await press(h, "up")
  await press(h, "enter")
  expect(await h.frame()).toContain("beta-docs, alpha-api")

  // Tab to the branch field, Enter walks to the message, Enter creates.
  await press(h, "tab")
  await press(h, "enter", 2)
  expect(h.submitted).toHaveLength(1)
  expect(h.submitted[0]).toMatchObject({ repo: primary, extraRepos: [docs, api] })
  act(() => h.destroy())
})

test("with no other saved repo there is nothing to include: no row, no Tab stop", async () => {
  const only = repo("only-app")
  const h = await mount(only, [only])
  expect(await h.frame()).not.toContain("ALSO INCLUDE")
  act(() => h.destroy())
})
