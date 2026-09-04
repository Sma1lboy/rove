/**
 * PTY Host prompt delivery for `kobe api`. The standalone `kobe pty-host`
 * process is the only owner of interactive engine sessions; API automation
 * reuses the canonical engine key or creates it from the shared launch spec.
 *
 * pty.* frames are served by the pty-host on its OWN socket (NOT proxied
 * through the daemon — see `kobe-daemon/daemon/pty-server.ts`), so this
 * module opens its own short-lived client to `defaultPtyHostSocketPath()`,
 * exactly like the `pty-list` verb does. Nothing here is engine-specific:
 * the engine key is found by the DETERMINISTIC `<taskId>::tab-1` the TUI
 * always assigns its first (engine) tab, refined by an argv match against
 * the vendor's own launch binary — never a hard-coded "claude"/"codex".
 */

import { existsSync } from "node:fs"
import type { PtyOpenResult } from "@sma1lboy/kobe-daemon/daemon/protocol"
import type { PtySessionInfo } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import type { PsSnapshot } from "../../engine/foreground.ts"
import {
  ComposerBusyError,
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
  writeHostedPrompt,
  writeHostedPromptIfClear,
} from "../../engine/hosted-session.ts"
import { engineEntry } from "../../engine/registry.ts"
import type { EngineScreenManifest } from "../../engine/screen-state.ts"
import { sessionHasEngine } from "../../engine/session-engine-presence.ts"
import type { EngineSessionLaunch } from "../../engine/session-launch.ts"
import { readPersistedTerminalDefaultColors } from "../../tui/lib/terminal-colors.ts"
import type { VendorId } from "../../types/vendor.ts"
import { restoredTabsOf } from "./tab-respawn.ts"
import { ApiError, type DeliveredPrompt, type PromptDeferralSink } from "./types.ts"

// `sessionHasEngine` is the foreground gate for delivery into an existing
// hosted session: an alive PTY may now be a fallback shell after the engine
// exits, and pasting there would execute the prompt as shell commands.
/**
 * The narrow pty-host surface this module needs: request/response RPC plus
 * cleanup. `KobeDaemonClient` satisfies it; tests inject a fake that
 * records requests instead of opening a socket.
 */
export type PtyHostRpc = HostedSessionRpc

/**
 * A key belongs to `taskId` when its segment before the first `::` matches
 * — the same split `pty-host.ts` `sweepTasks` uses. `tab-1` is the engine
 * tab the TUI's `initialTabs()` always mints first.
 */
export const isTaskKey = isHostedTaskKey

/**
 * Pick the ALIVE engine session key for `taskId`, or `null` when none —
 * the single source of truth both delivery and liveness route through, so
 * "no engine" NEVER falls through to spawning a second one.
 *
 * `engineBin` is vendor-neutral: the caller passes
 * `interactiveEngineCommand(vendor)[0]` (or `undefined` when the vendor is
 * unknown, e.g. teardown/liveness — then only the `tab-1` rule applies).
 * Shared with the daemon's quota-resume path — see `hosted-session.ts`.
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

/**
 * Deliver `prompt` into an existing hosted engine session and submit it —
 * the bracketed+deferred-Enter pty twin of `pasteAndSubmit`, shared with the
 * daemon's quota-resume path (see `hosted-session.ts`). Returns whether the
 * session was alive to receive it.
 */
export const deliverToKey = deliverToHostedKey

const writePrompt = writeHostedPromptIfClear

/**
 * How long a fresh argv-delivery spawn gets to put an engine in the process
 * table before this call reports it unobserved. Short on purpose: a caller
 * is blocked on the answer, a failed launch (`command not found`) never
 * produces one, and an engine that is merely slow reports
 * `engineReady: false` with the session's own output as the reason rather
 * than a claim nobody checked.
 */
export const ENGINE_START_PROBE_MS = 3_000
export const ENGINE_START_POLL_MS = 150
export const ENGINE_NOT_OBSERVED_REASON = `no engine process appeared in the session within ${ENGINE_START_PROBE_MS}ms`

