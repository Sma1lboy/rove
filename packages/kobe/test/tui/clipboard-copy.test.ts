/**
 * The local clipboard pipe against REAL processes: the point of the change is
 * that a command which is missing or fails is reported as a failure, and
 * `Bun.spawn` signals both only through the exit status. Nothing here touches
 * the operator's clipboard — `cat > file` stands in for `pbcopy` on the
 * identical spawn path.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "vitest"
import { pipeToClipboardCommand } from "../../src/tui/lib/clipboard-copy"

const dir = mkdtempSync(join(tmpdir(), "rove-clipboard-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe("pipeToClipboardCommand", () => {
  test("a command that accepts the text reports success, and gets all of it", async () => {
    const out = join(dir, "sink.txt")
    const text = "feat/some-branch\nwith a second line"
    // Single-quoted and forward-slashed: unquoted, `sh` eats the backslashes
    // of a Windows path and `cat` lands `C:Users…sink.txt` in the cwd.
    const shellPath = out.replaceAll("\\", "/")
    expect(await pipeToClipboardCommand(text, ["sh", "-c", `cat > '${shellPath}'`])).toBe(true)
    expect(readFileSync(out, "utf8")).toBe(text)
  })

  test("a command that is not installed reports failure instead of throwing", async () => {
    expect(await pipeToClipboardCommand("x", ["rove-no-such-clipboard-binary"])).toBe(false)
  })

  test("a shell that cannot find the binary exits 127 — the headless-Linux case", async () => {
    expect(await pipeToClipboardCommand("x", ["sh", "-c", "rove-no-such-clipboard-binary"])).toBe(false)
  })

  test("a command that runs and fails reports failure — the xclip-without-DISPLAY case", async () => {
    expect(await pipeToClipboardCommand("x", ["sh", "-c", "exit 3"])).toBe(false)
  })

  test("no clipboard command on this platform is a refusal, not a throw", async () => {
    expect(await pipeToClipboardCommand("x", null)).toBe(false)
  })
})
