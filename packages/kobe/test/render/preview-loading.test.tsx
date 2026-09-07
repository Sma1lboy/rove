/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useState } from "react"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { PreviewScreen } from "../../src/tui-react/ops/preview"
import { renderComponent, settle, waitForFrameText } from "./harness"

function SwitchingPreview({ worktree }: { worktree: string }) {
  const [path, setPath] = useState<string | null>("first.txt")
  useBindings(() => ({
    bindings: [
      { key: "n", cmd: () => setPath("slow.txt") },
      { key: "m", cmd: () => setPath("second.txt") },
    ],
  }))
  return path === null ? (
    <text>preview closed</text>
  ) : (
    <PreviewScreen worktree={worktree} relPath={path} onClose={() => setPath(null)} />
  )
}

for (const action of ["switch", "close"] as const) {
  test(`a pending real file read cannot keep old content or publish after ${action}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "rove-preview-loading-"))
    writeFileSync(join(dir, "first.txt"), "FIRST FILE\n")
    writeFileSync(join(dir, "second.txt"), "SECOND FILE\n")
    // FIFO holds the filesystem read open until the test supplies its bytes.
    execFileSync("mkfifo", [join(dir, "slow.txt")])
    const handle = await renderComponent(<SwitchingPreview worktree={dir} />, {
      width: 90,
      height: 14,
      providers: { dialog: true, notifications: true },
    })
    await waitForFrameText(handle.frame, "FIRST FILE")
    handle.mockInput.typeText("n")
    await waitForFrameText(handle.frame, "slow.txt")
    const loading = await handle.frame()
    // Release even on a failed assertion, so the old implementation cannot hang the runner.
    const release = writeFile(join(dir, "slow.txt"), "LATE CONTENT\n")
    expect(loading).not.toContain("FIRST FILE")
    expect(loading).toContain("loading")
    handle.mockInput.typeText(action === "switch" ? "m" : "q")
    const expected = action === "switch" ? "SECOND FILE" : "preview closed"
    await waitForFrameText(handle.frame, expected)
    await release
    await settle(120)
    expect(await handle.frame()).toContain(expected)
    expect(await handle.frame()).not.toContain("LATE CONTENT")
  })
}

test("a failed read has retry and a valid empty file has its own state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rove-preview-errors-"))
  const handle = await renderComponent(<PreviewScreen worktree={dir} relPath="empty.txt" />, {
    width: 100,
    height: 14,
    providers: { dialog: true, notifications: true },
  })
  await waitForFrameText(handle.frame, "Cannot read empty.txt")
  expect(await handle.frame()).toContain("r to retry")
  writeFileSync(join(dir, "empty.txt"), "")
  handle.mockInput.typeText("r")
  await waitForFrameText(handle.frame, "empty file")
  expect(await handle.frame()).not.toContain("Cannot read")
})

test("hunkless previews state the change and cannot anchor a review note", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rove-preview-notes-"))
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir })
  git("init", "-q")
  writeFileSync(join(dir, "old.txt"), "unchanged\n")
  writeFileSync(join(dir, "empty-deleted.txt"), "")
  writeFileSync(join(dir, "binary.bin"), Buffer.from("before\0bytes"))
  git("add", ".")
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture")
  git("mv", "old.txt", "new.txt")
  git("rm", "empty-deleted.txt")
  writeFileSync(join(dir, "binary.bin"), Buffer.from("after\0bytes"))
  const added: unknown[] = []
  for (const [path, label] of [
    ["new.txt", "renamed from old.txt"],
    ["empty-deleted.txt", "empty file deleted"],
    ["binary.bin", "binary file changed"],
    [".", "renamed from old.txt"],
  ]) {
    const handle = await renderComponent(
      <PreviewScreen
        worktree={dir}
        relPath={path ?? "."}
        review={{ comments: [], add: (note) => added.push(note), remove: () => {}, send: () => false }}
      />,
      { width: 100, height: 22, providers: { dialog: true, notifications: true } },
    )
    await waitForFrameText(handle.frame, label ?? "")
    handle.mockInput.typeText("c")
    await settle(80)
    expect(await handle.frame()).not.toContain("Review note")
    expect(added).toEqual([])
    handle.destroy()
  }
})
