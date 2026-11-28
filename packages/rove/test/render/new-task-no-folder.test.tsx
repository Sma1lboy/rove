/** @jsxImportSource @opentui/react */
/** No folder heads the New task repo picker and submits a session in no project. */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NewTaskDialogView } from "../../src/tui-react/component/new-task-dialog/dialog"
import type { NewTaskInput } from "../../src/tui/component/new-task-dialog/state"
import { act, isolateHome, renderComponent, settle } from "./harness"

isolateHome()

function repo(name: string): string {
  const dir = join(mkdtempSync(join(tmpdir(), "rove-nofolder-")), name)
  execSync(
    `mkdir -p ${dir} && cd ${dir} && git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init`,
    {
      shell: "/bin/sh",
    },
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
    { width: 100, height: 48, providers: { kv: true, dialog: true } },
  )
  await settle()
  return { ...handle, submitted }
}

async function click(h: Awaited<ReturnType<typeof mount>>, needle: string, nth = 0) {
  const lines = (await h.frame()).split("\n")
  const hits = lines.flatMap((line, y) => (line.includes(needle) ? [{ x: line.indexOf(needle), y }] : []))
  const at = hits[nth]
  if (!at) throw new Error(`not on screen: ${needle}`)
  await h.mockMouse.click(at.x + 1, at.y)
  await settle()
}

async function press(h: Awaited<ReturnType<typeof mount>>, key: "down" | "enter" | "backspace", times = 1) {
  for (let i = 0; i < times; i++) {
    act(() => {
      if (key === "down") h.mockInput.pressArrow("down")
      else if (key === "enter") h.mockInput.pressEnter()
      else h.mockInput.pressBackspace()
    })
    await settle()
  }
}

test("opened without a project, the picker leads with No folder and a project is picked by keyboard", async () => {
  const otter = repo("otter")
  const h = await mount("", [otter])
  // No branch applies to No folder, so its chip is absent until a project is picked.
  expect(await h.frame()).not.toContain(" main ")

  // Chip invites picking a folder while the picker itself still leads with `No folder`.
  await click(h, "Choose folder")
  const rows = (await h.frame()).split("\n")
  expect(rows.findIndex((line) => line.includes("▸ No folder"))).toBeLessThan(
    rows.findIndex((line) => line.includes("otter")),
  )

  await press(h, "down")
  await press(h, "enter")
  expect(await h.frame()).toContain(" main ")
  // A project goes on to its branch, then Create.
  await press(h, "enter", 2)
  expect(h.submitted).toEqual([expect.objectContaining({ repo: otter, baseRef: "main" })])
  act(() => h.destroy())
})

test("a project's page lists No folder first without clearing the field, and a typed query filters it by label", async () => {
  const otter = repo("otter")
  const h = await mount(otter, [otter])
  await click(h, "otter")
  const rows = (await h.frame()).split("\n")
  expect(rows.findIndex((line) => line.includes("No folder"))).toBeLessThan(
    rows.findLastIndex((line) => line.includes("otter")),
  )

  await act(async () => h.mockInput.typeText("x"))
  await settle()
  expect(await h.frame()).not.toContain("No folder")
  await press(h, "backspace", "otterx".length)
  await act(async () => h.mockInput.typeText("fold"))
  await settle()
  await click(h, "No folder")
  expect(await h.frame()).not.toContain(" main ")
  await press(h, "enter")
  expect(h.submitted).toEqual([{ mode: "scratch", vendor: expect.any(String) }])
  act(() => h.destroy())
})
