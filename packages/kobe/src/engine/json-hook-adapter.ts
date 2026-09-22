/**
 * Abstract base for engine hook adapters whose engine uses the shared
 * settings.json hook shape (Claude Code's `~/.claude/settings.json`, Codex's
 * `~/.codex/hooks.json`). Owns everything vendor-neutral: best-effort
 * read→merge→write I/O and the four install/remove methods, delegating to the
 * pure merge core in `./json-hooks`. A concrete adapter supplies its vendor id,
 * event→verb table ({@link eventMap}), settings path, and any override (Claude
 * adds `error_type`/permission decoding + legacy `WorktreeCreate` cleanup).
 */

import type { VendorId } from "../types/vendor.ts"
import type { EngineHookAdapter, EngineSessionRef } from "./hook-adapter.ts"
import type { EngineActivityDetail, EngineActivityKind } from "./hook-events.ts"
import {
  GATED_TOOL_VERBS,
  type HookEditOutcome,
  type HookEventSpec,
  type HookSettingsParse,
  removeWorktreeWatchHook as dropWorktreeWatchHook,
  mergeActivityHooks,
  parseHookSettings,
  roveHookArgs,
} from "./json-hooks.ts"
import { updateSharedJson } from "./shared-config-write.ts"

/**
 * Read → transform → write a SHARED settings file, skipping the write when the
 * transform is a no-op (the default-on installers run on every launch; don't
 * churn the user's file mtime / VCS status when the hooks are already in place).
 *
 * The file is shared with the engine and Rove's other two processes, so the
 * write runs under the compare-and-swap in `./shared-config-write.ts` (its
 * guarantee is partial by design) and lands via tmp+rename, never onto the
 * live file a starting session may be reading.
 *
 * Best-effort: failure never blocks a launch; it is REPORTED, not thrown
 * ({@link HookEditOutcome}), and the caller reports once — `ensureGlobalKobeHooks`
 * runs three edits on this file every launch.
 */
export async function editJsonSettings(
  settingsFilePath: string,
  transform: (current: Record<string, unknown>) => Record<string, unknown>,
  /** Shape validator for THIS engine's hook file. Defaults to the Claude/Codex
   *  group shape; Cursor's `hooks.json` nests differently and passes its own. */
  parse: (raw: string | undefined) => HookSettingsParse = parseHookSettings,
): Promise<HookEditOutcome> {
  // Set by the loader when it refuses the document. The loader signals refusal
  // to `updateSharedJson` with `undefined` — the same value it returns for
  // "nothing to do" — so the reason has to come back out of band.
  let rejected: string | undefined
  try {
    await updateSharedJson(
      settingsFilePath,
      (raw) => {
        // Missing file starts empty; an unreadable document abandons the write
        // so we never clobber the engine's config.
        const parsed = parse(raw)
        if (parsed.ok) return parsed.doc
        rejected = parsed.reason
        return undefined
      },
      (current) => {
        const next = transform(current)
        const json = JSON.stringify(next, null, 2)
        return json === JSON.stringify(current, null, 2) ? undefined : `${json}\n`
      },
    )
  } catch (err) {
    return { ok: false, file: settingsFilePath, reason: err instanceof Error ? err.message : String(err) }
  }
  if (rejected !== undefined) return { ok: false, file: settingsFilePath, reason: rejected }
  return { ok: true }
}

export abstract class JsonHookAdapter implements EngineHookAdapter {
  abstract readonly vendor: VendorId
  /** This engine's hook event → neutral verb table (the ONE vendor-specific bit). */
  protected abstract readonly eventMap: readonly HookEventSpec[]
  /** This engine's global hook settings file. */
  abstract globalSettingsPath(): string

  supportsHooks(): boolean {
    return true
  }

  /** Default: no verb carries extra detail. Engines with failure/permission
   *  events (Claude) override this. */
  activityDetailFromPayload(
    _kind: EngineActivityKind,
    _payload: Record<string, unknown>,
  ): EngineActivityDetail | undefined {
    return undefined
  }

  /** Default: no session identity in the payload. Claude and codex both
   *  override — their hooks pipe `session_id`/`transcript_path`. */
  sessionFromPayload(_payload: Record<string, unknown>): EngineSessionRef | undefined {
    return undefined
  }

  /** Default: this engine never installed the legacy `WorktreeCreate` provider
   *  hook, so there's nothing to clean up. Claude overrides both. */
  supportsWorktreeSync(): boolean {
    return false
  }

  async removeWorktreeSyncHook(_settingsFilePath: string): Promise<void> {
    /* no-op unless overridden */
  }

  /** Verbs installed only when something asked for them (tool.* plugin
   *  hooks) — every tool call machine-wide spawns `kobe hook`, so the family
   *  stays out of the engine config until a plugin actually subscribes. */
  protected gatedVerbs(): ReadonlySet<string> {
    return GATED_TOOL_VERBS
  }

  async installActivityHooks(
    settingsFilePath: string,
    opts: { toolEvents?: boolean; quiet?: boolean } = {},
  ): Promise<HookEditOutcome> {
    const gated = this.gatedVerbs()
    const outcome = await editJsonSettings(settingsFilePath, (cur) =>
      mergeActivityHooks(cur, true, this.eventMap, undefined, {
        // Tag with the vendor so `kobe hook` picks the right decoder, and the
        // shape version so a later Rove can spot its own old entries
        // (docs/design/plugin-events.md).
        extraArgs: roveHookArgs(this.vendor),
        buildFilter: (spec) => opts.toolEvents === true || !gated.has(spec.verb),
      }),
    )
    // stderr, not a throw: under `rove daemon` it lands in daemon.log, where
    // `rove doctor` points. Removals stay silent — only this write costs badges.
    if (!outcome.ok && !opts.quiet) {
      process.stderr.write(`[rove hooks] ${this.vendor}: skipped ${outcome.file}: ${outcome.reason}\n`)
    }
    return outcome
  }

  async removeActivityHooks(settingsFilePath: string): Promise<void> {
    await editJsonSettings(settingsFilePath, (cur) => mergeActivityHooks(cur, false, this.eventMap))
  }

  async removeWorktreeWatchHook(settingsFilePath: string): Promise<void> {
    await editJsonSettings(settingsFilePath, dropWorktreeWatchHook)
  }

  /** Doctor's read-only half of {@link installActivityHooks}: the same
   *  validator the install abandons on, so both report one verdict. */
  hookConfigRefusal(raw: string): string | undefined {
    const parsed = parseHookSettings(raw)
    return parsed.ok ? undefined : parsed.reason
  }
}
