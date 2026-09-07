/**
 * System-clipboard delivery for the embedded terminal's copy-on-select —
 * OSC52 alone is not enough:
 * several terminals ship with it disabled (iTerm2) or unsupported
 * (Terminal.app), so the selection is ALSO piped into the platform
 * clipboard command when one exists (pbcopy / clip / wl-copy / xclip / xsel).
 * Both channels fire — the local pipe covers strict terminals, OSC52
 * covers SSH/remote sessions where the local pipe lands on the wrong
 * machine's clipboard.
 *
 * Both channels can REFUSE, and the caller has to be able to see it: a
 * headless Linux box with no `wl-copy`/`xclip`/`xsel` has no local pipe at
 * all, and `isOsc52Supported()` says no on the terminals named above. A
 * "Copied branch X" toast printed over that pair is feedback for an event
 * that did not happen, so the result is reported rather than discarded.
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
 * Whether `cmd` took the text. Null argv (no clipboard command on this
 * platform's PATH) is a refusal, not an error.
 *
 * The exit status is the ONLY place a clipboard failure shows up: a spawn
 * neither throws nor writes anywhere the pane can see when the command is
 * missing (127 / ENOENT) or refuses (`xclip` on a box with no `$DISPLAY`
 * passes the `which` probe, spawns fine, and exits non-zero). Discarding it
 * is what let "Copied branch X" print over a clipboard nothing reached.
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

/**
 * Copy through both channels; resolves true when EITHER accepted the text.
 * Never throws.
 */
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
