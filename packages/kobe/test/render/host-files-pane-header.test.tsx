/** @jsxImportSource @opentui/react */
/**
 * The Files pane's header row — both halves of the owner's 2026-09-02
 * screenshot.
 *
 * 1. The Zen and Create-PR chips ALWAYS wrap: `[~] Zen` + `[^ A P] Ask agent
 *    to create PR` is 40 cells against the pane's 22-34 cell width clamp
 *    (`host-files-pane.tsx`). Yoga's `gap` sets both gutters, so the wrap the
 *    row is designed around also opened a two-row hole between the chips and
 *    the header ate five rows of a pane whose whole job is listing files.
 *
 * 2. A `kind:"main"` row is the repo's root checkout (`branch: ""`,
 *    `worktreePath === repo`) — there is no task branch, and `createPRAction`
 *    can only answer with its already-on-the-target-branch toast — so the
 *    chip must not be offered there.
 *
 * `HostFilesPane` decides (2) from `taskKind` rather than being handed a
 * pre-resolved callback, so this mount tests the RULE and not a hand-set
 * outcome. The host's job shrinks to forwarding `selectedTask?.kind`, which
 * the prop's type pins. Mounting the whole `WorkspaceRoot` would cover that
 * last hop too, but a host mount with a live task starts a daemon client, git
 * reads and fs watchers that outlive the test — and the render track runs in
 * ONE bun process, where that surfaced as timeouts in unrelated timing tests.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FocusProvider } from "../../src/tui-react/context/focus"
import { HostFilesPane } from "../../src/tui-react/workspace/host-files-pane"
import type { Task } from "../../src/types/task"
import { renderComponent, waitForFrameText } from "./harness"

const NOOP = (): void => {}

function repoWithFile(): string {
  const repo = mkdtempSync(join(tmpdir(), "kobe-files-header-"))
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
async function headerLines(taskKind: Task["kind"]): Promise<string[]> {
  const { frame } = await renderComponent(
    <FocusProvider initial="files">
      <HostFilesPane
        worktree={repoWithFile()}
        prBaseRef={undefined}
        focused={false}
        onOpenFile={NOOP}
        onOpenDiff={NOOP}
        onMention={NOOP}
        onZenToggle={NOOP}
        onCreatePR={NOOP}
        taskKind={taskKind}
      />
    </FocusProvider>,
    { width: 160, height: 40 },
  )
  // The tree arrives through an async git read — poll for it rather than
  // sleeping, so the header is measured on a settled frame.
  return (await waitForFrameText(frame, "alpha.ts")).split("\n")
}

test("a worktree task's chips wrap onto ADJACENT rows, not across a two-row hole", async () => {
  const lines = await headerLines("task")
  const zen = lines.findIndex((line) => line.includes("Zen"))
  const pr = lines.findIndex((line) => line.includes("Ask agent to create PR"))
  expect(zen).toBeGreaterThanOrEqual(0)
  expect(pr).toBeGreaterThanOrEqual(0)
  // The whole defect in one number: `gap={2}` put the chips three rows apart.
  expect(pr - zen).toBe(1)
})

test("a project-main row offers no Create-PR chip — it has no branch to PR", async () => {
  const text = (await headerLines("main")).join("\n")
  // Zen still applies to any task, so its absence would mean the header
  // vanished rather than the one chip being withheld.
  expect(text).toContain("Zen")
  expect(text).not.toContain("Ask agent to create PR")
})

test("a directory task keeps the chip — Rove does not own that checkout's branch", async () => {
  expect((await headerLines("dir")).join("\n")).toContain("Ask agent to create PR")
})
