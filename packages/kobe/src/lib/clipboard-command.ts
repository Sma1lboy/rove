/** System-clipboard command resolution, kept outside render-path modules. */

import { spawnSync } from "node:child_process"

export type ClipboardProbe = (binary: string) => boolean

/** Argv, not a shell string: Windows has no `sh` to hand a command line to. */
const CLIPBOARD_CANDIDATES: Readonly<Record<string, readonly (readonly string[])[]>> = {
  darwin: [["pbcopy"]],
  linux: [["wl-copy"], ["xclip", "-selection", "clipboard", "-in"], ["xsel", "--clipboard", "--input"]],
  // Windows is a supported platform, and without this its only clipboard
  // channel is OSC 52 — which the terminals shipping on Windows may refuse.
  // `clip` has been in every Windows since XP; PowerShell's `Set-Clipboard`
  // is the fallback for a stripped image.
  win32: [["clip"], ["powershell", "-NoProfile", "-Command", "Set-Clipboard"]],
}

/**
 * The argv that pipes stdin into this platform's clipboard, or null when the
 * platform has none on PATH. `pbcopy` is probed like everything else: a macOS
 * without it should say "no clipboard" rather than spawn a command that fails
 * where nobody reads the exit code.
 */
export function resolveClipboardCopyCommand(
  platform: NodeJS.Platform | string,
  hasCommand: ClipboardProbe,
): readonly string[] | null {
  for (const candidate of CLIPBOARD_CANDIDATES[platform] ?? []) {
    if (hasCommand(candidate[0] as string)) return candidate
  }
  return null
}

export const clipboardBinaryOnPath: ClipboardProbe = (binary) => {
  try {
    const command = process.platform === "win32" ? "where" : "which"
    return spawnSync(command, [binary], { encoding: "utf8" }).status === 0
  } catch {
    return false
  }
}
