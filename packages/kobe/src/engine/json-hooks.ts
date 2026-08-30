/**
 * Shared JSON-hooks merge core (KOB) — the engine-neutral half of the hook
 * adapters.
 *
 * Claude Code (`~/.claude/settings.json`) and Codex (`~/.codex/hooks.json`)
 * happen to share the SAME hook file shape:
 *
 *   { "hooks": { "<Event>": [ { "matcher"?: string,
 *                               "hooks": [ { "type": "command", "command": … } ] } ] } }
 *
 * so the install/merge/remove mechanics (tag kobe's own groups, replace only
 * those, preserve the user's hooks + every other key, drop empties) are
 * identical. Only the EVENT→verb table differs per engine. This module owns the
 * mechanics; each adapter passes its own {@link HookEventSpec}[] and keeps the
 * vendor's event-name vocabulary. Pure (no I/O), so it's unit-tested directly.
 */

import { kobeHookInvocation } from "../cli/invocation.ts"
import { quoteShellArgv } from "../lib/shell-command.ts"
import type { EngineActivityKind } from "./hook-events.ts"

/** Verbs installed only while a plugin subscribes to tool.* hooks (volume gate).
 *  Defined once here so JSON-shaped and TOML-shaped adapters share the same
 *  gated set and a future change cannot drift between them. */
export const GATED_TOOL_VERBS: ReadonlySet<string> = new Set(["tool-pre", "tool-post", "tool-failed"])

/** One engine hook event mapped to a normalized kobe verb. `matcher` narrows
 *  which sub-events fire (e.g. only permission notifications). */
export interface HookEventSpec {
  readonly event: string
  readonly matcher?: string
  readonly verb: EngineActivityKind
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

/** The `hook <verb>` fragments a kobe activity command may have been written
 *  with, independent of the CLI invocation prefix: the current shell-quoted
 *  `'hook' '<verb>'` form AND the legacy unquoted `hook <verb>` form. Early
 *  kobe wrote the unquoted form; recognizing only the quoted one left those
 *  stale entries behind on every re-install, so upgraded users had every
 *  event firing twice (double `kobe hook` spawns + duplicate daemon reports). */
function activityMarkers(eventMap: readonly HookEventSpec[]): string[] {
  return eventMap.flatMap((e) => [quoteShellArgv(["hook", e.verb]), `hook ${e.verb}`])
}

/** True if a hook group is one of kobe's activity groups (by its `kobe hook
 *  <verb>` command substring). */
function isKobeActivityGroup(group: unknown, markers: readonly string[]): boolean {
  if (!isObject(group) || !Array.isArray(group.hooks)) return false
  return group.hooks.some(
    (h) => isObject(h) && typeof h.command === "string" && markers.some((m) => (h.command as string).includes(m)),
  )
}

/** True if a shared settings object still carries any of kobe's activity hook
 *  groups (the same ownership predicate the merge uses). Detection only — the
 *  plugin-migration hint needs a read-side answer without editing the file. */
export function hasKobeActivityHooks(current: Record<string, unknown>, eventMap: readonly HookEventSpec[]): boolean {
  const markers = activityMarkers(eventMap)
  const hooks = isObject(current.hooks) ? current.hooks : {}
  return Object.values(hooks).some(
    (groups) => Array.isArray(groups) && groups.some((g) => isKobeActivityGroup(g, markers)),
  )
}

/** Optional knobs shared by the build/merge pair. */
export interface ActivityHookOpts {
  /** Extra argv appended after the verb (e.g. `--engine claude`, so `kobe
   *  hook` decodes the payload with the RIGHT adapter instead of guessing).
   *  Marker matching keys on the `hook <verb>` substring, so tagged and
   *  legacy untagged installs merge/remove identically. */
  readonly extraArgs?: readonly string[]
  /** When present, only specs passing the filter are INSTALLED; every spec
   *  still participates in removal (so disabling a gated family cleans up). */
  readonly buildFilter?: (spec: HookEventSpec) => boolean
}

/** Build the activity hook groups kobe installs, pointing each event at
 *  `kobe hook <verb>` (cwd-based; no task id). `inv` is injectable for tests. */
export function buildActivityHooks(
  eventMap: readonly HookEventSpec[],
  inv: readonly string[] = kobeHookInvocation(),
  opts: ActivityHookOpts = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of eventMap) {
    if (opts.buildFilter && !opts.buildFilter(spec)) continue
    const { event, matcher, verb } = spec
    const command = quoteShellArgv([...inv, "hook", verb, ...(opts.extraArgs ?? [])])
    const group: Record<string, unknown> = { hooks: [{ type: "command", command }] }
    if (matcher) group.matcher = matcher
    // Accumulate — one event may carry several matcher-scoped specs (e.g.
    // Notification: permission_prompt + idle_prompt).
    const groups = (out[event] as unknown[] | undefined) ?? []
    groups.push(group)
    out[event] = groups
  }
  return out
}

