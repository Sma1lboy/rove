/**
 * `kobe hook <verb>` — INTERNAL subcommand fired by engine hooks installed
 * globally (e.g. `~/.claude/settings.json`). Reports a normalized activity event
 * to the daemon, which maps the hook's cwd to a task (`daemon/cwd-task.ts`).
 * `verb` is already vendor-neutral; detail comes from the stdin JSON payload.
 *
 * Contract (load-bearing):
 *  - **Never spawns the daemon.** Resurrecting a gui-less daemon would break the
 *    refcounted lazy-shutdown; with no daemon the event is dropped (polling
 *    still covers the badge).
 *  - **Always exits 0.** A non-zero hook exit can FAIL the engine's action
 *    (WorktreeCreate). Every failure path is swallowed.
 */

import { join, resolve } from "node:path"
import { connectIfRunning } from "@sma1lboy/kobe-daemon/client/daemon-process"
import { readRoveEnv } from "@sma1lboy/kobe-daemon/compat-env"
import { readPluginManifest } from "@sma1lboy/kobe-daemon/plugins/manifest"
import { loadPluginRegistry } from "@sma1lboy/kobe-daemon/plugins/registry"
import { type EngineSessionRef, activityHookAdapters } from "../engine/hook-adapter.ts"
import type { EngineActivityDetail } from "../engine/hook-events.ts"
import { isEngineActivityKind } from "../engine/hook-events.ts"
import { getPersistedString, setPersistedString } from "../state/repos.ts"
import { flagValue } from "./argv.ts"
import { activeCliName } from "./rename-compat.ts"

/** Bounds a manual invocation without stdin so it can't hang. */
const STDIN_READ_TIMEOUT_MS = 500

/**
 * Race a reader against a timeout ("" if the timeout wins). MUST clear the timer
 * on settle: a pending timer keeps the event loop alive for the full timeout,
 * and this runs on every tool call / turn boundary machine-wide — a dangling
 * 500ms timer added ~500ms to each. Pure so this is unit-testable without `Bun`.
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

/**
 * Read stdin to EOF under bun OR node. The published CLI runs under node, where
 * a bare `Bun.stdin` throws and {@link readStdinPayload}'s catch turns it into a
 * silently empty payload (no session id, no cwd).
 *
 * A TTY returns "" at once: hooks always get a pipe, and a human running
 * `rove hook` by hand should get the usage path, not a hang.
 */
export async function readStdinText(): Promise<string> {
  const bun = (globalThis as { Bun?: { stdin: { text(): Promise<string> } } }).Bun
  if (bun) return bun.stdin.text()
  if (process.stdin.isTTY) return ""
  const chunks: Buffer[] = []
  try {
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  } finally {
    // The read refs the event loop; without this a hook whose writer never
    // closes the pipe keeps the process alive past the timeout below.
    process.stdin.destroy()
  }
  return Buffer.concat(chunks).toString("utf8")
}

