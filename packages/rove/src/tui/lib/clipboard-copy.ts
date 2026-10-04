/**
 * Copy-on-select to the system clipboard through BOTH channels: OSC52 (reaches
 * the local machine over SSH, but off in iTerm2 and unsupported in
 * Terminal.app) and the platform command (pbcopy / clip / wl-copy / xclip /
 * xsel). Either can REFUSE (headless Linux with no command,
 * `isOsc52Supported()` false), so the result is reported: a "Copied branch X"
 * toast over a copy that never happened is false feedback.
 */

import { spawn } from "node:child_process"
import { clipboardBinaryOnPath, resolveClipboardCopyCommand } from "../../lib/clipboard-command"

/** The OSC 52 half. opentui's `copyToClipboardOSC52` returns whether the
 *  terminal accepted it; a host with no renderer yields `undefined`. */
export type Osc52Writer = (text: string) => boolean | undefined

/** Resolved once per process — the probe shells out to `which`. */
let resolvedCommand: readonly string[] | null | undefined

function clipboardCommand(): readonly string[] | null {
  if (resolvedCommand === undefined) {
    resolvedCommand = resolveClipboardCopyCommand(process.platform, clipboardBinaryOnPath)
  }
  return resolvedCommand
}

/**
 * Null argv (no command on PATH) is a refusal, not an error. The exit status is
 * the ONLY signal: a missing (127/ENOENT) or refusing command (`xclip` with no
 * `$DISPLAY` passes `which` and exits non-zero) neither throws nor prints.
 */
export function pipeToClipboardCommand(text: string, cmd: readonly string[] | null): Promise<boolean> {
  if (!cmd || cmd.length === 0) return Promise.resolve(false)
  return new Promise((resolve) => {
    try {
      const proc = spawn(cmd[0] as string, cmd.slice(1), { stdio: ["pipe", "ignore", "ignore"] })
      let settled = false
      const done = (ok: boolean): void => {
        if (settled) return
        settled = true
        resolve(ok)
      }
      // ENOENT arrives here, not as an exit code, and a closed stdin raises
      // EPIPE on the write below — neither may reach the caller as a throw.
      proc.on("error", () => done(false))
      proc.stdin.on("error", () => done(false))
      proc.on("close", (code) => done(code === 0))
      proc.stdin.end(text)
    } catch {
      resolve(false)
    }
  })
}

/** True when EITHER channel accepted. Never throws. */
export async function copyTextToSystemClipboard(text: string, osc52: Osc52Writer): Promise<boolean> {
  const piped = await pipeToClipboardCommand(text, clipboardCommand())
  let escaped = false
  try {
    escaped = osc52(text) === true
  } catch {
    /* best-effort */
  }
  return piped || escaped
}
