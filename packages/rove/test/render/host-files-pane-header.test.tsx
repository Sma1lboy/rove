/** @jsxImportSource @opentui/react */
/**
 * The Files pane's header row. The Zen and Create-PR chips ALWAYS wrap:
 * `[~] Zen` + `[^ A P] Ask agent to create PR` is 40 cells against the pane's
 * 22-34 cell width clamp (`host-files-pane.tsx`). Yoga's `gap` sets both
 * gutters, so the wrap the row is designed around also opened a two-row hole
 * between the chips and the header ate five rows of a pane whose whole job is
 * listing files.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FocusProvider } from "../../src/tui-react/context/focus"
import { HostFilesPane } from "../../src/tui-react/workspace/host-files-pane"
import { renderComponent, waitForFrameText } from "./harness"

const NOOP = (): void => {}

function repoWithFile(): string {
  const repo = mkdtempSync(join(tmpdir(), "rove-files-header-"))
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", {
    cwd: repo,
  })
  writeFileSync(join(repo, "alpha.ts"), "export {}\n")
  execSync("git add . && git -c user.email=t@t -c user.name=t commit -q -m files", { cwd: repo })
  return repo
}

/** Rendered lines at the real harness grid (1280×800 → 160×40 cells): the
 *  pane's width clamp is what makes the chips wrap, so a narrow mount would
 *  not lay out the row under test. */
async function headerLines(): Promise<string[]> {
  const { frame } = await renderComponent(
    <FocusProvider initial="files">
      <HostFilesPane
        sidebarWidth={24}
        worktree={repoWithFile()}
        prBaseRef={undefined}
        focused={false}
        actions={{ onOpenFile: NOOP, onOpenDiff: NOOP, onMention: NOOP, onZenToggle: NOOP, onCreatePR: NOOP }}
      />
    </FocusProvider>,
    { width: 160, height: 40 },
  )
  // The tree arrives through an async git read — poll for it rather than
  // sleeping, so the header is measured on a settled frame.
  return (await waitForFrameText(frame, "alpha.ts")).split("\n")
}

test("a worktree task's chips wrap onto ADJACENT rows, not across a two-row hole", async () => {
  const lines = await headerLines()
  const zen = lines.findIndex((line) => line.includes("Zen"))
  const pr = lines.findIndex((line) => line.includes("Ask agent to create PR"))
  expect(zen).toBeGreaterThanOrEqual(0)
  expect(pr).toBeGreaterThanOrEqual(0)
  // The whole defect in one number: `gap={2}` put the chips three rows apart.
  expect(pr - zen).toBe(1)
})