/** The hook's stdin JSON payload, time-bounded; {} on anything odd. */
async function readStdinPayload(): Promise<Record<string, unknown>> {
  try {
    const text = await readTextWithTimeout(readStdinText)
    if (!text.trim()) return {}
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function runHookSubcommand(argv: readonly string[]): Promise<void> {
  const [verb, ...rest] = argv
  // `setup` and `cleanup` are user-facing and may print; every other verb is a
  // hook callback (see header). `cleanup` is the sanctioned plugin migration —
  // the launch-time gate only ever PROMPTS for it.
  if (verb === "setup") {
    await runHookSetup(rest)
    return
  }
  if (verb === "cleanup") {
    await runHookCleanup()
    return
  }
  try {
    if (!verb || !isEngineActivityKind(verb)) return // unknown verb → drop silently

    const payload = await readStdinPayload()
    // `--payload <json>` is for engines that can't pipe stdin (pi's `pi.exec`
    // fixes stdio to `["ignore","pipe","pipe"]`). Merged INTO the stdin payload;
    // malformed JSON is dropped.
    const payloadFlag = flagValue(rest, "--payload")
    if (payloadFlag) {
      try {
        const extra: unknown = JSON.parse(payloadFlag)
        if (extra && typeof extra === "object" && !Array.isArray(extra)) {
          Object.assign(payload, extra as Record<string, unknown>)
        }
      } catch {
        /* a hook must never fail the engine over a malformed payload */
      }
    }
    // Global hooks carry no task id; the daemon maps cwd → task. `--task-id` is
    // honoured for direct invocation.
    const taskId = flagValue(rest, "--task-id")
    // Engine tabs launch as `env KOBE_TASK_ID=… KOBE_TAB_ID=… <engine>`, and hooks
    // inherit it. cwd can't tell tabs apart (they share the worktree); env
    // taskId beats the cwd map but yields to an explicit flag.
    const envTaskId = process.env.KOBE_TASK_ID
    const envTabId = process.env.KOBE_TAB_ID
    // The adapter owns the vendor payload vocabulary. `--engine` picks the
    // right one; untagged installs ask each adapter, first answer wins.
    const engine = flagValue(rest, "--engine")
    const adapters = activityHookAdapters().filter((a) => !engine || a.vendor === engine)
    // A nested headless engine inherits the tab's env and would report its turns
    // as the tab's own, re-minting the tab's completion episode. Only the
    // environment can tell them apart, so drop here — unless `--task-id` asked
    // to be counted explicitly.
    if (!taskId && adapters.some((a) => a.isUnattendedSession?.(process.env) === true)) return
    // cwd by authority: payload `cwd`, then the adapter's own field (cursor runs
    // hooks in `~/.cursor` and names the workspace `workspace_roots` — without
    // it the event maps to no task), then process cwd.
    let cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : undefined
    for (const adapter of adapters) {
      if (cwd) break
      cwd = adapter.cwdFromPayload?.(payload)
    }
    cwd ||= process.cwd()
    let detail: EngineActivityDetail | undefined
    for (const adapter of adapters) {
      detail = adapter.activityDetailFromPayload(verb, payload)
      if (detail) break
    }
    // Lets the daemon pin the live engine session per task/tab, including
    // user-typed engines.
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
    // Swallowed, but opt-in visible: a dropped Stop leaves the sidebar spinning
    // with no evidence otherwise.
    if (readRoveEnv("HOOK_DEBUG")) {
      console.error(`[rove hook] ${verb} failed:`, err instanceof Error ? err.message : String(err))
    }
  }
}

const SYNC_SETTING_KEY = "externalWorktreeSync"

/** Engines that may carry a legacy WorktreeCreate hook to clean up. */
function worktreeSyncAdapters() {
  return activityHookAdapters().filter((a) => a.supportsWorktreeSync())
}

/** The engine that installed the legacy provider hook owns its active profile. */
function globalSettingsPath(): string | undefined {
  return worktreeSyncAdapters()[0]?.globalSettingsPath()
}

/** Settings file the WorktreeCreate hook was written into, or undefined when
 *  off/unset. Accepts an absolute path and the older `global` / `repo:<path>`. */
function persistedSyncPath(stored: string | undefined): string | undefined {
  if (!stored || stored === "off") return undefined
  if (stored === "global") return globalSettingsPath()
  if (stored.startsWith("repo:")) return join(resolve(stored.slice(5)), ".claude", "settings.json")
  return stored // already a resolved path
}

/**
 * Global hook sync, once per launch; best-effort and idempotent.
 *
 *  1. **Activity hooks** into each engine's global settings, so every session
 *     reports wherever it runs.
 *  2. **Worktree-watch removal** — a `PostToolUse` (Bash) observer costs a
 *     ~170ms spawn on every Bash call machine-wide for nothing; removed each
 *     launch.
 *  3. **WorktreeCreate cleanup** — it's a VCS *provider* hook: its presence
 *     makes Claude Code delegate worktree creation to it, and an observer
 *     (returns no path) BREAKS `claude --worktree` / `EnterWorktree` in every
 *     repo. Never install; remove any on disk. Adoption instead comes from the
 *     daemon's `session-start` auto-adopt (`findAdoptableWorktree`) and
 *     `rove add .`.
 */
export async function ensureGlobalKobeHooks(opts: { quiet?: boolean } = {}): Promise<void> {
  try {
    // 0. With the Rove Claude Code plugin enabled, its hooks.json carries the
    //    Claude hooks, so the Claude settings install is skipped (both would
    //    double-fire). Legacy installs are only reported, never removed — that's
    //    `rove hook cleanup`. Caveat: tool.* hooks are settings-managed only, so
    //    a plugin subscribing tool.* events still needs the settings install.
    const { isRovePluginEnabled, detectLegacyInstalls, migrationHint } = await import(
      "../engine/claude-code-local/plugin-migration.ts"
    )
    const pluginMode = isRovePluginEnabled()
    if (pluginMode) {
      const hint = migrationHint(detectLegacyInstalls(), activeCliName())
      if (hint) process.stderr.write(`\n${hint}\n`)
    }
    // 1. Activity hooks, into each engine's own settings file.
    const toolEvents = pluginsWantToolEvents()
    for (const a of activityHookAdapters()) {
      if (pluginMode && a.vendor === "claude") continue
      const enginePath = a.globalSettingsPath()
      if (!enginePath) continue
      await a.installActivityHooks(enginePath, { toolEvents, quiet: opts.quiet })
      // 2. Merge-safe: touches only Rove's own group.
      await a.removeWorktreeWatchHook(enginePath)
    }
    // 3. Remove the legacy WorktreeCreate hook wherever it was ever written.
    await cleanupWorktreeSyncHook()
  } catch {
    /* best-effort — never block launch */
  }
}

/**
 * Tool-hook volume gate (docs/design/plugin-events.md §Phase 2): Pre/PostToolUse
 * spawn `kobe hook` on every tool call machine-wide, so they're installed only
 * while an enabled plugin declares a `tool.*` event. Takes effect next launch.
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

/** Remove the legacy `WorktreeCreate` hook (global + any persisted repo path),
 *  keeping the user's own; then mark the setting off so we don't rescan. */
async function cleanupWorktreeSyncHook(): Promise<void> {
  const adapters = worktreeSyncAdapters()
  if (adapters.length === 0) return
  const stored = getPersistedString(SYNC_SETTING_KEY)
  const paths = new Set<string>()
  for (const adapter of adapters) {
    const file = adapter.globalSettingsPath()
    if (file) paths.add(file)
  }
  const prev = persistedSyncPath(stored)
  if (prev) paths.add(prev)
  for (const a of adapters) for (const p of paths) await a.removeWorktreeSyncHook(p)
  if (stored !== "off") setPersistedString(SYNC_SETTING_KEY, "off")
}

/**
 * `kobe hook cleanup` — remove Rove's settings-managed Claude hooks after the
 * plugin takes over (both would double-fire). Only Rove-tagged groups are
 * touched; other engines untouched. Idempotent.
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

/** `kobe hook setup` — DEPRECATED; only removes the WorktreeCreate hook (see
 *  {@link ensureGlobalKobeHooks}). Sync is automatic on the daemon side. */
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
