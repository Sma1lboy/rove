/**
 * PTY Host prompt delivery for `kobe api`. The standalone pty-host owns
 * interactive engine sessions and serves pty.* on its OWN socket (not
 * proxied through the daemon), so this opens a short-lived client to it.
 * The engine key is `<taskId>::tab-1` refined by an argv match on the
 * vendor's launch binary — never a hard-coded vendor name.
 */

import type { PtyOpenResult } from "@sma1lboy/kobe-daemon/daemon/protocol"
import type { PtySessionInfo } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import type { PsSnapshot } from "../../engine/foreground.ts"
import {
  type HostedSessionRpc,
  type PromptWriteOutcome,
  awaitEngineProcess,
  deliverToHostedKey,
  ensureHostedSessionHost,
  findHostedEngineKey,
  hostedSessionFailureLine,
  hostedTaskKeys,
  isHostedTaskKey,
  killHostedSessions,
  listHostedSessions,
  listHostedSessionsOrNull,
  openHostedSessionHost,
  pastePromptWhenEngineUp,
} from "../../engine/hosted-session.ts"
import { enginePresence } from "../../engine/session-engine-presence.ts"
import { type EngineSessionLaunch, initMarkerSaysFinished } from "../../engine/session-launch.ts"
import { readPersistedTerminalDefaultColors } from "../../tui/lib/terminal-colors.ts"
import { restoredTabsOf } from "./tab-respawn.ts"
import { ApiError, type DeliveredPrompt } from "./types.ts"

/** Narrow pty-host RPC surface; `KobeDaemonClient` satisfies it, tests fake it. */
export type PtyHostRpc = HostedSessionRpc

/** A key belongs to `taskId` when its segment before the first `::` matches. */
export const isTaskKey = isHostedTaskKey

/**
 * The ALIVE engine key for `taskId`, or `null` — the single source of truth
 * for delivery and liveness, so "no engine" never falls through to spawning
 * a second one. `engineBin` = `interactiveEngineCommand(vendor)[0]`, or
 * `undefined` when unknown (then only the `tab-1` rule applies).
 */
export const findEngineKey = findHostedEngineKey

/** All alive session keys for `taskId` — every tab, for teardown. */
export const taskKeys = hostedTaskKeys

/** Open a short-lived client without starting the host (read/teardown probes). */
export const openPtyHost = openHostedSessionHost

/** Ensure the standalone host exists, then open a short-lived RPC client. */
export const ensurePtyHost = ensureHostedSessionHost

/** Session inventory from the pty host; `[]` on any RPC hiccup. */
export const listSessions = listHostedSessions
export const listSessionsOrNull = listHostedSessionsOrNull

/** Paste `prompt` into an existing hosted engine session and submit it. */
export const deliverToKey = deliverToHostedKey

/**
 * How long a fresh argv-delivery spawn gets to show an engine process. Short
 * on purpose: the caller is blocked, a failed launch never produces one, and
 * a merely slow engine reports `engineReady: false` with its own output.
 */
export const ENGINE_START_PROBE_MS = 3_000
export const ENGINE_START_POLL_MS = 150
export const ENGINE_NOT_OBSERVED_REASON = `no engine process appeared in the session within ${ENGINE_START_PROBE_MS}ms`

/** Observed write → outcome fields; the one place so every path reports measured facts. */
export function outcomeFields(outcome: PromptWriteOutcome | null): {
  engineReady: boolean
  delivered: boolean
  bytes?: number
  promptEcho?: "confirmed" | "unconfirmed"
} {
  if (!outcome) return { engineReady: false, delivered: false }
  return {
    engineReady: outcome.ready,
    delivered: true,
    bytes: outcome.bytes,
    promptEcho: outcome.confirmed ? "confirmed" : "unconfirmed",
  }
}

/**
 * Deliver to an existing hosted engine tab, or — ONLY when the task has no
 * alive session — create the canonical one with the prompt in its launch
 * argv (no paste racing a cold startup screen). `started: true` means a NEW
 * session was created.
 *
 * Alive tabs with no resolvable engine THROW (NO_ENGINE_TAB): a silent spawn
 * fallback once booted an unsandboxed `--dangerously-skip-permissions`
 * engine at the MAIN repo while both sides believed the message delivered.
 */
