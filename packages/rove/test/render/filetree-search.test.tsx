/** @jsxImportSource @opentui/react */
/**
 * Files `/` search: one query lists files matched by name and by text, enter
 * opens the highlighted result, and escape puts the tree back.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileTree } from "../../src/tui-react/panes/filetree/FileTree"
import { act, renderComponent, waitForFrameText } from "./harness"

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "rove-file-search-"))
  execSync("git init -q -b main", { cwd: dir })
  mkdirSync(join(dir, "src"))
  writeFileSync(join(dir, "src", "widget.ts"), "export const a = 1\n")
  writeFileSync(join(dir, "src", "app.ts"), "// renders the Widget list\n")
  writeFileSync(join(dir, "readme.md"), "nothing here\n")
  execSync("git add -A && git -c user.email=t@t -c user.name=t commit -q -m init", { cwd: dir })
  // Untracked but not ignored: still searchable, like the All tab lists it.
  writeFileSync(join(dir, "notes.txt"), "widget ideas\n")
  return dir
}

test("/ finds files by name and by text, and enter opens the highlighted one", async () => {
  const opened: string[] = []
  const h = await renderComponent(
    <FileTree worktreePath={repo()} onOpenFile={(p) => opened.push(p)} focused={true} paneWidth={48} />,
    { width: 48, height: 20 },
  )
  await waitForFrameText(h.frame, "readme.md")

  await act(async () => h.mockInput.typeText("/widget"))
  const frame = await waitForFrameText(h.frame, "≡ src/app.ts")
  expect(frame).toContain("src/widget.ts")
  expect(frame).toContain("≡ notes.txt")
  expect(frame).not.toContain("readme.md")
  // The name match ranks first, so it holds the cursor.
  expect(frame.indexOf("src/widget.ts")).toBeLessThan(frame.indexOf("src/app.ts"))

  act(() => h.mockInput.pressEnter())
  expect(opened).toEqual(["src/widget.ts"])
  await waitForFrameText(h.frame, "readme.md")
})

test("escape closes the search and restores the tree", async () => {
  const h = await renderComponent(
    <FileTree worktreePath={repo()} onOpenFile={() => {}} focused={true} paneWidth={48} />,
    { width: 48, height: 20 },
  )
  await waitForFrameText(h.frame, "readme.md")
  await act(async () => h.mockInput.typeText("/zzz-nothing"))
  await waitForFrameText(h.frame, "no file name or text matches")
  act(() => h.mockInput.pressEscape())
  const frame = await waitForFrameText(h.frame, "readme.md")
  expect(frame).not.toContain("zzz-nothing")
})
