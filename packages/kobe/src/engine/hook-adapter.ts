/**
 * Neutral seam for engine activity hooks, so activity (turn started/finished,
 * rate-limited, waiting on a permission) arrives as events, not polling. The
 * adapter writes whatever its engine reads (Claude's `.claude/settings.json`,
 * Codex's `hooks.json`, …), pointing each hook at `kobe hook <verb>`
 * ({@link ./hook-events}); the hook reports its `cwd` and the daemon maps it to
 * a task (`daemon/cwd-task.ts`). A new engine is a new adapter file; neutral
 * code never names a vendor.
 *
 * Claude and Codex share one JSON shape (`./json-hooks`); Kimi writes TOML,
 * the pi family an extension module, Cursor a flatter JSON. Being built-in is
 * not what earns a hook: Cursor is a contrib entry (`./contrib-engines.ts`),
 * and {@link activityHookAdapters} is the one place that answers which engines
 * have one. Everything else gets {@link NoopHookAdapter}.
 */

import type { VendorId } from "../types/vendor.ts"
import type { EngineActivityDetail, EngineActivityKind } from "./hook-events.ts"
import type { HookEditOutcome } from "./json-hooks.ts"
import { engineEntry, identifiableEngineIds } from "./registry.ts"

/** An engine session's own identity, as reported by its hook payload. */
export interface EngineSessionRef {
  readonly sessionId: string
  readonly transcriptPath?: string
}

export interface EngineHookAdapter {
  readonly vendor: VendorId
  /** Whether this engine has a wired hook mechanism (false → install is a no-op). */
  supportsHooks(): boolean
  /**
   * The engine's global hook settings file (`~/.claude/settings.json`,
   * `~/.codex/hooks.json`) that install/remove write. Only consulted when
   * {@link supportsHooks} is true; a no-op adapter may return "".
   */
  globalSettingsPath(): string
  /**
   * Map the vendor's stdin payload to {@link EngineActivityDetail}. Undefined
   * when there is nothing for this verb or the payload isn't this engine's:
   * the hook command carries no vendor id, so `kobe hook` takes the first
   * non-undefined answer across adapters. Pure; must never throw.
   */
  activityDetailFromPayload(
    kind: EngineActivityKind,
    payload: Record<string, unknown>,
  ): EngineActivityDetail | undefined
  /**
   * Engine session identity from a hook payload (Claude sends `session_id` +
   * `transcript_path` on every hook). The daemon stores it per (task, tab?),
   * covering sessions kobe didn't spawn (a user-typed `claude`, via the cwd
   * map). Same first-non-undefined dispatch as
   * {@link activityDetailFromPayload}. Pure; must never throw.
   */
  sessionFromPayload(payload: Record<string, unknown>): EngineSessionRef | undefined
  /**
   * Does this hook's own env mark an unattended session (e.g. a nested headless
   * engine a script ran inside a Rove tab)? `KOBE_TASK_ID` / `KOBE_TAB_ID`
   * are inherited, so without this every nested turn reports as the parent
   * tab's: `turn_complete` re-fires per subprocess and foreign tokens bill to
   * the tab. Neither cwd (same worktree) nor the daemon (the live session id
   * isn't authoritative; the engine may restart in place) can tell. Optional;
   * omitted = hooks report as usual. Pure; must never throw.
   */
  isUnattendedSession?(env: NodeJS.ProcessEnv): boolean
  /**
   * Install activity hooks into a shared settings file so every session
   * reports via `kobe hook <verb>`. Must be idempotent (skips the write when
   * in place), merge-safe (keeps the user's hooks), and never throw fatally.
   * Returns whether the merge reached the file: a refusal (unparseable
   * document) doesn't fail the launch, but hooks stay uninstalled and badges
   * fall back to the daemon's ~10s poll.
   */
  installActivityHooks(
    settingsFilePath: string,
    opts?: {
      toolEvents?: boolean
      /** Suppress the refusal's stderr line. For the Settings pane, which owns
       *  the terminal (a raw write paints over the OpenTUI frame) and shows the
       *  refusal on the engine's row instead. */
      quiet?: boolean
    },
  ): Promise<HookEditOutcome>
  /** Remove the activity hooks this adapter installed. Idempotent. */
  removeActivityHooks(settingsFilePath: string): Promise<void>

