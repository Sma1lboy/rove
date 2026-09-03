import { existsSync } from "node:fs"
import { basename } from "node:path"
import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { ensurePtyHostReachable } from "@sma1lboy/kobe-daemon/client/pty-process"
import { defaultPtyHostSocketPath } from "@sma1lboy/kobe-daemon/daemon/paths"
import type { PtyOpenResult, PtyPeekResult } from "@sma1lboy/kobe-daemon/daemon/protocol"
import type { PtySessionInfo } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import type { TerminalDefaultColors } from "@sma1lboy/kobe-daemon/daemon/terminal-colors"
import { composerGateEnabled } from "../state/composer-gate.ts"
import { readPersistedTerminalDefaultColors } from "../tui/lib/terminal-colors.ts"
import { BUILTIN_VENDORS } from "../types/vendor.ts"
import { isComposerEmpty } from "./composer-state.ts"
import { type PsSnapshot, engineProcessIn, parsePsSnapshot, psSnapshot } from "./foreground.ts"
import { PASTE_READY_POLL_MS, PASTE_READY_TIMEOUT_MS, bracketedPasteActive, encodePaste } from "./paste-readiness.ts"
import { engineEntry } from "./registry.ts"
import type { EngineScreenManifest } from "./screen-state.ts"
import { type EngineSessionLaunch, REPO_INIT_TIMEOUT_SECONDS } from "./session-launch.ts"

export interface HostedSessionRpc {
  request<T = unknown>(name: string, payload?: unknown): Promise<T>
}

export interface HostedSessionClient {
  readonly rpc: HostedSessionRpc
  close(): void
}

async function connectHostedSessionClient(socketPath: string): Promise<HostedSessionClient> {
  const client = new KobeDaemonClient(socketPath)
  try {
    await client.connect()
  } catch (error) {
    client.close()
    throw error
  }
  return { rpc: client, close: () => client.close() }
}

/** Non-mutating probe used by liveness and teardown paths. */
export async function openHostedSessionHost(): Promise<HostedSessionClient | null> {
  try {
    return await connectHostedSessionClient(defaultPtyHostSocketPath())
  } catch {
    return null
  }
}

/** Start the host when necessary, then connect a short-lived client. */
export async function ensureHostedSessionHost(): Promise<HostedSessionClient> {
  return connectHostedSessionClient(await ensurePtyHostReachable())
}

export async function listHostedSessions(rpc: HostedSessionRpc): Promise<PtySessionInfo[]> {
  try {
    const { sessions } = await rpc.request<{ sessions: PtySessionInfo[] }>("pty.list", {})
    return sessions ?? []
  } catch {
    return []
  }
}

export function isHostedTaskKey(key: string, taskId: string): boolean {
  return (key.split("::")[0] ?? key) === taskId
}

export function hostedTaskKeys(sessions: readonly PtySessionInfo[], taskId: string): string[] {
  return sessions.filter((session) => isHostedTaskKey(session.key, taskId)).map((session) => session.key)
}

export async function killHostedSessions(rpc: HostedSessionRpc, keys: readonly string[]): Promise<void> {
  for (const key of keys) await rpc.request("pty.kill", { key }).catch(() => {})
}

/**
 * True when a session's spawn argv contains `engineBin` as a standalone
 * word. Hosted engine tabs launch via `<shell> -ilc '…<engineBin> …'`
 * (`buildEngineSessionLaunch`), so `command[0]` is ALWAYS the shell — an
 * argv[0] comparison against the engine binary never matches in production
 * (a dead fallback there makes delivery silently spawn a duplicate
 * engine). Bare shell tabs (`[shell, "-il"]`) carry no engine word.
 */
