import { basename } from "node:path"
import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { ensurePtyHostReachable } from "@sma1lboy/kobe-daemon/client/pty-process"
import { defaultPtyHostSocketPath } from "@sma1lboy/kobe-daemon/daemon/paths"
import type { PtyOpenResult, PtyPeekResult } from "@sma1lboy/kobe-daemon/daemon/protocol"
import type { PtySessionInfo } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import type { TerminalDefaultColors } from "@sma1lboy/kobe-daemon/daemon/terminal-colors"
import { readPersistedTerminalDefaultColors } from "../tui/lib/terminal-colors.ts"
import { BUILTIN_VENDORS, type VendorId } from "../types/vendor.ts"
import { withDeliveryLock } from "./delivery-lock.ts"
import { PASTE_READY_POLL_MS, PASTE_READY_TIMEOUT_MS, bracketedPasteActive, encodePaste } from "./paste-readiness.ts"
import { engineEntry } from "./registry.ts"
import type { EngineSessionLaunch } from "./session-launch.ts"

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

/**
 * `pty.list` as a tri-state: `null` = the host could not be asked (gone,
 * wedged, any RPC failure), `[]` = it answered and holds nothing.
 *
 * Liveness reads need the difference: connecting to a stopped host succeeds
 * (the kernel accepts into the listen backlog) and only the request times
 * out, so an open socket is no evidence the host answers. Collapsing them
 * renders running engines as a stopped task.
 */
export async function listHostedSessionsOrNull(rpc: HostedSessionRpc): Promise<PtySessionInfo[] | null> {
  try {
    const { sessions } = await rpc.request<{ sessions: PtySessionInfo[] }>("pty.list", {})
    return sessions ?? []
  } catch {
    return null
  }
}

/** {@link listHostedSessionsOrNull} collapsed for callers that ACT on the inventory; readers must use the tri-state version. */
export async function listHostedSessions(rpc: HostedSessionRpc): Promise<PtySessionInfo[]> {
  return (await listHostedSessionsOrNull(rpc)) ?? []
}

export function isHostedTaskKey(key: string, taskId: string): boolean {
  return (key.split("::")[0] ?? key) === taskId
}

export function hostedTaskKeys(sessions: readonly PtySessionInfo[], taskId: string): string[] {
  return sessions.filter((session) => isHostedTaskKey(session.key, taskId)).map((session) => session.key)
}

export interface KillHostedSessionsOpts {
  /**
   * Reply only once the child has ended (bounded by the host's SIGTERM →
   * SIGKILL grace). Needed before unlinking the session's cwd: Windows
   * refuses to delete a directory a live process holds as cwd.
   */
  readonly wait?: boolean
}

export async function killHostedSessions(
  rpc: HostedSessionRpc,
  keys: readonly string[],
  opts?: KillHostedSessionsOpts,
): Promise<void> {
  const payload = opts?.wait === true ? { wait: true } : {}
  // Concurrent, so a waited teardown costs one grace (≤1s), not one per tab;
  // every request is issued in key order whatever any one answers.
  await Promise.all(keys.map((key) => rpc.request("pty.kill", { key, ...payload }).catch(() => {})))
}

/**
 * True when a session's spawn argv contains `engineBin` as a standalone word.
 * Engine tabs launch via `<shell> -ilc '…<engineBin> …'`, so `command[0]` is
 * always the shell and an argv[0] match never fires. Bare shell tabs
 * (`[shell, "-il"]`) carry no engine word.
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

/** Every launch binary a built-in engine may show as: `defaultCommand[0]` plus
 *  post-launch renames like `kimi-co` — the same pair the foreground walk matches. */
function builtinEngineBins(): string[] {
  return BUILTIN_VENDORS.flatMap((vendor) => {
    const entry = engineEntry(vendor)
    return [entry.defaultCommand[0], ...(entry.processNames ?? [])]
  }).filter((bin): bin is string => Boolean(bin))
}

/**
 * Does this session's launch argv name an engine — the ONE argv judgement.
 * {@link findHostedEngineKey} (which tab `send` targets) and
 * `hasLiveEngineTab` (whether the task reports `running`) must agree, or an
 * unattended loop cleans up live work.
 *
 * `engineBin` is the task's own launch binary — the only way a custom engine
 * (a wrapper script no vendor table names) is recognised.
 */
