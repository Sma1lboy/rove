/**
 * Pure-helper tests for system-clipboard command resolution.
 */

import { describe, expect, test } from "vitest"
import { resolveClipboardCopyCommand } from "../../src/lib/clipboard-command"

const none = () => false
const all = () => true

describe("resolveClipboardCopyCommand", () => {
  test("darwin → pbcopy, and null when even pbcopy is not on PATH", () => {
    expect(resolveClipboardCopyCommand("darwin", all)).toEqual(["pbcopy"])
    // Probed like every other platform: an honest "no clipboard command" beats
    // spawning one that exits non-zero where the caller now reads the status.
    expect(resolveClipboardCopyCommand("darwin", none)).toBeNull()
  })

  test("linux with wl-copy available → wl-copy (Wayland preferred)", () => {
    expect(resolveClipboardCopyCommand("linux", all)).toEqual(["wl-copy"])
  })

  test("linux with only xclip → xclip clipboard command", () => {
    const onlyXclip = (bin: string) => bin === "xclip"
    expect(resolveClipboardCopyCommand("linux", onlyXclip)).toEqual(["xclip", "-selection", "clipboard", "-in"])
  })

  test("linux with only xsel → xsel clipboard command", () => {
    const onlyXsel = (bin: string) => bin === "xsel"
    expect(resolveClipboardCopyCommand("linux", onlyXsel)).toEqual(["xsel", "--clipboard", "--input"])
  })

  test("linux preference order: wl-copy beats xclip beats xsel", () => {
    const noWayland = (bin: string) => bin === "xclip" || bin === "xsel"
    expect(resolveClipboardCopyCommand("linux", noWayland)).toEqual(["xclip", "-selection", "clipboard", "-in"])
  })

  test("linux with no clipboard tool → null", () => {
    expect(resolveClipboardCopyCommand("linux", none)).toBeNull()
  })

  test("win32 resolves clip.exe — Windows is supported and OSC 52 is not its only hope", () => {
    expect(resolveClipboardCopyCommand("win32", all)).toEqual(["clip"])
    const onlyPowershell = (bin: string) => bin === "powershell"
    expect(resolveClipboardCopyCommand("win32", onlyPowershell)).toEqual([
      "powershell",
      "-NoProfile",
      "-Command",
      "Set-Clipboard",
    ])
    expect(resolveClipboardCopyCommand("win32", none)).toBeNull()
  })

  test("unknown platform → null", () => {
    expect(resolveClipboardCopyCommand("freebsd", all)).toBeNull()
  })
})
