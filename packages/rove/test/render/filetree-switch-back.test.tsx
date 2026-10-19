/** @jsxImportSource @opentui/react */
/**
 * Switching back to a worktree paints its last listing at once; the refetch
 * must still replace it, or a file added while the task was hidden never shows.
 */

import { expect, test } from "bun:test"
import { execFileSync, execSync } from "node:child_process"
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

for (const linked of [false, true]) {
  for (const metadata of ["index", "info/exclude", "core.excludesFile"]) {
    test(`${metadata} changes refresh on switching back to a ${linked ? "linked" : "main"} worktree`, async () => {
      const main = repoWith("anchor.txt")
      const a = linked ? join(main, "linked") : main
      if (linked) execFileSync("git", ["worktree", "add", "-q", "-b", "linked", a], { cwd: main })
      const b = repoWith("bravo.txt")
      const git = (...args: string[]) => execFileSync("git", args, { cwd: a, encoding: "utf8" }).trim()
      writeFileSync(join(a, "visible.txt"), "x\n")
      if (metadata === "index") writeFileSync(join(a, ".gitignore"), "visible.txt\n")
      const excludes = join(main, ".git", "custom-excludes")
      if (metadata === "core.excludesFile") {
        writeFileSync(excludes, "")
        git("config", "core.excludesFile", excludes)
      }
      let show: (path: string) => void = () => {}
      function Host() {
        const [path, setPath] = useState(a)
        show = setPath
        return <FileTree worktreePath={path} onOpenFile={() => {}} focused={true} paneWidth={40} />
      }
      const { frame } = await renderComponent(<Host />, { width: 40, height: 20 })
      async function untilVisible(visible: boolean) {
        for (let i = 0; i < 40; i++) {
          await settle(50)
          const text = await frame()
          if (text.includes("anchor.txt") && text.includes("visible.txt") === visible) return text
        }
        return frame()
      }
      expect((await untilVisible(metadata !== "index")).includes("visible.txt")).toBe(metadata !== "index")
      // Warm the cache after the recursive watcher has settled.
      await settle(1_100)
      act(() => show(b))
      await settle(200)
      act(() => show(a))
      expect((await untilVisible(metadata !== "index")).includes("visible.txt")).toBe(metadata !== "index")
      act(() => show(b))
      await settle(200)
      expect(await frame()).toContain("bravo.txt")
      if (metadata === "index") git("add", "-f", "visible.txt")
      else if (metadata === "info/exclude") writeFileSync(join(main, ".git", "info", "exclude"), "visible.txt\n")
      else writeFileSync(excludes, "visible.txt\n")
      act(() => show(a))
      expect((await untilVisible(metadata === "index")).includes("visible.txt")).toBe(metadata === "index")
    })
  }
}