export function sessionArgvNamesEngine(command: readonly string[] | undefined, engineBin?: string): boolean {
  if (!command || command.length === 0) return false
  if (engineBin && commandHasEngineWord(command, engineBin)) return true
  return builtinEngineBins().some((bin) => commandHasEngineWord(command, bin))
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
 * The last rung is vendor-agnostic on purpose: the recorded vendor drifts
 * from what tabs run (a `claudecpa` wrapper preset whose tabs launch plain
 * `claude` would otherwise refuse with NO_ENGINE_TAB). It matches the
 * delivery gate (`engineProcessIn`) and cross-vendor `--tab tab-N`; the
 * caller still re-checks the pick against a live `ps` walk before writing.
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
  return mine.find((s) => sessionArgvNamesEngine(s.command))?.key ?? null
}

/** Delay between bracketed paste and submit CR so the engine reads two tty events. */
const SUBMIT_DELAY_MS = 150

/** Options for prompt delivery. */
export interface HostedPromptDeliveryOpts {
  readonly vendor?: VendorId | null
  /** Override for the paste-readiness wait (ms). Tests shorten it. */
  readonly pasteReadyTimeoutMs?: number
}

/** What one prompt write did; every field is observed, never defaulted to true. */
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
 * `sinceOffset`.
 *
 * KNOWN CEILING: an engine may not echo the text at all — Claude Code
 * collapses a large paste to `[Pasted text #1]` — so a positive is proof and
 * a negative merely inconclusive, never a failure.
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
  const { bytes } = await writeHostedPrompt(rpc, key, prompt, { ready, vendor: opts?.vendor })
  const confirmed = await confirmPromptLanded(rpc, key, prompt, sinceOffset)
  return { bytes, ready, confirmed }
}

export async function writeHostedPromptIfLive(
  rpc: HostedSessionRpc,
  key: string,
  prompt: string,
  opts?: HostedPromptDeliveryOpts,
): Promise<PromptWriteOutcome | null> {
  const peek = await rpc.request<PtyPeekResult>("pty.peek", { key })
  if (!peek.alive) return null
  return writeAndConfirm(rpc, key, prompt, peek.offset, opts)
}

/**
 * Wait until the engine is reading its pty, signalled by DECSET 2004 in the
 * ring. The result is both the readiness verdict and the wrapping decision:
 * `false` (timed out) means the caller still delivers, but bare — as the
 * interactive backend does for an app that never asked for 2004.
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
 * Paste the prompt, wait, then submit it with Enter — the pty twin of
 * `pasteAndSubmit`.
 *
 * Waits for the engine to be READING first: a pty in canonical mode discards
 * past `MAX_INPUT` instead of blocking (an 8.6KB prompt truncated to 1024
 * bytes), and `pty.write` returns void, so nothing downstream could tell.
 *
 * The adapter's preparatory keys run outside the paste wrapper, right before
 * Enter, to finish input processing in engines that buffer a paste burst;
 * the submit key is never chosen from a footer redraw.
 *
 * Returns bytes handed to the pty; whether the composer shows them is
 * {@link confirmPromptLanded}'s question.
 */
export async function writeHostedPrompt(
  rpc: HostedSessionRpc,
  key: string,
  prompt: string,
  opts?: { readonly ready?: boolean; readonly vendor?: VendorId | null },
): Promise<{ readonly bytes: number }> {
  const bracketed = opts?.ready ?? (await awaitPasteReady(rpc, key))
  const capabilities = opts?.vendor ? engineEntry(opts.vendor).capabilities : undefined
  const prepared = capabilities?.preparePromptSubmission?.(prompt)
  const data = encodePaste(prepared ?? prompt, bracketed)
  // Paste + submit are one act; two `rove api send`s to one tab would
  // otherwise interleave halves (see `delivery-lock.ts`). The lock spans only
  // the writes — holding it through the echo poll would serialize a fan-out.
  await withDeliveryLock(key, async () => {
    await rpc.request("pty.write", { key, data })
    await new Promise((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS))
    await rpc.request("pty.write", { key, data: `${capabilities?.beforePromptSubmit ?? ""}\r` })
  })
  return { bytes: Buffer.byteLength(data, "utf8") }
}

/**
 * Deliver `prompt` into an existing hosted engine session and submit it.
 * Returns whether the session was alive to receive it.
 *
 * `pty.peek`, NOT `pty.open`: an open would last-attach-wins resize the live
 * session under the attached TUI (the pane garbles), and for a just-died key
 * would spawn a bare shell and paste into it. Peek never attaches, spawns,
 * or resizes.
 */
export const deliverToHostedKey = writeHostedPromptIfLive

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

// Re-exported because callers reach these through a hosted session and
// several tests mock this module as a whole.
/** @public — knip sees the re-export, not the importers of `PasteFirstMessageOptions`. */
export {
  awaitEngineProcess,
  hostedSessionFailureLine,
  type PasteFirstMessageOptions,
  pastePromptWhenEngineUp,
} from "./hosted-session-readiness.ts"
