import { existsSync } from "node:fs"
import { basename } from "node:path"
import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { ensurePtyHostReachable } from "@sma1lboy/kobe-daemon/client/pty-process"
import { defaultPtyHostSocketPath } from "@sma1lboy/kobe-daemon/daemon/paths"
import type { PtyOpenResult, PtyPeekResult } from "@sma1lboy/kobe-daemon/daemon/protocol"
import type { PtySessionInfo } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import type { TerminalDefaultColors } from "@sma1lboy/kobe-daemon/daemon/terminal-colors"
import { readPersistedTerminalDefaultColors } from "../tui/lib/terminal-colors.ts"
import { BUILTIN_VENDORS } from "../types/vendor.ts"
import { isComposerEmpty } from "./composer-state.ts"
import { type PsSnapshot, engineProcessIn, parsePsSnapshot, psSnapshot } from "./foreground.ts"
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
 * (issue #19: that dead fallback made delivery silently spawn a duplicate
 * engine). Bare shell tabs (`[shell, "-il"]`) carry no engine word.
 */
export function commandHasEngineWord(command: readonly string[], engineBin: string): boolean {
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
 * That last rung is vendor-AGNOSTIC on purpose (issue #36): `engineBin`
 * comes from the task's recorded vendor, which drifts from what its tabs
 * actually run — a task pinned to the custom preset `claudecpa` (a zsh
 * wrapper) whose live tabs launch plain `claude` resolved to null, and a
 * bare `send` refused with NO_ENGINE_TAB while its engine sat right there.
 * The delivery gate (`engineProcessIn`) has always accepted any live engine
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

/** Typed rejection from the delivery gate (issue #78). Neutral code catches
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
  if (await composerNonEmpty(peek, opts?.screenManifest)) {
    throw new ComposerBusyError("composer-not-empty", key)
  }
}

export async function writeHostedPromptIfClear(
  rpc: HostedSessionRpc,
  key: string,
  prompt: string,
  opts?: HostedPromptDeliveryOpts,
): Promise<void> {
  const peek = await rpc.request<PtyPeekResult>("pty.peek", { key })
  if (!peek.alive) return
  await assertComposerClear(peek, key, opts)
  await writeHostedPrompt(rpc, key, prompt)
}

/** Bracketed-paste the prompt, wait, then submit — the pty twin of `pasteAndSubmit`. */
export async function writeHostedPrompt(rpc: HostedSessionRpc, key: string, prompt: string): Promise<void> {
  await rpc.request("pty.write", { key, data: `\x1b[200~${prompt}\x1b[201~` })
  await new Promise((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS))
  await rpc.request("pty.write", { key, data: "\r" })
}

/**
 * Deliver `prompt` into an existing hosted engine session and submit it.
 * Returns whether the session was alive to receive it.
 *
 * `pty.peek`, NOT `pty.open`: an open from this headless client would
 * last-attach-wins resize a live session out from under the attached TUI
 * (the engine repaints at the delivery client's size and the pane garbles
 * — issue #18), and an open for a key that just died would spawn a bare
 * shell and paste the prompt into it. Peek never attaches, spawns, or
 * resizes — delivery is pure `pty.write`, exactly like keyboard input.
 */
export async function deliverToHostedKey(
  rpc: HostedSessionRpc,
  key: string,
  prompt: string,
  opts?: HostedPromptDeliveryOpts,
): Promise<boolean> {
  const peek = await rpc.request<PtyPeekResult>("pty.peek", { key })
  if (!peek.alive) return false
  await assertComposerClear(peek, key, opts)
  await writeHostedPrompt(rpc, key, prompt)
  return true
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
export const FIRST_MESSAGE_ENGINE_TIMEOUT_MS = 20_000
export const FIRST_MESSAGE_POLL_INTERVAL_MS = 500
/** Post-detection grace so the TUI finishes booting (bracketed-paste mode on). */
export const FIRST_MESSAGE_SETTLE_MS = 1_500

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
 * Deliver a paste-delivery vendor's FIRST message (issue #25): the launch
 * spawned the bare engine (its positional argv slot is a subcommand, not a
 * prompt), so the prompt is bracketed-pasted once the engine process is
 * actually up — the same reason `send` into a cold engine embeds nowhere
 * but waits here instead. Polls the session's process tree until an engine
 * child appears (or the session dies / the wait budget runs out), grants a
 * short settle for the TUI to finish initializing, then pastes + submits.
 * Returns whether the paste happened.
 */
export async function pastePromptWhenEngineUp(
  rpc: HostedSessionRpc,
  key: string,
  engineBin: string | undefined,
  prompt: string,
  opts: PasteFirstMessageOptions = {},
): Promise<boolean> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const snapshot = opts.snapshot ?? psSnapshot

  // If the session was launched with a repo-init script, the engine child does
  // not appear until init finishes. Wait for the init marker before starting
  // the engine-startup budget so a slow `bun install` does not eat the whole
  // paste-delivery window (issue #73).
  if (opts.initMarkerPath) {
    const initDeadline = Date.now() + (opts.initTimeoutMs ?? REPO_INIT_TIMEOUT_SECONDS * 1000)
    while (Date.now() < initDeadline) {
      const { sessions = [] } = await rpc.request<{ sessions?: PtySessionInfo[] }>("pty.list", {})
      const session = sessions.find((s) => s.key === key)
      if (!session?.alive) return false
      if (existsSync(opts.initMarkerPath)) break
      await sleep(opts.intervalMs ?? FIRST_MESSAGE_POLL_INTERVAL_MS)
    }
  }

  const deadline = Date.now() + (opts.timeoutMs ?? FIRST_MESSAGE_ENGINE_TIMEOUT_MS)
  while (Date.now() < deadline) {
    const { sessions = [] } = await rpc.request<{ sessions?: PtySessionInfo[] }>("pty.list", {})
    const session = sessions.find((s) => s.key === key)
    if (!session?.alive) return false
    if (session.pid) {
      let up = false
      try {
        up = engineProcessIn(parsePsSnapshot(await snapshot()), session.pid, engineBin)
      } catch {
        up = false // ps hiccup — treat as "not yet", keep polling
      }
      if (up) {
        await sleep(opts.settleMs ?? FIRST_MESSAGE_SETTLE_MS)
        await writeHostedPromptIfClear(rpc, key, prompt, opts)
        return true
      }
    }
    await sleep(opts.intervalMs ?? FIRST_MESSAGE_POLL_INTERVAL_MS)
  }
  return false
}
