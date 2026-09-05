/**
 * Is the engine READY — and if it never became ready, why.
 *
 * The seam against `hosted-session.ts`: that module owns a session's
 * lifecycle and the writes into it, and every function there answers a
 * question about the SESSION. These answer a question about the ENGINE inside
 * it, which the session cannot answer about itself: keepAlive leaves a session
 * whose engine exited sitting in a fallback shell, so `pty.open` reports
 * `alive` identically for a healthy launch and for a launch command pointing
 * at nothing. Only the process table separates them, and both delivery shapes
 * — paste-delivery vendors before they type, argv-delivery vendors before
 * they claim a spawn succeeded — have to look.
 */

import type { PtyPeekResult } from "@sma1lboy/kobe-daemon/daemon/protocol"
import type { PtySessionInfo } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import type { PsSnapshot } from "./foreground.ts"
import {
  type HostedPromptDeliveryOpts,
  type HostedSessionRpc,
  type PromptWriteOutcome,
  awaitPasteReady,
  writeHostedPromptIfClear,
} from "./hosted-session.ts"
import { sessionHasEngine } from "./session-engine-presence.ts"
import { ENGINE_EXIT_BANNER, REPO_INIT_TIMEOUT_SECONDS, initMarkerSaysFinished } from "./session-launch.ts"

/** Bounds for the first-message readiness wait (paste-delivery vendors). */
const FIRST_MESSAGE_ENGINE_TIMEOUT_MS = 20_000
const FIRST_MESSAGE_POLL_INTERVAL_MS = 500
/**
 * Post-detection grace, kept ONLY as the fallback for an engine that never
 * announces bracketed paste. The readiness wait (`awaitPasteReady`) is the
 * real gate now: this sleep was the whole bug. It guessed that 1.5s after
 * the engine PROCESS appears the engine is reading its tty — but a process
 * that has forked is not a process that has called `stty raw`, and a write
 * into that window is discarded past the tty's 1024-byte canonical buffer.
 * Measured: kimi announces bracketed paste at ~1953ms, i.e. AFTER this
 * timer fired, which is why kimi was the vendor that lost 8.6KB prompts.
 */
const FIRST_MESSAGE_SETTLE_MS = 1_500

export interface PasteFirstMessageOptions extends HostedPromptDeliveryOpts {
  readonly timeoutMs?: number
  readonly intervalMs?: number
  readonly settleMs?: number
  /** Test seam for the process-table read (see `pty-delivery.ts`'s gate). */
  readonly snapshot?: PsSnapshot
  readonly sleep?: (ms: number) => Promise<void>
  /** When the launch includes a repo-init script, wait for this marker file
   *  before budgeting the engine-startup wait. Prevents a short paste-delivery
   *  window from expiring while dependencies are still installing. The launch
   *  script writes it when init FINISHES, whatever the outcome — a
   *  success-only marker made "init failed" indistinguishable from "init is
   *  still running", and the loop below then sat out the whole budget. */
  readonly initMarkerPath?: string
  /** How long to wait for {@link initMarkerPath} to appear (ms). */
  readonly initTimeoutMs?: number
}

/**
 * Wait until the ENGINE process appears inside a hosted session's tree.
 *
 * The session's own liveness is the LOGIN SHELL's, not the engine's: keepAlive
 * leaves a session whose engine exited sitting in a fallback shell, so
 * `pty.open` reports `alive` for `engineCommand: /nonexistent/binary` exactly
 * as it does for a healthy launch. The process table is the only thing that
 * separates "the engine is running" from "the shell printed `command not
 * found` and stayed". Anything that reports success for a spawn — and a
 * scheduled routine has nobody watching to catch it out — has to look here.
 *
 * Returns the session's pid once the engine is in its tree, or `null` when the
 * session died or the budget ran out.
 */
