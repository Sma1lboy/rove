/**
 * Engine HOOK adapter — the neutral seam (KOB).
 *
 * kobe wants engine activity (turn started/finished, rate-limited, waiting on
 * a permission prompt) to flow as real events, not polling. Each engine
 * delivers that through its OWN hook mechanism — Claude Code's
 * `.claude/settings.json` hooks, Codex's `hooks.json`, etc. — which are
 * vendor-specific. This interface hides ALL of that behind a neutral contract
 * so the orchestrator / daemon / TUI never name a vendor (CLAUDE.md
 * "Engine-owned UI data"): the orchestrator just asks the adapter to install
 * the GLOBAL activity hooks once, and the adapter writes whatever its engine
 * reads, pointing each hook at `kobe hook <normalized-verb>` (see
 * {@link ./hook-events}). The hook reports its `cwd`; the daemon maps that to a
 * task (`daemon/cwd-task.ts`). Adding a new engine = a new adapter file; no
 * neutral code changes.
 *
 * Claude and Codex are real implementations sharing one settings.json shape
 * (`./json-hooks`); Kimi writes TOML, the pi family writes an extension module,
 * and Cursor writes its own flatter JSON. Being a BUILT-IN is not what earns an
 * engine a hook — Cursor is a contrib catalog entry
 * (`./contrib-engines.ts`) that declares an adapter, and
 * {@link activityHookAdapters} is the one place that answers which engines have
 * one. Everything else gets {@link NoopHookAdapter}, which is the interface
 * doing its job: an unwired engine installs nothing and warns about nothing.
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
   * The engine's GLOBAL hook settings file (`~/.claude/settings.json` for
   * Claude, `~/.codex/hooks.json` for Codex) — the path the install/remove
   * methods write. The adapter owns this because the file lives in the engine's
   * own config dir, not kobe's. Only consulted when {@link supportsHooks} is
   * true; a no-op adapter may return "".
   */
  globalSettingsPath(): string
  /**
   * FIRE-time half of the adapter's translation (install time maps vendor
   * hook events to neutral verbs; this maps the vendor's stdin payload to
   * the neutral {@link EngineActivityDetail}). Returns undefined when the
   * payload carries nothing this verb needs — or when the payload isn't
   * this engine's (the installed hook command carries no vendor id, so
   * `kobe hook` asks each hook-supporting adapter in turn and uses the
   * first non-undefined answer). Pure; must never throw.
   */
  activityDetailFromPayload(
    kind: EngineActivityKind,
    payload: Record<string, unknown>,
  ): EngineActivityDetail | undefined
  /**
   * Extract the engine's own session identity from a hook stdin payload
   * (Claude pipes `session_id` + `transcript_path` on every hook). The
   * daemon stores it per (task, tab?) so any consumer can resolve "which
   * engine session is live here" — including sessions kobe didn't spawn
   * (a user-typed `claude` reaches the daemon via the cwd map). Same
   * first-non-undefined dispatch as {@link activityDetailFromPayload};
   * undefined when the payload isn't this engine's or carries no id.
   * Pure; must never throw.
   */
  sessionFromPayload(payload: Record<string, unknown>): EngineSessionRef | undefined
  /**
   * Does this hook's OWN process environment say it belongs to an unattended
   * engine session — no human at a terminal, e.g. a nested headless engine a
   * script shelled out to from inside a Rove tab?
   *
   * Optional: an engine that exposes no such signal omits it, and its hooks
   * keep reporting exactly as before.
   *
   * Why anyone has to ask. Rove's tab identity (`KOBE_TASK_ID` /
   * `KOBE_TAB_ID`) travels by ENV INHERITANCE, so a nested engine inherits it
   * along with the rest of the environment and its every turn reports as the
   * PARENT TAB's own. One script fanning out headless subprocesses therefore
   * re-mints that tab's `turn_complete` attention episode once per
   * subprocess — the completion prompt fires over and over while the user's
   * real turn finished long ago — and bills each foreign session's tokens to
   * that tab. cwd cannot see this (the nested engine runs in the same
   * worktree) and neither can the daemon (a tab's live session id is not
   * authoritative — the user may restart the engine in place). The hook's own
   * environment is the only place the answer exists.
   *
   * Pure; must never throw. `env` is a parameter rather than a read of
   * `process.env` so the rule is testable as a plain value.
   */
  isUnattendedSession?(env: NodeJS.ProcessEnv): boolean
  /**
   * Install kobe's activity hooks into a SHARED settings file (the user's
   * global `~/.claude/settings.json`) so the engine, in ANY session, reports
   * normalized events via `kobe hook <verb>` (cwd-based; the daemon maps cwd to
   * a task). Must be IDEMPOTENT (safe on every launch; skips the write when
   * already in place), merge-safe (preserves the user's own hooks), and must
   * never throw fatally.
   *
   * Returns whether the merge actually reached the file. A refusal (a
   * settings document this adapter cannot understand) is not an error the
   * launch may fail on, but it is not nothing either: hooks stay uninstalled
   * for good and every badge falls back to the daemon's ~10s poll.
   */
  installActivityHooks(
    settingsFilePath: string,
    opts?: {
      toolEvents?: boolean
      /**
       * Suppress the stderr line a refusal normally prints. For the ONE
       * caller that owns the terminal: the Settings pane runs this install on
       * a keypress, and a raw write from under a live OpenTUI render paints
       * over the frame. That caller shows the same refusal on the engine's own
       * row, so the line is redundant there rather than merely inconvenient.
       */
      quiet?: boolean
    },
  ): Promise<HookEditOutcome>
  /** Remove the activity hooks this adapter installed. Idempotent. */
  removeActivityHooks(settingsFilePath: string): Promise<void>

  /**
   * Whether this engine's settings file may carry a worktree-sync
   * (`WorktreeCreate`) hook — the only use is knowing whose file needs
   * CLEANUP. Rove never installs one: `WorktreeCreate` is a VCS *provider*
   * hook, so kobe's observer there breaks `claude --worktree` /
   * `EnterWorktree` everywhere. Sync lives in the daemon instead (auto-adopt
   * a worktree under a tracked repo on session-start).
   */
  supportsWorktreeSync(): boolean
  /** Remove kobe's `WorktreeCreate` hook from a settings file. Idempotent +
   *  merge-safe (preserves the user's own WorktreeCreate hooks). No-op when
   *  unsupported. */
  removeWorktreeSyncHook(settingsFilePath: string): Promise<void>

  /**
   * Remove the worktree-WATCH hook — a global `PostToolUse` (Bash) observer
   * that spawns `kobe hook worktree-created` after EVERY Bash call, a pure
   * ~170ms-per-Bash-call tax. Rove never installs it; it uninstalls on every
   * launch, until every user's settings file is clean. Idempotent + merge-safe
   * (touches only Rove's own group). No-op when {@link supportsHooks} is false.
   */
  removeWorktreeWatchHook(settingsFilePath: string): Promise<void>

  /**
   * Why a merge into this settings file would be REFUSED right now, or
   * undefined when the file is fine — `rove doctor`'s read-only counterpart to
   * {@link installActivityHooks} (see `./hook-config-check.ts`).
   *
   * Optional, and the ANSWER is per-engine because the VALIDATOR is: Claude and
   * Codex share one JSON shape, Cursor's `hooks.json` is a different one, and
   * Kimi's file is TOML. A checker that ran one validator over every `.json`
   * hook file reported Cursor's perfectly good file as broken. An adapter that
   * omits this is simply not checked.
   */
  hookConfigRefusal?(raw: string): string | undefined
}

