/** @jsxImportSource @opentui/react */
/**
 * Render coverage for the files-pane chrome (2026-08-29 redesign): a
 * rounded border whose color follows pane focus — `focusAccent` when the
 * files pane holds the focus, the (now brighter) `borderActive` when it
 * does not. The tree inside is FileTree's own contract (see
 * `host-sidebar-filetree.test.tsx`); here it only proves the pane mounts
 * through its real git read so the border frames actual content.
 */

import { expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CapturedFrame } from "@opentui/core"
import { FocusProvider } from "../../src/tui-react/context/focus"
import { HostFilesPane } from "../../src/tui-react/workspace/host-files-pane"
import { renderComponent, settle } from "./harness"

const NOOP = (): void => {}

function repoWithFile(): string {
  const repo = mkdtempSync(join(tmpdir(), "kobe-files-pane-"))
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", {
    cwd: repo,
  })
  writeFileSync(join(repo, "alpha.ts"), "export {}\n")
  execSync("git add . && git -c user.email=t@t -c user.name=t commit -q -m files", { cwd: repo })
  return repo
}

function mounted(worktree: string, initial: "workspace" | "files") {
  return (
    <FocusProvider initial={initial}>
      <HostFilesPane
        worktree={worktree}
        prBaseRef={undefined}
        focused={false}
        onOpenFile={NOOP}
        onOpenDiff={NOOP}
        onZenToggle={NOOP}
        onCreatePR={NOOP}
      />
    </FocusProvider>
  )
}

/** Distinct fg colors carried by the pane frame's rounded corner glyphs —
 *  the corners are unique to the border (FileTree's guide lines never draw
 *  rounded corners), so they isolate the border color from tree chrome. */
function borderColors(frame: CapturedFrame): Set<string> {
  const colors = new Set<string>()
  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (/[╭╮╯╰]/.test(span.text)) colors.add(String(span.fg))
    }
  }
  return colors
}

async function borderColorsWhenFocused(initial: "workspace" | "files"): Promise<Set<string>> {
  const { spans } = await renderComponent(mounted(repoWithFile(), initial), {
    width: 90,
    height: 20,
  })
  // The tree loads through an async git read — poll until the border frame
  // is fully drawn (content spans present).
  for (let i = 0; i < 40; i++) {
    const frame = await spans()
    const text = frame.lines.map((l) => l.spans.map((s) => s.text).join("")).join("\n")
    if (text.includes("alpha.ts")) return borderColors(frame)
    await settle(100)
  }
  throw new Error("files pane never listed the repo")
}

test("the pane draws a rounded border around the live tree, colored by pane focus", async () => {
  const unfocused = await borderColorsWhenFocused("workspace")
  const focused = await borderColorsWhenFocused("files")
  // Rounded corners are drawn at all.
  expect(unfocused.size).toBeGreaterThan(0)
  // One border color per mount — and focus flips it (borderActive vs
  // focusAccent). The exact hex pairing is screenshot-verified.
  expect(focused.size).toBe(1)
  expect(unfocused.size).toBe(1)
  expect([...focused][0]).not.toBe([...unfocused][0])
})