/**
 * Pure merge: add (`install`) or remove kobe's activity hooks in a SHARED
 * settings object, preserving the user's own hooks for those events + every
 * other key. kobe owns only the groups whose command matches an activity
 * marker; they're dropped first so re-install is idempotent and removal clean.
 */
export function mergeActivityHooks(
  current: Record<string, unknown>,
  install: boolean,
  eventMap: readonly HookEventSpec[],
  inv: readonly string[] = kobeHookInvocation(),
  opts: ActivityHookOpts = {},
): Record<string, unknown> {
  const markers = activityMarkers(eventMap)
  const { hooks: rawHooks, ...restSettings } = current
  const hooks: Record<string, unknown> = isObject(rawHooks) ? { ...rawHooks } : {}
  const built = install ? buildActivityHooks(eventMap, inv, opts) : {}
  for (const { event } of eventMap) {
    const prior = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []
    const kept = prior.filter((g) => !isKobeActivityGroup(g, markers))
    if (install && Array.isArray(built[event])) kept.push(...(built[event] as unknown[]))
    if (kept.length > 0) hooks[event] = kept
    else delete hooks[event]
  }
  return Object.keys(hooks).length > 0 ? { ...restSettings, hooks } : { ...restSettings }
}

/**
 * The `PostToolUse` (Bash) hook Rove used to install: an observer that fired
 * `kobe hook worktree-created` after EVERY Bash call, machine-wide, to archive
 * the task pinned to a removed worktree. Archive was removed (issue #75), so
 * the hook had nothing left to do — it just paid a ~170ms process spawn on
 * every Bash call of every session. Retired 2026-08-30; these two constants
 * survive only so {@link removeWorktreeWatchHook} can find and delete the
 * entries already written into users' settings files.
 */
const RETIRED_WATCH_EVENT = "PostToolUse"
export const WORKTREE_WATCH_MARKER = "worktree-created"

/** True if a PostToolUse group is the retired Rove worktree-watch hook.
 *  Keys on the command substring, so both the quoted (`'hook'
 *  'worktree-created'`) and legacy unquoted install forms are matched — and
 *  nothing else in the file is (a user's own PostToolUse hooks, and the hooks
 *  other tools install, never carry this verb). */
function isRetiredWatchGroup(group: unknown): boolean {
  if (!isObject(group) || !Array.isArray(group.hooks)) return false
  return group.hooks.some(
    (h) => isObject(h) && typeof h.command === "string" && (h.command as string).includes(WORKTREE_WATCH_MARKER),
  )
}

/**
 * Pure merge: drop the retired worktree-watch hook from a SHARED settings
 * object. Removal-only (there is no install counterpart any more) and
 * merge-safe: it filters ONLY the groups whose command names Rove's verb, so a
 * hand-edited settings file keeps the user's own PostToolUse hooks and every
 * other key untouched. Idempotent — a second pass finds nothing and returns an
 * equal object, so the write is skipped.
 */
export function removeWorktreeWatchHook(current: Record<string, unknown>): Record<string, unknown> {
  const { hooks: rawHooks, ...restSettings } = current
  const hooks: Record<string, unknown> = isObject(rawHooks) ? { ...rawHooks } : {}
  const prior = Array.isArray(hooks[RETIRED_WATCH_EVENT]) ? (hooks[RETIRED_WATCH_EVENT] as unknown[]) : []
  const kept = prior.filter((g) => !isRetiredWatchGroup(g))
  if (kept.length > 0) hooks[RETIRED_WATCH_EVENT] = kept
  else delete hooks[RETIRED_WATCH_EVENT]
  return Object.keys(hooks).length > 0 ? { ...restSettings, hooks } : { ...restSettings }
}
