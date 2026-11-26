/** @jsxImportSource @opentui/react */
/** The Files pane spends its rows on files: the header is the tabs, with no action chips above them. */

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

async function headerLines(): Promise<string[]> {
  const { frame } = await renderComponent(
    <FocusProvider initial="files">
      <HostFilesPane
        sidebarWidth={24}
        worktree={repoWithFile()}
        prBaseRef={undefined}
        focused={false}
        actions={{ onOpenFile: NOOP, onOpenDiff: NOOP, onMention: NOOP }}
      />
    </FocusProvider>,
    { width: 160, height: 40 },
  )
  // The tree arrives through an async git read — poll for it rather than
  // sleeping, so the header is measured on a settled frame.
  return (await waitForFrameText(frame, "alpha.ts")).split("\n")
}

test("the header opens on the All / Changes tabs, with no action chips", async () => {
  const lines = await headerLines()
  expect(lines.findIndex((line) => line.includes("Changes"))).toBe(1)
})
