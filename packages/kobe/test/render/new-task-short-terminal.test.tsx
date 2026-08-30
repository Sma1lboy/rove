/** @jsxImportSource @opentui/react */
/**
 * On a 24-row terminal the new-task dialog must still show its Create button
 * and its error line.
 *
 * `Dialog` caps the card at the viewport and nothing scrolls it — a card
 * taller than the cap is simply clipped. With a fixed 8-row picker window the
 * Existing tab was ~26 rows against a cap of 20, so the bottom six went away:
 * the Create button, and `submitError` with it. The keyboard path still
 * worked (Enter on the last field), so a failed create rendered its message
 * into rows that did not exist and read as nothing happening at all.
 *
 * The measurement has to be the real frame at a real height — the pure
 * `pickerVisibleRows` test cannot see whether the component calls it.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NewTaskDialogView } from "../../src/tui-react/component/new-task-dialog/dialog"
import { act, renderComponent, settle } from "./harness"

/** A repo with more branches than any window will show. */
function repoWithBranches(count: number): string {
  const repo = mkdtempSync(join(tmpdir(), "kobe-shortterm-"))
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", { cwd: repo })
  for (let i = 0; i < count; i++) execSync(`git branch feature/branch-name-${i}`, { cwd: repo })
  return repo
}

/** Mount at `height`, tab to the branch field and clear its filter so the
 *  picker opens at full length — the tallest the Existing tab ever gets. */
async function withBranchPickerOpen(repo: string, height: number): Promise<string> {
  const { frame, mockInput } = await renderComponent(
    <NewTaskDialogView defaultRepo={repo} savedRepos={[]} onSubmit={() => {}} onCancel={() => {}} />,
    { width: 100, height, providers: { kv: true, dialog: true } },
  )
  for (let i = 0; i < 3; i++) {
    act(() => mockInput.pressTab())
    await settle()
  }
  for (let i = 0; i < 8; i++) {
    act(() => mockInput.pressBackspace())
    await settle()
  }
  return await frame()
}

test("24 rows: the Create button survives a full branch picker", async () => {
  const text = await withBranchPickerOpen(repoWithBranches(20), 24)
  expect(text).toContain("Create")
  // The picker is still there and still says how much it is hiding.
  expect(text).toContain("more")
  // Both field labels survive too — they were the first rows to merge away.
  expect(text).toContain("repo")
  expect(text).toContain("from branch")
})

test("a tall terminal is unchanged — the full 8-row window still renders", async () => {
  const text = await withBranchPickerOpen(repoWithBranches(20), 40)
  expect(text).toContain("Create")
  const shown = text.split("\n").filter((l) => l.includes("feature/branch-name-")).length
  expect(shown).toBeGreaterThanOrEqual(7)
})
