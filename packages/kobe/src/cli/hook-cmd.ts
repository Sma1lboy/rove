/**
 * `kobe hook <verb>` — INTERNAL subcommand fired by an engine's hooks (e.g.
 * Claude Code's Stop / StopFailure / Notification), installed GLOBALLY into the
 * user's `~/.claude/settings.json` by the engine hook adapter. It reports a
 * NORMALIZED activity event to the daemon, which maps the hook's cwd to a task
 * (`daemon/cwd-task.ts`), folds it into that task's transient engine-state, and
 * broadcasts it (event-driven task badges).
 *
 * Contract (load-bearing):
 *  - **Never spawns the daemon.** A hook may fire while the user is detached
 *    (no gui) and the daemon has idle-stopped; resurrecting a gui-less daemon
 *    would break the refcounted lazy-shutdown. If no daemon is running the
 *    event is simply dropped (best-effort; the activity badge lapses to idle
 *    and the polling fallback still covers it).
 *  - **Always exits 0.** A non-zero hook exit is at best logged and at worst
 *    (WorktreeCreate) FAILS the engine's action — never acceptable for an
 *    observability hook. Every failure path here is swallowed.
 *
 * `verb` is already vendor-neutral (the engine adapter did the translation);
 * extra detail (failure class, waiting reason) is read from the hook's stdin
 * JSON payload.
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { connectIfRunning } from "@sma1lboy/kobe-daemon/client/daemon-process"
import { readPluginManifest } from "@sma1lboy/kobe-daemon/plugins/manifest"
import { loadPluginRegistry } from "@sma1lboy/kobe-daemon/plugins/registry"
import { type EngineSessionRef, createEngineHookAdapter } from "../engine/hook-adapter.ts"
import type { EngineActivityDetail } from "../engine/hook-events.ts"
import { isEngineActivityKind } from "../engine/hook-events.ts"
import { getPersistedString, setPersistedString } from "../state/repos.ts"
import { ALL_VENDORS } from "../types/vendor.ts"
import { flagValue } from "./argv.ts"
import { activeCliName } from "./rename-compat.ts"

/** Default timeout for the stdin race — bounds a manual invocation without
 *  stdin so it can't hang. */
const STDIN_READ_TIMEOUT_MS = 500

/**
 * Race a text reader against a fallback timeout, returning "" if the timeout
 * wins. CRUCIALLY clears the timer the moment the race settles: an un-cleared
 * `setTimeout` stays pending and keeps the event loop alive for the full
 * `timeoutMs` after the work is already done. `kobe hook` runs on EVERY Bash
 * tool call + turn boundary of every Claude session machine-wide (it's the
 * global PostToolUse / activity hook), so a dangling 500ms timer added ~500ms
 * of pure idle wait to each of those invocations. Pure (reader + clock are the
 * only inputs) so the timer-hygiene contract is unit-testable without `Bun`.
 */
export async function readTextWithTimeout(
  read: () => Promise<string>,
  timeoutMs: number = STDIN_READ_TIMEOUT_MS,
): Promise<string> {
  let raceTimer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read(),
      new Promise<string>((resolve) => {
        raceTimer = setTimeout(() => resolve(""), timeoutMs)
      }),
    ])
  } finally {
    if (raceTimer !== undefined) clearTimeout(raceTimer)
  }
}

/** Read the hook's stdin JSON payload (Claude Code pipes it), bounded so a
 *  manual invocation without stdin can't hang. Returns {} on anything odd. */