function commandHasEngineWord(command: readonly string[], engineBin: string): boolean {
  for (const part of command) {
    for (const token of part.split(/\s+/)) {
      const bare = token.replace(/^['"]+|['"]+$/g, "")
      if (bare && basename(bare) === engineBin) return true
    }
  }
  return false
}

/** Every launch binary a REGISTERED built-in engine may show as — the
 *  vendor-agnostic half of engine identity, same pair the foreground walk
 *  matches (`defaultCommand[0]` plus post-launch renames like `kimi-co`). */
function builtinEngineBins(): string[] {
  return BUILTIN_VENDORS.flatMap((vendor) => {
    const entry = engineEntry(vendor)
    return [entry.defaultCommand[0], ...(entry.processNames ?? [])]
  }).filter((bin): bin is string => Boolean(bin))
}

/** Trailing `tab-<n>` as a number, `Infinity` for a non-numeric tab id. */
function tabOrder(key: string): number {
  const n = Number(/tab-(\d+)$/.exec(key)?.[1])
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
}

/**
 * Pick the ALIVE engine session key for `taskId`, or `null` when none.
 * Preference order: the deterministic `<taskId>::tab-1` engine tab, then the
 * lowest-numbered alive tab whose launch argv names `engineBin`, then the
 * lowest-numbered alive tab running ANY registered engine. Bare shell tabs
 * never match — they must never receive a prompt.
 *
 * That last rung is vendor-AGNOSTIC on purpose: `engineBin` comes from the
 * task's recorded vendor, which drifts from what its tabs actually run — a
 * task pinned to the custom preset `claudecpa` (a zsh wrapper) whose live
 * tabs launch plain `claude` would resolve to null, and a bare `send` would
 * refuse with NO_ENGINE_TAB while its engine sat right there.
 * The delivery gate (`engineProcessIn`) accepts any live engine
 * and `--tab tab-N` has always allowed cross-vendor send; this makes the
 * resolver agree with both. Safety is unchanged: the caller still re-checks
 * the pick against a live `ps` walk before writing a single byte.
 */
export function findHostedEngineKey(
  sessions: readonly PtySessionInfo[],
  taskId: string,
  engineBin?: string,
): string | null {
  const mine = sessions
    .filter((s) => s.alive && isHostedTaskKey(s.key, taskId))
    .sort((a, b) => tabOrder(a.key) - tabOrder(b.key))
  const tab1 = mine.find((s) => s.key === `${taskId}::tab-1`)
  if (tab1) return tab1.key
  if (engineBin) {
    const byCommand = mine.find((s) => commandHasEngineWord(s.command, engineBin))
    if (byCommand) return byCommand.key
  }
  const bins = builtinEngineBins()
  return mine.find((s) => bins.some((bin) => commandHasEngineWord(s.command, bin)))?.key ?? null
}

/** Delay between bracketed paste and submit CR so the engine reads two tty events. */
const SUBMIT_DELAY_MS = 150

/** Typed rejection from the delivery gate. Neutral code catches
 *  this and surfaces a `COMPOSER_BUSY` ApiError to the user/agent. */
export class ComposerBusyError extends Error {
  constructor(
    readonly layer: "recent-human-write" | "composer-not-empty",
    readonly key: string,
  ) {
    super(`composer busy on ${key}: ${layer}`)
  }
}

/** Options for gated prompt delivery. */
export interface HostedPromptDeliveryOpts {
  /** Engine-owned composer-empty manifest. Absence skips the C-layer gate. */
  readonly screenManifest?: EngineScreenManifest
  /** Override for the A-layer quiet period (ms). Defaults to the host's
   *  reported `humanWriteQuietMs` or 10s when the host omits it. */
  readonly humanWriteQuietMs?: number
  /** Test seam for `Date.now()`. */
  readonly now?: () => number
  /** Override for the paste-readiness wait (ms). Tests shorten it. */
  readonly pasteReadyTimeoutMs?: number
  /**
   * Run the screen-based composer check. Defaults to the persisted setting
   * (`state/composer-gate.ts`, on unless the user turned it off); an explicit
   * value is the test seam, so a suite never depends on the machine's
   * state.json.
   */
  readonly composerGate?: boolean
}

function recentHumanWriteBlocks(peek: PtyPeekResult, opts: HostedPromptDeliveryOpts, now: number): boolean {
  if (peek.lastHumanWriteMs === undefined || peek.lastHumanWriteMs <= 0) return false
  const quiet = opts.humanWriteQuietMs ?? peek.humanWriteQuietMs ?? 10_000
  return now - peek.lastHumanWriteMs < quiet
}

async function composerNonEmpty(peek: PtyPeekResult, manifest: EngineScreenManifest | undefined): Promise<boolean> {
  if (!manifest?.composerEmpty || manifest.composerEmpty.length === 0) return false
  const bytes = Buffer.from(peek.data, "base64")
  const empty = await isComposerEmpty(bytes, manifest)
  return empty === false
}

async function assertComposerClear(peek: PtyPeekResult, key: string, opts?: HostedPromptDeliveryOpts): Promise<void> {
  const now = opts?.now?.() ?? Date.now()
  if (recentHumanWriteBlocks(peek, opts ?? {}, now)) {
    throw new ComposerBusyError("recent-human-write", key)
  }
  // The A layer above measures TIME and cannot be disabled: someone typing
  // right now is protected whatever this setting says. Only the screen read
  // below is switchable, because only it depends on a vendor's current
  // layout — see state/composer-gate.ts. Read per delivery, so flipping the
  // switch takes effect without a restart.
  if (!(opts?.composerGate ?? composerGateEnabled())) return
  if (await composerNonEmpty(peek, opts?.screenManifest)) {
    throw new ComposerBusyError("composer-not-empty", key)
  }
}

/**
 * What one prompt write actually did. `delivered` is the honest answer to
 * "did this reach the engine", and it is now OBSERVED rather than assumed:
 * every field below is measured, not defaulted to true.
 */
export interface PromptWriteOutcome {
  /** Bytes handed to the pty (prompt plus any bracketed-paste wrapper). */
  readonly bytes: number
  /** The engine had bracketed paste on, i.e. it was reading its tty. */
  readonly ready: boolean
  /** The engine echoed the prompt's tail back — the only positive proof it
   *  landed. `false` means unconfirmed, NOT necessarily lost. */
  readonly confirmed: boolean
}

/** Trailing slice of the prompt used as the echo marker. Long enough not to
 *  collide with ordinary UI chrome, short enough to survive the composer's
 *  own wrapping and truncation. */
const CONFIRM_TAIL_CHARS = 24

/** Poll budget for the echo check — the composer redraw follows the write
 *  within a frame or two; this is slack, not a wait we expect to use. */
const CONFIRM_TIMEOUT_MS = 2_000
const CONFIRM_POLL_MS = 100

/** Collapse whitespace so a tail that the composer soft-wrapped across two
 *  rows still matches the single-line prompt text it came from. */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ")
}

/**
 * Look for the prompt's tail in everything the engine emitted since
 * `sinceOffset`. Confirms delivery the way the `delivered` contract always
 * claimed to — by capture, not by assumption.
 *
 * KNOWN CEILING, and the reason `confirmed: false` is reported rather than
 * treated as failure: an engine may not echo the text at all. Claude Code
 * collapses a large paste to a `[Pasted text #1]` placeholder, so a big
 * prompt that arrived perfectly still fails this check. That makes a
 * positive a proof and a negative merely inconclusive — which is exactly how
 * the caller reports it.
 */
async function confirmPromptLanded(
  rpc: HostedSessionRpc,
  key: string,
  prompt: string,
  sinceOffset: number,
): Promise<boolean> {
  const tail = flatten(prompt).trim().slice(-CONFIRM_TAIL_CHARS)
  if (tail.length === 0) return false
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS
  for (;;) {
    const peek = await rpc.request<PtyPeekResult>("pty.peek", { key, sinceOffset })
    if (!peek.alive) return false
    if (flatten(Buffer.from(peek.data, "base64").toString("utf8")).includes(tail)) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS))
  }
}

