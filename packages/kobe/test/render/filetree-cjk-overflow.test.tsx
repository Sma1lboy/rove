/** @jsxImportSource @opentui/react */
/**
 * A Changes row must not draw past the file pane's right edge — measured on
 * the real frame, in cells, with a real Chinese path.
 *
 * Rove defaults to Simplified Chinese, so a CJK path is the ordinary case,
 * not an exotic one. The row's budget (`computePathBudget`) has always been
 * in CELLS, but it used to be SPENT by a code-point counter: a 26-cell budget
 * "fitted" `文档/设计/终端渲染说明书笔记.md` at 18 code points and drew its 31
 * cells, five of them through the border and onto the workspace pane, taking
 * the `+N`/`−N` stat columns with it.
 *
 * Asserting the truncated STRING would not catch that — the string is the
 * same either way until you ask what it costs. So the assertion is on the
 * grid: every rendered line stays inside the pane's width. An ASCII path is
 * green with the bug present, which is exactly why it can't be the test.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { displayWidth } from "../../src/lib/display-width"
import { FileTree } from "../../src/tui-react/panes/filetree/FileTree"
import { act, renderComponent, settle } from "./harness"

/** The file pane at its widest; `computePathBudget` leaves 26 cells here. */
const PANE_WIDTH = 34

function repoWith(path: string): string {
  const repo = mkdtempSync(join(tmpdir(), "kobe-cjk-"))
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", { cwd: repo })
  const file = join(repo, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, "hello\n")
  execSync("git add -A && git -c user.email=t@t -c user.name=t commit -q -m add", { cwd: repo })
  // Modify it so the row lands on the Changes tab with real +N/−N stats.
  writeFileSync(file, "hello\nworld\nagain\n")
  return repo
}

async function changesFrame(repo: string, marker: string): Promise<string> {
  const { frame, mockInput } = await renderComponent(
    <FileTree worktreePath={repo} onOpenFile={() => {}} focused={true} paneWidth={PANE_WIDTH} />,
    { width: PANE_WIDTH, height: 20 },
  )
  act(() => mockInput.pressKey("]")) // → Changes tab
  let text = ""
  for (let i = 0; i < 40 && !text.includes(marker); i++) {
    await settle(100)
    text = await frame()
  }
  return text
}

test("a CJK Changes row stays inside the pane's cell width", async () => {
  const path = "文档/设计/终端渲染说明书笔记.md"
  // The trap in one line: fewer code points than the budget, more cells.
  expect([...path].length).toBeLessThan(26)
  expect(displayWidth(path)).toBeGreaterThan(26)

  const text = await changesFrame(repoWith(path), ".md")
  expect(text).toContain(".md") // the row rendered at all
  // Real CJK glyphs, not git's octal escaping: `git status --porcelain`
  // emits `"\346\226\207…"` by default and `unquoteGitPath` decodes it —
  // so this also pins that the wide-glyph path really reaches the renderer.
  expect(text).toContain("笔记.md")
  for (const line of text.split("\n")) {
    expect(displayWidth(line.replace(/\s+$/, ""))).toBeLessThanOrEqual(PANE_WIDTH)
  }
})

test("the All tab shows a CJK filename, not git's octal escaping", async () => {
  // Sibling of the row above, one code path over: the Changes tab decoded
  // `"\346\226\207…"` through `unquoteGitPath`, the All tab did not — so a
  // Chinese filename rendered as escape gibberish no width budget can save.
  const repo = repoWith("文档/设计/终端渲染说明书笔记.md")
  const { frame } = await renderComponent(
    <FileTree worktreePath={repo} onOpenFile={() => {}} focused={true} paneWidth={PANE_WIDTH} />,
    { width: PANE_WIDTH, height: 20 },
  )
  let text = ""
  for (let i = 0; i < 40 && !text.includes("文档"); i++) {
    await settle(100)
    text = await frame()
  }
  expect(text).toContain("文档")
  expect(text).not.toContain("\\346")
  for (const line of text.split("\n")) {
    expect(displayWidth(line.replace(/\s+$/, ""))).toBeLessThanOrEqual(PANE_WIDTH)
  }
})

test("an ASCII path of the same length is unchanged", async () => {
  // The desktop-layout guard: 1 cell per glyph spends what it always did.
  const text = await changesFrame(repoWith("docs/design/terminal-notes.md"), "terminal-notes")
  expect(text).toContain("terminal-notes.md")
  for (const line of text.split("\n")) {
    expect(displayWidth(line.replace(/\s+$/, ""))).toBeLessThanOrEqual(PANE_WIDTH)
  }
})
