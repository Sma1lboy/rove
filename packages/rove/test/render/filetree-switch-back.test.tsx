/** @jsxImportSource @opentui/react */
/**
 * Switching back to a worktree paints its last listing at once; the refetch
 * must still replace it, or a file added while the task was hidden never shows.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useState } from "react"
import { FileTree } from "../../src/tui-react/panes/filetree/FileTree"
import { act, renderComponent, settle } from "./harness"

function repoWith(file: string): string {
  const repo = mkdtempSync(join(tmpdir(), "rove-switch-"))
  execSync("git init -q -b main", { cwd: repo })
  writeFileSync(join(repo, file), "x\n")
  execSync("git add -A && git -c user.email=t@t -c user.name=t commit -q -m init", { cwd: repo })
  return repo
}

test("a file added while the worktree was hidden shows after switching back", async () => {
  const a = repoWith("alpha.txt")
  const b = repoWith("bravo.txt")
  let show: (path: string) => void = () => {}
  function Host() {
    const [path, setPath] = useState(a)
    show = setPath
    return <FileTree worktreePath={path} onOpenFile={() => {}} focused={true} paneWidth={40} />
  }
  const { frame } = await renderComponent(<Host />, { width: 40, height: 20 })
  const until = async (marker: string): Promise<string> => {
    let text = ""
    for (let i = 0; i < 40 && !text.includes(marker); i++) {
      await settle(50)
      text = await frame()
    }
    return text
  }

  expect(await until("alpha.txt")).toContain("alpha.txt")
  act(() => show(b))
  expect(await until("bravo.txt")).toContain("bravo.txt")

  writeFileSync(join(a, "added.txt"), "y\n")
  act(() => show(a))
  expect(await until("added.txt")).toContain("added.txt")
})