/** Wait for readiness, write, then check the echo — the whole delivery in
 *  one place so every caller reports the same observed facts. */
async function writeAndConfirm(
  rpc: HostedSessionRpc,
  key: string,
  prompt: string,
  sinceOffset: number,
  opts?: HostedPromptDeliveryOpts,
): Promise<PromptWriteOutcome> {
  const ready = await awaitPasteReady(rpc, key, { timeoutMs: opts?.pasteReadyTimeoutMs })
  const bytes = await writeHostedPrompt(rpc, key, prompt, { ready })
  const confirmed = await confirmPromptLanded(rpc, key, prompt, sinceOffset)
  return { bytes, ready, confirmed }
}

export async function writeHostedPromptIfClear(
  rpc: HostedSessionRpc,
  key: string,
  prompt: string,
  opts?: HostedPromptDeliveryOpts,
): Promise<PromptWriteOutcome | null> {
  const peek = await rpc.request<PtyPeekResult>("pty.peek", { key })
  if (!peek.alive) return null
  await assertComposerClear(peek, key, opts)
  return writeAndConfirm(rpc, key, prompt, peek.offset, opts)
}

/**
 * Wait until the engine has taken its pty into raw mode and started reading,
 * reported by DECSET 2004 in the ring (see `paste-readiness.ts`). Returns
 * whether bracketed paste is on — which is BOTH the readiness verdict and
 * the wrapping decision. `false` means the wait timed out: the caller still
 * delivers (best effort beats refusing), but sends the prompt bare, exactly
 * as the interactive backend does for an app that never asked for 2004.
 */