  /**
   * Whether this settings file may carry a `WorktreeCreate` hook needing
   * cleanup. Rove never installs one: it is a VCS provider hook, so an
   * observer there breaks `claude --worktree` / `EnterWorktree`. The daemon
   * adopts worktrees on session-start instead.
   */
  supportsWorktreeSync(): boolean
  /** Remove kobe's `WorktreeCreate` hook; keeps the user's. Idempotent; no-op when unsupported. */
  removeWorktreeSyncHook(settingsFilePath: string): Promise<void>

  /**
   * Remove the worktree-watch hook, a `PostToolUse` (Bash) observer costing
   * ~170ms per Bash call. Never installed; removed on every launch. Touches
   * only Rove's group; idempotent; no-op when {@link supportsHooks} is false.
   */
  removeWorktreeWatchHook(settingsFilePath: string): Promise<void>

  /**
   * The directory the payload is about, when the engine doesn't spell it
   * `cwd`. `kobe hook` otherwise reads `payload.cwd`, then `process.cwd()`;
   * cursor-agent runs hooks in `~/.cursor` with the workspace in
   * `workspace_roots[0]`, so without this every cursor hook maps to no task.
   * Optional; pure; must never throw.
   */
  cwdFromPayload?(payload: Record<string, unknown>): string | undefined

  /**
   * Why a merge into this file would be refused, or undefined when fine;
   * `rove doctor`'s read-only counterpart to {@link installActivityHooks}
   * (`./hook-config-check.ts`). Per-engine because the formats differ (one
   * validator flagged Cursor's valid `hooks.json`). Omitted = not checked.
   */
  hookConfigRefusal?(raw: string): string | undefined
}

/**
 * Delegates to the engine registry. Intentional import cycle with
 * `registry.ts` (which imports `NoopHookAdapter`): safe only because both
 * sides dereference each other's bindings inside function bodies, never at
 * module top level.
 */
export function createEngineHookAdapter(vendor: VendorId): EngineHookAdapter {
  return engineEntry(vendor).createHookAdapter()
}

/**
 * Every engine with wired hooks; the one answer for both the installer
 * (`cli/hook-cmd.ts`) and doctor (`./hook-config-check.ts`). Walks
 * {@link identifiableEngineIds}, not built-ins, because contrib/plugin engines
 * may declare adapters (Cursor), and a fired `--engine cursor` hook needs one
 * to decode with.
 */
export function activityHookAdapters(): readonly EngineHookAdapter[] {
  return identifiableEngineIds()
    .map((vendor) => createEngineHookAdapter(vendor))
    .filter((adapter) => adapter.supportsHooks())
}

/** Stub for engines whose hook mechanism isn't wired (e.g. Copilot). */
export class NoopHookAdapter implements EngineHookAdapter {
  constructor(readonly vendor: VendorId) {}
  supportsHooks(): boolean {
    return false
  }
  globalSettingsPath(): string {
    return "" // no wired hooks → never consulted
  }
  activityDetailFromPayload(): EngineActivityDetail | undefined {
    return undefined // no wired hooks → no payload this adapter understands
  }
  sessionFromPayload(): EngineSessionRef | undefined {
    return undefined // no wired hooks → no payload this adapter understands
  }
  async installActivityHooks(): Promise<HookEditOutcome> {
    /* no-op until this engine's hook format is implemented */
    return { ok: true }
  }
  async removeActivityHooks(): Promise<void> {
    /* no-op */
  }
  supportsWorktreeSync(): boolean {
    return false
  }
  async removeWorktreeSyncHook(): Promise<void> {
    /* no-op */
  }
  async removeWorktreeWatchHook(): Promise<void> {
    /* no-op */
  }
}