async function readStdinPayload(): Promise<Record<string, unknown>> {
  try {
    const text = await readTextWithTimeout(() => Bun.stdin.text())
    if (!text.trim()) return {}
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function runHookSubcommand(argv: readonly string[]): Promise<void> {
  const [verb, ...rest] = argv
  // `setup` is the only user-facing verb (now a deprecated cleanup) and may
  // print on a usage error. Everything else is a hook callback: best-effort,
  // always exit 0 (see header).
  if (verb === "setup") {
    await runHookSetup(rest)
    return
  }
  // `cleanup` — the sanctioned migration path: remove the
  // settings-managed Rove hooks after the Claude Code plugin takes over.
  // User-invoked and loud; the launch-time gate only ever PROMPTS for this.
  if (verb === "cleanup") {
    await runHookCleanup()
    return
  }
  try {
    if (!verb || !isEngineActivityKind(verb)) return // unknown verb → drop silently

    const payload = await readStdinPayload()
    // The global hook carries no task id — it reports the cwd it ran in, and
    // the daemon maps that to a task by worktree path. Claude pipes `cwd` in
    // the payload; fall back to the process cwd. `--task-id` is still honoured
    // for back-compat / direct invocation.
    const taskId = flagValue(rest, "--task-id")
    const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd()
    // Tab identity: engine tabs launch as `env KOBE_TASK_ID=… KOBE_TAB_ID=… <engine>`
    // (terminal-tab-spawn.ts), and hooks are the engine's subprocesses, so the
    // vars arrive here by inheritance. cwd alone can't tell tabs apart — every
    // tab of a task shares the worktree. Env taskId also beats the cwd map
    // (exact identity vs longest-prefix guess) but yields to an explicit flag.
    const envTaskId = process.env.KOBE_TASK_ID
    const envTabId = process.env.KOBE_TAB_ID
    // Payload → neutral detail is the engine adapter's job (it owns the
    // vendor's payload vocabulary, e.g. Claude's `error_type` classes).
    // Current installs tag the command with `--engine <vendor>` so the RIGHT
    // adapter decodes; legacy untagged installs fall back to asking each
    // adapter and taking the first answer (fine for the pre-tool verb set).
    const engine = flagValue(rest, "--engine")
    const adapters = activityHookAdapters().filter((a) => !engine || a.vendor === engine)
    let detail: EngineActivityDetail | undefined
    for (const adapter of adapters) {
      detail = adapter.activityDetailFromPayload(verb, payload)
      if (detail) break
    }
    // Session identity (session_id/transcript_path in Claude's payload) —
    // same dispatch as `detail`. Lets the daemon pin "which engine session
    // is live" per task/tab, including user-typed engines.
    let session: EngineSessionRef | undefined
    for (const adapter of adapters) {
      session = adapter.sessionFromPayload(payload)
      if (session) break
    }

    const client = await connectIfRunning() // NON-spawning by contract
    if (!client) return
    try {
      const effectiveTaskId = taskId ?? envTaskId
      await client.request("engine.reportEvent", {
        ...(effectiveTaskId ? { taskId: effectiveTaskId } : { cwd }),
        kind: verb,
        ...(engine ? { engine } : {}),
        ...(envTabId ? { tabId: envTabId } : {}),
        ...(detail ? { detail } : {}),
        ...(session ? { sessionId: session.sessionId } : {}),
        ...(session?.transcriptPath ? { transcriptPath: session.transcriptPath } : {}),
      })
    } finally {
      client.close()
    }
  } catch (err) {
    // Swallowed — a hook must never fail the engine — but not INVISIBLE. A
    // silently-dropped Stop leaves the sidebar spinning with zero evidence
    // anywhere, and a catch that leaves no trace is undebuggable. Opt-in so
    // normal runs stay quiet.
    if (process.env.KOBE_HOOK_DEBUG) {
      console.error(`[rove hook] ${verb} failed:`, err instanceof Error ? err.message : String(err))
    }
  }
}

const SYNC_SETTING_KEY = "externalWorktreeSync"

/** Engines that once installed a WorktreeCreate hook (only Claude) — used now
 *  only to CLEAN UP that removed hook. */
function worktreeSyncAdapters() {
  return ALL_VENDORS.map((v) => createEngineHookAdapter(v)).filter((a) => a.supportsWorktreeSync())
}

/** Engines whose hook mechanism is wired (get global activity hooks). */
function activityHookAdapters() {
  return ALL_VENDORS.map((v) => createEngineHookAdapter(v)).filter((a) => a.supportsHooks())
}

/** Where kobe's GLOBAL activity hooks live (the OS home's ~/.claude, where
 *  Claude Code reads user settings — NOT kobe's KOBE_HOME_DIR). */
function globalSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json")
}

/** Resolve a persisted sync setting to the settings-file path the
 *  WorktreeCreate hook was written into (so cleanup finds it), or undefined when
 *  off/unset. Accepts the current form (an absolute path) AND the older
 *  `global` / `repo:<path>` forms for back-compat. */
function persistedSyncPath(stored: string | undefined): string | undefined {
  if (!stored || stored === "off") return undefined
  if (stored === "global") return globalSettingsPath()
  if (stored.startsWith("repo:")) return join(resolve(stored.slice(5)), ".claude", "settings.json")
  return stored // already a resolved path
}

/**
 * Default-ON global hook sync (KOB). Called once per kobe launch. One install
 * plus two removals, all best-effort and idempotent (the adapter skips the write when
 * nothing changes):
 *
 *  1. **Activity hooks** — Stop / StopFailure / Notification / Session* into the
 *     user's global `~/.claude/settings.json`, so EVERY Claude session reports
 *     normalized events; the daemon maps each hook's cwd to a task. Always
 *     global (a task's badge must light up wherever its engine runs).
 *  2. **Worktree-watch removal** — a global `PostToolUse` (Bash) observer
 *     firing `kobe hook worktree-created` after every Bash call is a pure tax:
 *     a ~170ms process spawn on EVERY Bash call of every session machine-wide,
 *     for nothing. Rove never installs it, and the removal runs on each launch
 *     so a settings file that already carries the entry gets it dropped.
 *  3. **WorktreeCreate cleanup** — a global `WorktreeCreate` hook for
 *     external-worktree sync must never be installed: `WorktreeCreate` is a VCS
 *     *provider* hook, so its mere presence makes Claude Code delegate worktree
 *     creation to it and skip the native git path, and an observer hook (which
 *     returns no path) BREAKS `claude --worktree` / `EnterWorktree` in every
 *     repo. Any such hook already on disk is removed here.
 *     Nothing replaces it: worktree adoption is intent-driven — the daemon's
 *     `session-start` auto-adopt (`daemon/cwd-task.ts` `findAdoptableWorktree`)
 *     catches worktrees first entered by an engine session, and `rove add .`
 *     covers the explicit case.
 *
 * Writing the user's global settings.json is intentionally invasive but
 * acceptable for now (current users are developers).
 */
export async function ensureGlobalKobeHooks(): Promise<void> {
  try {
    // 0. Plugin takeover: when the Rove Claude Code PLUGIN is
    //    enabled, its own hooks.json already carries the Claude activity +
    //    worktree-watch hooks, so the settings-managed install for CLAUDE is
    //    skipped — installing both would double-fire every event. Detection
    //    is prompt-only: legacy settings-managed hooks / a pre-plugin skill
    //    dir are reported to stderr, never silently removed (the sanctioned
    //    path is the user-invoked `rove hook cleanup`). Other engines
    //    (codex/…) are untouched by plugin mode. Note: the volume-gated
    //    tool-pre/post/failed family is settings-managed only, so a Rove
    //    plugin subscribing tool.* events needs the settings install (run
    //    `rove hook cleanup` only after disabling such plugins, or keep the
    //    Claude plugin off).
    const { isRovePluginEnabled, detectLegacyInstalls, migrationHint } = await import(
      "../engine/claude-code-local/plugin-migration.ts"
    )
    const pluginMode = isRovePluginEnabled()
    if (pluginMode) {
      const hint = migrationHint(detectLegacyInstalls(), activeCliName())
      if (hint) process.stderr.write(`\n${hint}\n`)
    }
    // 1. Activity hooks + the creation-time worktree-watch hook — both global,
    //    each written into the ENGINE's own settings file (Claude's
    //    ~/.claude/settings.json, Codex's ~/.codex/hooks.json) so every session
    //    of that engine reports.
    const toolEvents = pluginsWantToolEvents()
    for (const a of activityHookAdapters()) {
      if (pluginMode && a.vendor === "claude") continue
      const enginePath = a.globalSettingsPath()
      if (!enginePath) continue
      await a.installActivityHooks(enginePath, { toolEvents })
      // Uninstall the PostToolUse(Bash) watch hook. It spawns `kobe hook
      // worktree-created` after EVERY Bash call for a ~170ms process spawn
      // per Bash call, machine-wide, and nothing in return. Running the
      // removal on every launch is how an already-registered settings file
      // gets it dropped — idempotent, merge-safe, and it touches only Rove's
      // own group.
      await a.removeWorktreeWatchHook(enginePath)
    }
    // 3. Remove the legacy WorktreeCreate hook wherever it was ever written.
    await cleanupWorktreeSyncHook()
  } catch {
    /* best-effort — never block launch */
  }
}

/**
 * The tool-family volume gate (docs/design/plugin-events.md §Phase 2): the
 * PreToolUse/PostToolUse hooks spawn `kobe hook` on EVERY tool call of every
 * session machine-wide, so they're written into the engine config only while
 * an enabled plugin actually declares a `tool.*` event hook. Synced on every
 * launch (this runs from ensureGlobalKobeHooks), so installing/removing such
 * a plugin takes effect on the next kobe start.
 */
function pluginsWantToolEvents(): boolean {
  try {
    for (const entry of loadPluginRegistry().plugins) {
      if (!entry.enabled) continue
      try {
        if (readPluginManifest(entry.root).manifest.events.some((e) => e.on.startsWith("tool."))) return true
      } catch {
        /* unreadable manifest → doesn't vote */
      }
    }
  } catch {
    /* registry unreadable → no tool hooks */
  }
  return false
}

/**
 * Remove kobe's old `WorktreeCreate` hook from the global settings AND any repo
 * path it was persisted to, then mark the setting off so we don't rescan. Pure
 * cleanup — merge-safe (preserves the user's own WorktreeCreate hooks).
 */
async function cleanupWorktreeSyncHook(): Promise<void> {
  const adapters = worktreeSyncAdapters()
  if (adapters.length === 0) return
  const stored = getPersistedString(SYNC_SETTING_KEY)
  const paths = new Set<string>([globalSettingsPath()])
  const prev = persistedSyncPath(stored)
  if (prev) paths.add(prev)
  for (const a of adapters) for (const p of paths) await a.removeWorktreeSyncHook(p)
  if (stored !== "off") setPersistedString(SYNC_SETTING_KEY, "off")
}

/**
 * `kobe hook cleanup` — remove Rove's settings-managed activity +
 * worktree-watch hooks from the CLAUDE settings file. The migration step
 * after installing the Claude Code plugin: the plugin's hooks.json carries
 * the same hooks, so the settings copy would double-fire every event. Merge
 * mechanics are the adapter's own remove path — only Rove-tagged groups are
 * touched, user hooks and other engines (codex/…) stay intact. Idempotent.
 */
async function runHookCleanup(): Promise<void> {
  const claude = activityHookAdapters().find((a) => a.vendor === "claude")
  const path = claude?.globalSettingsPath()
  if (!claude || !path) {
    process.stdout.write("rove hook cleanup: no Claude hook adapter — nothing to do.\n")
    return
  }
  await claude.removeActivityHooks(path)
  await claude.removeWorktreeWatchHook(path)
  process.stdout.write(
    [
      `rove hook cleanup: removed Rove's settings-managed hooks from ${path}.`,
      "Only Rove's own entries were touched; your other hooks are intact.",
      "The Claude Code plugin's hooks.json now carries these events (if the plugin",
      "is not installed, the next Rove launch reinstalls the settings-managed set).",
      "",
    ].join("\n"),
  )
}

/**
 * `kobe hook setup` — DEPRECATED. External-worktree-sync was configured with a
 * global `WorktreeCreate` hook, which breaks `claude --worktree` /
 * `EnterWorktree` in every repo (see {@link ensureGlobalKobeHooks}). The command
 * only cleans up an installed hook; sync is automatic on the daemon side.
 */
async function runHookSetup(_argv: readonly string[]): Promise<void> {
  await cleanupWorktreeSyncHook()
  process.stdout.write(
    [
      "rove hook setup is deprecated and now a no-op (cleanup only).",
      "",
      "The old external-worktree sync used a global WorktreeCreate hook, which is",
      "a VCS provider hook — its presence broke `claude --worktree` / EnterWorktree",
      "in every repo. Any hook Rove previously installed has been removed.",
      "",
      "Sync is now automatic: a `claude --worktree` (or any session) started in a",
      "worktree under a repo Rove already tracks is adopted as a task on launch.",
      "To adopt existing worktrees on demand, use the New Task dialog or `rove adopt`.",
      "",
    ].join("\n"),
  )
}
