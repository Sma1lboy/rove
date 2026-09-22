/**
 * Is the ENGINE inside a hosted session ready — and if not, why.
 * `hosted-session.ts` answers questions about the session; the session can't
 * answer this about itself, since keepAlive leaves a dead engine's session
 * alive in a fallback shell. Only the process table separates them.
 */

import type { PtyPeekResult } from "@sma1lboy/kobe-daemon/daemon/protocol"
import type { PtySessionInfo } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import { terminalRows } from "@sma1lboy/kobe-daemon/daemon/terminal-rows"
import type { VendorId } from "../types/vendor.ts"
import type { PsSnapshot } from "./foreground.ts"
import {
  type HostedPromptDeliveryOpts,
  type HostedSessionRpc,
  type PromptWriteOutcome,
  awaitPasteReady,
  writeHostedPromptIfLive,
} from "./hosted-session.ts"
import { enginePresence } from "./session-engine-presence.ts"
import { ENGINE_EXIT_BANNER, REPO_INIT_TIMEOUT_SECONDS, initMarkerSaysFinished } from "./session-launch.ts"

/** Bounds for the first-message readiness wait (paste-delivery vendors). */
const FIRST_MESSAGE_ENGINE_TIMEOUT_MS = 20_000
const FIRST_MESSAGE_POLL_INTERVAL_MS = 500
/**
 * Blind grace, only for an engine that never announces bracketed paste;
 * `awaitPasteReady` is the real gate. A forked process hasn't necessarily
 * called `stty raw`, and writes before then are cut at the 1024-byte
 * canonical buffer — kimi announces at ~1953ms (measured), after this fires.
 */
const FIRST_MESSAGE_SETTLE_MS = 1_500

export interface PasteFirstMessageOptions extends HostedPromptDeliveryOpts {
  readonly timeoutMs?: number
  readonly intervalMs?: number
  readonly settleMs?: number
  /** Test seam for the process-table read (see `pty-delivery.ts`'s gate). */
  readonly snapshot?: PsSnapshot
  readonly sleep?: (ms: number) => Promise<void>
  /** With a repo-init script, wait for this marker before starting the
   *  engine-startup budget. Written when init FINISHES, whatever the outcome,
   *  so "init failed" doesn't read as "still running". */
  readonly initMarkerPath?: string
  /** How long to wait for {@link initMarkerPath} to appear (ms). */
  readonly initTimeoutMs?: number
}

/**
 * Wait until the ENGINE process appears inside a hosted session's tree.
 * Session liveness is the login shell's: `pty.open` reports `alive` for
 * `engineCommand: /nonexistent/binary` just as for a healthy launch, so
 * anything reporting spawn success (e.g. an unwatched routine) must look here.
 *
 * Returns the session pid and live vendor, or `null` when the session died or
 * the budget ran out.
 */
export async function awaitEngineProcess(
  rpc: HostedSessionRpc,
  key: string,
  engineBin: string | undefined,
  opts: PasteFirstMessageOptions = {},
): Promise<{ readonly pid: number; readonly vendor: VendorId | null } | null> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  // Undefined uses the process probe's default.
  const snapshot = opts.snapshot

  // The engine child appears only after repo init; a slow `bun install` must
  // not eat the engine-startup budget.
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
    // Same predicate as the delivery gates; a ps hiccup reads as "not yet".
    if (session.pid) {
      const presence = await enginePresence(session.pid, engineBin, snapshot)
      if (presence.kind === "engine") return { pid: session.pid, vendor: presence.vendor }
    }
    await sleep(opts.intervalMs ?? FIRST_MESSAGE_POLL_INTERVAL_MS)
  }
  return null
}

/**
 * The line explaining why a hosted session has no engine: preferably the
 * `Engine exited (code N)` banner {@link keepAlive} prints, since by then the
 * literal last line is the fallback shell's prompt.
 */
export async function hostedSessionFailureLine(
  rpc: HostedSessionRpc,
  key: string,
  limit = 200,
): Promise<string | undefined> {
  try {
    const peek = await rpc.request<PtyPeekResult>("pty.peek", { key })
    const lines = terminalRows(Buffer.from(peek.data, "base64").toString("utf8"))
      .map((row) => row.trim())
      .filter((row) => row.length > 0)
    const line = lines.findLast((row) => ENGINE_EXIT_BANNER.test(row)) ?? lines.at(-1)
    return line === undefined ? undefined : line.slice(0, limit)
  } catch {
    return undefined
  }
}

/**
 * Deliver a paste-delivery vendor's FIRST message (its positional argv slot
 * is a subcommand, not a prompt): wait for the engine child, wait for it to
 * start READING, then paste + submit. `null` when the write never happened.
 */
export async function pastePromptWhenEngineUp(
  rpc: HostedSessionRpc,
  key: string,
  engineBin: string | undefined,
  prompt: string,
  opts: PasteFirstMessageOptions = {},
): Promise<PromptWriteOutcome | null> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const engine = await awaitEngineProcess(rpc, key, engineBin, opts)
  if (engine !== null) {
    // Blind settle only when bracketed paste is never announced.
    if (!(await awaitPasteReady(rpc, key, { timeoutMs: opts.pasteReadyTimeoutMs, sleep }))) {
      await sleep(opts.settleMs ?? FIRST_MESSAGE_SETTLE_MS)
    }
    return await writeHostedPromptIfLive(rpc, key, prompt, { ...opts, vendor: engine.vendor })
  }
  return null
}