/**
 * Resolve the hook adapter for a vendor — a thin delegate to the engine
 * registry, which owns the claude-vs-noop choice (one entry per engine;
 * see `registry.ts`). Kept exported here so call sites (`cli/hook-cmd.ts`)
 * keep their import. NB: registry.ts imports `NoopHookAdapter` from this
 * module, so this pair is an intentional import cycle — both sides only
 * dereference the other's bindings inside function bodies (never at module
 * top-level), which keeps the cycle safe under ESM evaluation order.
 */
export function createEngineHookAdapter(vendor: VendorId): EngineHookAdapter {
  return engineEntry(vendor).createHookAdapter()
}

/**
 * Every engine whose hook mechanism is wired — the ONE answer to "which engines
 * get global hooks", asked by both the installer (`cli/hook-cmd.ts`) and the
 * doctor check (`./hook-config-check.ts`).
 *
 * Derived from {@link identifiableEngineIds} rather than the BUILT-IN vendor
 * list: a hook adapter is now something a contrib or plugin engine may declare
 * too (Cursor does), and a built-ins-only walk would install its hooks nowhere
 * while the `--engine cursor` tag on the fired hook found no adapter to decode
 * with. Engines that declare none answer `supportsHooks() === false` through
 * {@link NoopHookAdapter} and drop out here.
 */
export function activityHookAdapters(): readonly EngineHookAdapter[] {
  return identifiableEngineIds()
    .map((vendor) => createEngineHookAdapter(vendor))
    .filter((adapter) => adapter.supportsHooks())
}

/** Stub for engines whose hook mechanism isn't wired yet (Codex, Copilot). */
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