/**
 * Turn an observed write into the API's outcome fields. One place so every
 * delivery path reports the same measured facts instead of each inventing
 * its own optimistic defaults — which is how `delivered: true` came to mean
 * "we called write()" on one path and "we checked" on another.
 */
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
 * alive session at all — create the canonical one with the explicit prompt
 * already embedded in its launch argv (avoids racing a paste against a cold
 * engine's startup screen). `started: true` in the result means "a NEW
 * session was created", never "delivered into an existing one".
 *
 * When alive tabs exist but none resolves as an engine, this THROWS
 * (NO_ENGINE_TAB) instead of spawning. Issue #19: the silent-spawn fallback
 * booted an unsandboxed `--dangerously-skip-permissions` engine (in the
 * incident, cwd'd at the MAIN repo) while both sender and receiver believed
 * the message was delivered. A well-meaning fallback here is
 * indistinguishable from success on both sides — it must stay loud.
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
    readonly vendor?: VendorId
    readonly defer?: PromptDeferralSink
  },
): Promise<DeliveredPrompt> {
  const { sessions = [] } = await rpc.request<{ sessions?: PtySessionInfo[] }>("pty.list", {})
  // `forceNew` (send --tab new): the caller minted a fresh tab key and wants
  // a NEW engine spawned there — never reroute into the existing canonical
  // engine, which is exactly what the lookup below would do.
  const existingKey = opts?.forceNew ? null : findEngineKey(sessions, target.id, target.engineBin)
  if (existingKey) {
    // Foreground gate: the session's SPAWN argv matched an engine, but the
    // engine may have exited into the keepAlive shell since — pasting there
    // executes the prompt as shell commands. See {@link sessionHasEngine}.
    const pid = sessions.find((s) => s.key === existingKey)?.pid
    if (!(await sessionHasEngine(pid, target.engineBin, opts?.snapshot))) {
      throw new ApiError(
        `task ${target.id}'s engine tab (${existingKey}) has no live engine process — its engine exited into a plain shell`,
        "ENGINE_NOT_RUNNING",
        {
          hint: "spawn a fresh engine tab for this prompt with --tab new",
          nextCommandArgs: ["api", "send", "--task-id", target.id, "--tab", "new", "--prompt", prompt],
        },
      )
    }
    // No pty.detach: delivery peeks + writes without ever attaching, and a
    // detach from a never-attached client would clear a parked TUI's
    // exact-delta restore state as a side effect.
    const deliveryOpts = { screenManifest: resolveComposerManifest(opts?.vendor) }
    const tabId = existingKey.split("::")[1] ?? "tab-1"
    let outcome: PromptWriteOutcome | null
    try {
      outcome = await deliverToKey(rpc, existingKey, prompt, deliveryOpts)
    } catch (err) {
      if (err instanceof ComposerBusyError) return deferOrThrow(err, opts?.defer, target.id, tabId, prompt)
      throw err
    }
    return { session: existingKey, pane: existingKey, started: false, ...outcomeFields(outcome) }
  }

  // No engine resolved. Spawning is legitimate ONLY when the task has no
  // alive session whatsoever (first start / all-dead resume) — an alive tab
  // we merely failed to identify means the prompt would land in a duplicate
  // engine the receiver never sees. Fail loud; the caller picks a tab.
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

  // Everything below SPAWNS. Name the conversations a pty-host restart froze
  // and this call is about to pass over: without it "started a blank session
  // while your real work sits frozen" is byte-identical to a healthy first
  // start. See {@link DeliveredPrompt.frozenTabs}.
  const frozen = restoredTabsOf(sessions, target.id, launch.key)
  const disclose = frozen.length > 0 ? { frozenTabs: frozen } : {}
  const staleCanonical = sessions.find((session) => session.key === launch.key && !session.alive)
  // A FREEZE-RESTORED corpse is not killed: `pty.open` respawns it in place
  // (pre-restart scrollback kept), so the launch below both revives the tab
  // and carries this prompt. An ordinary corpse (died while the host lived)
  // is view-only — open would ignore our spec, so it must be killed first.
  if (staleCanonical && staleCanonical.restored !== true) await rpc.request("pty.kill", { key: launch.key })

  // No cols/rows: the host sizes the fresh spawn itself (80×24 default);
  // on the lost-create-race reattach below, a size-less open never resizes
  // the winner's session away from whatever client is attached to it.
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
    // Paste-delivery vendor (kimi — issue #25): the launch spawned the bare
    // engine and carried the first message OUTSIDE its argv; paste it once
    // the engine process is up. A paste that never lands is a failed start,
    // not a delivered prompt.
    if (launch.firstMessage) {
      const tabId = launch.key.split("::")[1] ?? "tab-1"
      let outcome: PromptWriteOutcome | null
      try {
        outcome = await pastePromptWhenEngineUp(rpc, launch.key, target.engineBin, launch.firstMessage, {
          initMarkerPath: launch.initMarkerPath,
          initTimeoutMs: launch.initTimeoutMs,
          screenManifest: resolveComposerManifest(opts?.vendor),
        })
      } catch (err) {
        if (err instanceof ComposerBusyError) return deferOrThrow(err, opts?.defer, target.id, tabId, prompt)
        throw err
      }
      return {
        session: launch.key,
        pane: launch.key,
        started: open.created !== false || open.respawned === true,
        ...outcomeFields(outcome),
        ...disclose,
      }
    }
    // Another API process may win the create race after our pty.list. Its
    // launch spec wins, so ours did not carry this prompt; deliver it now.
    // A RESPAWNED restored corpse is the opposite: our launch DID run (the
    // prompt rode its argv), so pasting here would deliver it twice.
    const started = open.created !== false || open.respawned === true
    if (open.created === false && open.respawned !== true) {
      const tabId = launch.key.split("::")[1] ?? "tab-1"
      let outcome: PromptWriteOutcome | null
      try {
        outcome = await writePrompt(rpc, launch.key, prompt, {
          screenManifest: resolveComposerManifest(opts?.vendor),
        })
      } catch (err) {
        if (err instanceof ComposerBusyError) return deferOrThrow(err, opts?.defer, target.id, tabId, prompt)
        throw err
      }
      return { session: launch.key, pane: launch.key, started, ...outcomeFields(outcome), ...disclose }
    }
    // OUR launch carried the prompt in its argv, so no paste happened here.
    // The engine reads the prompt from its own command line — a delivery this
    // code never observed, and the only thing that can confirm it is the
    // engine PROCESS existing. `open.alive` is not that: keepAlive `exec`s a
    // login shell where the engine exits, so a session whose launch command
    // does not exist reports `alive` exactly like a healthy one, and
    // `engineReady: true, delivered: true` came back for a binary that had
    // already printed `no such file or directory`.
    //
    // A missing init marker means the launch has not reached the engine yet.
    // Keep that result unconfirmed without waiting through dependency install.
    const pendingInit: DeliveredPrompt = {
      session: launch.key,
      pane: launch.key,
      started,
      engineReady: false,
      delivered: true,
      reason: "repo init script is still running; the engine has not started yet",
      ...disclose,
    }
    if (launch.initMarkerPath && !existsSync(launch.initMarkerPath)) return pendingInit
    // Otherwise walk for the process — the same `sessionHasEngine` the
    // existing-session gate above uses, in the loop `awaitEngineProcess`
    // already owns, not a third implementation of the same question.
    const enginePid = await awaitEngineProcess(rpc, launch.key, target.engineBin, {
      timeoutMs: ENGINE_START_PROBE_MS,
      intervalMs: ENGINE_START_POLL_MS,
      snapshot: opts?.snapshot,
    })
    if (enginePid === null) {
      // The shell may have removed an old failed marker and restarted init
      // during the probe. Marker absence only confirms pending init while
      // that same PTY is still alive.
      if (
        launch.initMarkerPath &&
        !existsSync(launch.initMarkerPath) &&
        (await listSessions(rpc)).some((session) => session.key === launch.key && session.alive)
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

export function resolveComposerManifest(vendor?: VendorId): EngineScreenManifest | undefined {
  return vendor ? engineEntry(vendor).screenManifest : undefined
}

/**
 * Gate blocked the paste. With a deferral sink (issue #78 B-layer), try to
 * hand the prompt to daemon ownership. Report deferred success only when the
 * daemon accepts it; an occupied slot or failed handoff is an error. Without
 * a sink there is no queue, so surface the legacy typed error.
 */
export async function deferOrThrow(
  error: ComposerBusyError,
  sink: PromptDeferralSink | undefined,
  taskId: string,
  tabId: string,
  prompt: string,
): Promise<DeliveredPrompt> {
  if (sink) {
    let deferred: Awaited<ReturnType<PromptDeferralSink["defer"]>>
    try {
      deferred = await sink.defer({ taskId, tabId, prompt, layer: error.layer })
    } catch {
      // The handoff failed (including when an older daemon lacks this verb).
      // Fail rather than claim ownership of unstored text.
      throw composerBusyApiError(error, taskId, prompt)
    }
    if (deferred.kind === "occupied") {
      // The recovery used to be a verbatim replay of the send that just
      // failed, which fails again for as long as the slot is held — a
      // self-healing step that cannot heal. Point at the action that actually
      // frees the slot; the retry is the caller's next move after that.
      throw new ApiError(`task ${taskId} tab ${tabId} already has a deferred prompt`, "DEFERRED_PROMPT_PENDING", {
        taskId,
        tabId,
        existingId: deferred.id,
        hint: "a prompt is already held for this tab — deliver it with `deferred-release --id`, or drop it with `deferred-dismiss --id`, then send yours again (`deferred-list` shows the text and its expiry)",
        nextCommandArgs: ["api", "deferred-release", "--id", deferred.id],
      })
    }
    return {
      session: `${taskId}::${tabId}`,
      pane: `${taskId}::${tabId}`,
      started: false,
      engineReady: false,
      delivered: false,
      deferred: {
        id: deferred.id,
        layer: error.layer,
        ...(deferred.expiresAt !== undefined ? { expiresAt: deferred.expiresAt } : {}),
      },
    }
  }
  throw composerBusyApiError(error, taskId, prompt)
}

function composerBusyApiError(error: ComposerBusyError, taskId: string, prompt: string): ApiError {
  const layerText = error.layer === "recent-human-write" ? "user was typing recently" : "composer has text"
  return new ApiError(`task ${taskId}'s composer is busy (${layerText})`, "COMPOSER_BUSY", {
    layer: error.layer,
    hint: "wait a moment and retry, or spawn a fresh engine tab with --tab new",
    nextCommandArgs: ["api", "send", "--task-id", taskId, "--prompt", prompt],
  })
}

/** Kill every hosted session for a task (its engine + any tabs). */
export const killTaskSessions = killHostedSessions