export async function awaitPasteReady(
  rpc: HostedSessionRpc,
  key: string,
  opts: { readonly timeoutMs?: number; readonly sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline = Date.now() + (opts.timeoutMs ?? PASTE_READY_TIMEOUT_MS)
  for (;;) {
    const peek = await rpc.request<PtyPeekResult>("pty.peek", { key })
    if (!peek.alive) return false
    if (bracketedPasteActive(Buffer.from(peek.data, "base64").toString("latin1"))) return true
    if (Date.now() >= deadline) return false
    await sleep(PASTE_READY_POLL_MS)
  }
}

/**
 * Paste the prompt, wait, then submit — the pty twin of `pasteAndSubmit`.
 *
 * Waits for the engine to be READING before writing a single byte. Skipping
 * that wait is what silently truncated 8.6KB prompts to their first 1024
 * bytes: a pty in canonical mode discards past `MAX_INPUT` instead of
 * blocking, and `pty.write` returns void, so nothing downstream could tell.
 *
 * Returns the bytes written, so callers can report what they actually did
 * rather than assuming. Note this counts bytes HANDED TO the pty; whether
 * the engine's composer shows them is a separate question that
 * {@link confirmPromptLanded} answers.
 */
export async function writeHostedPrompt(
  rpc: HostedSessionRpc,
  key: string,
  prompt: string,
  opts?: { readonly ready?: boolean },
): Promise<number> {
  const bracketed = opts?.ready ?? (await awaitPasteReady(rpc, key))
  const data = encodePaste(prompt, bracketed)
  await rpc.request("pty.write", { key, data })
  await new Promise((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS))
  await rpc.request("pty.write", { key, data: "\r" })
  return Buffer.byteLength(data, "utf8")
}

/**
 * Deliver `prompt` into an existing hosted engine session and submit it.
 * Returns whether the session was alive to receive it.
 *
 * `pty.peek`, NOT `pty.open`: an open from this headless client would
 * last-attach-wins resize a live session out from under the attached TUI
 * (the engine repaints at the delivery client's size and the pane garbles),
 * and an open for a key that just died would spawn a bare shell and paste
 * the prompt into it. Peek never attaches, spawns, or
 * resizes — delivery is pure `pty.write`, exactly like keyboard input.
 */
export async function deliverToHostedKey(
  rpc: HostedSessionRpc,
  key: string,
  prompt: string,
  opts?: HostedPromptDeliveryOpts,
): Promise<PromptWriteOutcome | null> {
  const peek = await rpc.request<PtyPeekResult>("pty.peek", { key })
  if (!peek.alive) return null
  await assertComposerClear(peek, key, opts)
  return writeAndConfirm(rpc, key, prompt, peek.offset, opts)
}

/** Open or reattach one engine session and immediately release this client.
 *  No cols/rows: a size-less open never resizes a live session away from
 *  its attached TUI (the host only sizes the spawn, defaulting 80×24). */
export async function ensureHostedEngine(
  rpc: HostedSessionRpc,
  cwd: string,
  launch: EngineSessionLaunch,
  defaultColors: TerminalDefaultColors = readPersistedTerminalDefaultColors(),
): Promise<PtyOpenResult> {
  const result = await rpc.request<PtyOpenResult>("pty.open", {
    key: launch.key,
    cwd,
    command: launch.command,
    defaultColors,
  })
  await rpc.request("pty.detach", { key: launch.key }).catch(() => {})
  return result
}

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
   *  window from expiring while dependencies are still installing. */
  readonly initMarkerPath?: string
  /** How long to wait for {@link initMarkerPath} to appear (ms). */
  readonly initTimeoutMs?: number
}

/**
 * Deliver a paste-delivery vendor's FIRST message: the launch
 * spawned the bare engine (its positional argv slot is a subcommand, not a
 * prompt), so the prompt is bracketed-pasted once the engine process is
 * actually up — the same reason `send` into a cold engine embeds nowhere
 * but waits here instead. Polls the session's process tree until an engine
 * child appears (or the session dies / the wait budget runs out), grants a
 * waits for it to start READING, then pastes + submits.
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
  const snapshot = opts.snapshot ?? psSnapshot

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
      if (existsSync(opts.initMarkerPath)) break
      await sleep(opts.intervalMs ?? FIRST_MESSAGE_POLL_INTERVAL_MS)
    }
  }

  const deadline = Date.now() + (opts.timeoutMs ?? FIRST_MESSAGE_ENGINE_TIMEOUT_MS)
  while (Date.now() < deadline) {
    const { sessions = [] } = await rpc.request<{ sessions?: PtySessionInfo[] }>("pty.list", {})
    const session = sessions.find((s) => s.key === key)
    if (!session?.alive) return null
    if (session.pid) {
      let up = false
      try {
        up = engineProcessIn(parsePsSnapshot(await snapshot()), session.pid, engineBin)
      } catch {
        up = false // ps hiccup — treat as "not yet", keep polling
      }
      if (up) {
        // The engine process exists; now wait for it to actually be READING
        // (see `awaitPasteReady`). Only when it never announces bracketed
        // paste do we fall back to a blind settle.
        if (!(await awaitPasteReady(rpc, key, { timeoutMs: opts.pasteReadyTimeoutMs, sleep }))) {
          await sleep(opts.settleMs ?? FIRST_MESSAGE_SETTLE_MS)
        }
        return await writeHostedPromptIfClear(rpc, key, prompt, opts)
      }
    }
    await sleep(opts.intervalMs ?? FIRST_MESSAGE_POLL_INTERVAL_MS)
  }
  return null
}