export async function deliverHostedPrompt(
  rpc: PtyHostRpc,
  target: { readonly id: string; readonly engineBin?: string },
  cwd: string,
  prompt: string,
  launch: EngineSessionLaunch,
  opts?: {
    readonly forceNew?: boolean
    readonly snapshot?: PsSnapshot
  },
): Promise<DeliveredPrompt> {
  const { sessions = [] } = await rpc.request<{ sessions?: PtySessionInfo[] }>("pty.list", {})
  // `forceNew` (--tab new) must never reroute into the existing engine.
  const existingKey = opts?.forceNew ? null : findEngineKey(sessions, target.id, target.engineBin)
  if (existingKey) {
    // Foreground gate: the engine may have exited into the keepAlive shell,
    // where a paste runs as shell commands. See {@link enginePresence}.
    const pid = sessions.find((s) => s.key === existingKey)?.pid
    const presence = await enginePresence(pid, target.engineBin, opts?.snapshot)
    if (presence.kind === "unknown") {
      // Refuse, but do not claim the engine exited — we never got to look.
      throw new ApiError(
        `could not read the process table, so task ${target.id}'s engine tab (${existingKey}) could not be checked for a live engine`,
        "ENGINE_PROBE_FAILED",
        {
          hint: "the `ps` probe failed or timed out; retry, or check the machine's process table",
          nextCommandArgs: ["api", "pty-list"],
        },
      )
    }
    if (presence.kind !== "engine") {
      throw new ApiError(
        `task ${target.id}'s engine tab (${existingKey}) has no live engine process — its engine exited into a plain shell`,
        "ENGINE_NOT_RUNNING",
        {
          hint: "spawn a fresh engine tab for this prompt with --tab new",
          nextCommandArgs: ["api", "send", "--task-id", target.id, "--tab", "new", "--prompt", prompt],
        },
      )
    }
    // No pty.detach: we never attached, and a detach would clear a parked
    // TUI's exact-delta restore state.
    const outcome = await deliverToKey(rpc, existingKey, prompt, { vendor: presence.vendor })
    return { session: existingKey, pane: existingKey, started: false, ...outcomeFields(outcome) }
  }

  // Spawn only when no session is alive; an unidentified alive tab means a
  // duplicate engine the receiver never sees. Fail loud.
  if (!opts?.forceNew) {
    const aliveTabs = sessions.filter((s) => s.alive && isTaskKey(s.key, target.id)).map((s) => s.key)
    if (aliveTabs.length > 0) {
      throw new ApiError(
        `task ${target.id} has live tabs (${aliveTabs.join(", ")}) but none resolves as its engine tab — refusing to spawn a new engine`,
        "NO_ENGINE_TAB",
        {
          hint: "address a live engine tab explicitly with --tab <tab-N> (see pty-list), or spawn a fresh engine tab with --tab new",
          nextCommandArgs: ["api", "pty-list"],
        },
      )
    }
  }

  // Everything below SPAWNS. Disclose tabs a pty-host restart froze, or this
  // is indistinguishable from a healthy first start. See {@link DeliveredPrompt.frozenTabs}.
  const frozen = restoredTabsOf(sessions, target.id, launch.key)
  const disclose = frozen.length > 0 ? { frozenTabs: frozen } : {}
  const staleCanonical = sessions.find((session) => session.key === launch.key && !session.alive)
  // A FREEZE-RESTORED corpse is respawned in place by `pty.open` (scrollback
  // kept). An ordinary corpse is view-only — open ignores our spec — so kill it.
  if (staleCanonical && staleCanonical.restored !== true) await rpc.request("pty.kill", { key: launch.key })

  // No cols/rows: host defaults to 80×24, and a lost create race must not
  // resize the winner's session.
  const open = await rpc.request<PtyOpenResult>("pty.open", {
    key: launch.key,
    cwd,
    command: launch.command,
    defaultColors: readPersistedTerminalDefaultColors(),
  })
  try {
    if (!open.alive) {
      return {
        session: launch.key,
        pane: launch.key,
        started: open.created !== false || open.respawned === true,
        engineReady: false,
        delivered: false,
        ...disclose,
      }
    }
    // Paste-delivery vendor: first message rides outside argv; a paste that
    // never lands is a failed start.
    if (launch.firstMessage) {
      const outcome = await pastePromptWhenEngineUp(rpc, launch.key, target.engineBin, launch.firstMessage, {
        initMarkerPath: launch.initMarkerPath,
        initTimeoutMs: launch.initTimeoutMs,
      })
      return {
        session: launch.key,
        pane: launch.key,
        started: open.created !== false || open.respawned === true,
        ...outcomeFields(outcome),
        ...disclose,
      }
    }
    // Lost create race: the winner's launch didn't carry our prompt, so paste.
    // A RESPAWNED corpse ran OUR launch; pasting would deliver twice.
    const started = open.created !== false || open.respawned === true
    if (open.created === false && open.respawned !== true) {
      const outcome = await pastePromptWhenEngineUp(rpc, launch.key, target.engineBin, prompt, {
        snapshot: opts?.snapshot,
      })
      return { session: launch.key, pane: launch.key, started, ...outcomeFields(outcome), ...disclose }
    }
    // Our argv carried the prompt; only the engine PROCESS existing confirms
    // it. `open.alive` doesn't: keepAlive execs a shell when the engine exits,
    // so a missing binary still reads `alive`.
    //
    // An init marker with no exit code means the engine hasn't started;
    // `initMarkerSaysFinished` is the launch script's own re-run predicate.
    // Report unconfirmed without waiting through dependency install.
    const pendingInit: DeliveredPrompt = {
      session: launch.key,
      pane: launch.key,
      started,
      engineReady: false,
      delivered: true,
      reason: "repo init script is still running; the engine has not started yet",
      ...disclose,
    }
    if (launch.initMarkerPath && !initMarkerSaysFinished(launch.initMarkerPath)) return pendingInit
    const enginePid = await awaitEngineProcess(rpc, launch.key, target.engineBin, {
      timeoutMs: ENGINE_START_PROBE_MS,
      intervalMs: ENGINE_START_POLL_MS,
      snapshot: opts?.snapshot,
    })
    if (enginePid === null) {
      // Init may restart mid-probe and finish during the list await: re-check after it.
      if (
        launch.initMarkerPath &&
        !initMarkerSaysFinished(launch.initMarkerPath) &&
        (await listSessions(rpc)).some((session) => session.key === launch.key && session.alive) &&
        !initMarkerSaysFinished(launch.initMarkerPath)
      ) {
        return pendingInit
      }
      return {
        session: launch.key,
        pane: launch.key,
        started,
        engineReady: false,
        delivered: false,
        reason: (await hostedSessionFailureLine(rpc, launch.key)) ?? ENGINE_NOT_OBSERVED_REASON,
        ...disclose,
      }
    }
    return {
      session: launch.key,
      pane: launch.key,
      started,
      engineReady: true,
      delivered: true,
      ...disclose,
    }
  } finally {
    await rpc.request("pty.detach", { key: launch.key }).catch(() => {})
  }
}

/** Kill every hosted session for a task (its engine + any tabs). */
export const killTaskSessions = killHostedSessions