export async function awaitEngineProcess(
  rpc: HostedSessionRpc,
  key: string,
  engineBin: string | undefined,
  opts: PasteFirstMessageOptions = {},
): Promise<number | null> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  // Undefined falls through to `sessionHasEngine`'s own default.
  const snapshot = opts.snapshot

  // If the session was launched with a repo-init script, the engine child does
  // not appear until init finishes. Wait for the init marker before starting
  // the engine-startup budget so a slow `bun install` does not eat the whole
  // paste-delivery window.
  if (opts.initMarkerPath) {
    const initDeadline = Date.now() + (opts.initTimeoutMs ?? REPO_INIT_TIMEOUT_SECONDS * 1000)
    while (Date.now() < initDeadline) {
      const { sessions = [] } = await rpc.request<{ sessions?: PtySessionInfo[] }>("pty.list", {})
      const session = sessions.find((s) => s.key === key)
      if (!session?.alive) return null
      if (initMarkerSaysFinished(opts.initMarkerPath)) break
      await sleep(opts.intervalMs ?? FIRST_MESSAGE_POLL_INTERVAL_MS)
    }
  }

  const deadline = Date.now() + (opts.timeoutMs ?? FIRST_MESSAGE_ENGINE_TIMEOUT_MS)
  while (Date.now() < deadline) {
    const { sessions = [] } = await rpc.request<{ sessions?: PtySessionInfo[] }>("pty.list", {})
    const session = sessions.find((s) => s.key === key)
    if (!session?.alive) return null
    // Same predicate the delivery gates use, in a loop: one implementation of
    // "is the engine actually there", and a ps hiccup reads as "not yet" and
    // keeps polling.
    if (session.pid && (await sessionHasEngine(session.pid, engineBin, snapshot))) return session.pid
    await sleep(opts.intervalMs ?? FIRST_MESSAGE_POLL_INTERVAL_MS)
  }
  return null
}

/**
 * The line that explains why a hosted session has no engine in it.
 *
 * A caller outside the PTY can see that the engine never appeared but not why.
 * The session itself printed the answer: the shell's own `command not found`,
 * and above all the `Engine exited (code N)` banner that {@link keepAlive}
 * prints before dropping into the fallback shell. That banner is preferred
 * over the literal last line, which by then is the fallback shell's PROMPT —
 * true, and useless to whoever has to fix the launch command.
 */
export async function hostedSessionFailureLine(
  rpc: HostedSessionRpc,
  key: string,
  limit = 200,
): Promise<string | undefined> {
  try {
    const peek = await rpc.request<PtyPeekResult>("pty.peek", { key })
    const lines = stripAnsi(Buffer.from(peek.data, "base64").toString("utf8"))
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter((row) => row.length > 0)
    const line = lines.findLast((row) => ENGINE_EXIT_BANNER.test(row)) ?? lines.at(-1)
    return line === undefined ? undefined : line.slice(0, limit)
  } catch {
    return undefined
  }
}

/** Enough of a stripper to make a PTY ring readable as text: OSC strings (which
 *  run to BEL or ST) and CSI/two-byte escapes. Not a terminal emulator — the
 *  caller wants one line for a run record, not a rendered screen. */
function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reading a raw PTY ring is the point
  return text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
}

/**
 * Deliver a paste-delivery vendor's FIRST message: the launch
 * spawned the bare engine (its positional argv slot is a subcommand, not a
 * prompt), so the prompt is bracketed-pasted once the engine process is
 * actually up — the same reason `send` into a cold engine embeds nowhere
 * but waits here instead. Waits for the engine child to appear (or the
 * session to die / the budget to run out), waits for it to start READING,
 * then pastes + submits.
 * Returns what the write observed, or `null` when it never happened.
 */
export async function pastePromptWhenEngineUp(
  rpc: HostedSessionRpc,
  key: string,
  engineBin: string | undefined,
  prompt: string,
  opts: PasteFirstMessageOptions = {},
): Promise<PromptWriteOutcome | null> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  if ((await awaitEngineProcess(rpc, key, engineBin, opts)) !== null) {
    // The engine process exists; now wait for it to actually be READING
    // (see `awaitPasteReady`). Only when it never announces bracketed
    // paste do we fall back to a blind settle.
    if (!(await awaitPasteReady(rpc, key, { timeoutMs: opts.pasteReadyTimeoutMs, sleep }))) {
      await sleep(opts.settleMs ?? FIRST_MESSAGE_SETTLE_MS)
    }
    return await writeHostedPromptIfClear(rpc, key, prompt, opts)
  }
  return null
}
