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

// Accept literal argv from the current quoter and older bare/double-quoted
// installs. Shell operators, expansions and wrappers are not ours to remove.
const HOOK_WORD = String.raw`(?:'(?:[^']|'\\'')*'|"[^"$\x60\\]*"|[A-Za-z0-9_./:=+-]+)`
const HOOK_ARGV = new RegExp(`^${HOOK_WORD}(?:\\s+${HOOK_WORD})*$`)

function isRoveHook(hook: unknown, verbs: readonly string[]): boolean {
  if (!isObject(hook) || hook.type !== "command" || typeof hook.command !== "string") return false
  const command = hook.command.trim()
  if (!HOOK_ARGV.test(command)) return false
  const words = command.match(new RegExp(HOOK_WORD, "g")) ?? []
  const argv = words.map((word) => {
    if (word.startsWith("'")) return word.slice(1, -1).replaceAll("'\\''", "'")
    if (word.startsWith('"')) return word.slice(1, -1)
    return word
  })
  const executable = argv[0]?.split("/").at(-1)
  let offset = 1
  if (executable === "bun" || executable === "node") {
    if (argv[offset] === "--conditions=browser") offset++
    const entry = argv[offset] ?? ""
    if (!/(?:^|\/)(?:src|dist)\/cli\/(?:rove|kobe)\.(?:ts|js)$/.test(entry)) return false
    offset++
  } else if (executable !== "rove" && executable !== "kobe") {
    return false
  }
  if (argv[offset] !== "hook" || !verbs.includes(argv[offset + 1])) return false
  const rest = argv.slice(offset + 2)
  return rest.length === 0 || (rest.length === 2 && rest[0] === "--engine" && /^[a-z][a-z0-9-]*$/.test(rest[1]))
}

/** A shared group can contain both Rove and user hooks; ownership is per hook. */
export function removeRoveHooks(groups: unknown[], verbs: readonly string[]): unknown[] {
  return groups.flatMap((group) => {
    if (!isObject(group) || !Array.isArray(group.hooks)) return [group]
    const kept = group.hooks.filter((hook) => !isRoveHook(hook, verbs))
    if (kept.length === group.hooks.length) return [group]
    return kept.length > 0 ? [{ ...group, hooks: kept }] : []
  })
}

/** True if a shared settings object still carries any of kobe's activity hook
 *  groups (the same ownership predicate the merge uses). Detection only — the
 *  plugin-migration hint needs a read-side answer without editing the file. */
export function hasKobeActivityHooks(current: Record<string, unknown>, eventMap: readonly HookEventSpec[]): boolean {
  const verbs = eventMap.map((spec) => spec.verb)
  const hooks = isObject(current.hooks) ? current.hooks : {}
  return Object.values(hooks).some(
    (groups) =>
      Array.isArray(groups) &&
      groups.some(
        (group) => isObject(group) && Array.isArray(group.hooks) && group.hooks.some((hook) => isRoveHook(hook, verbs)),
      ),
  )
}

/** Optional knobs shared by the build/merge pair. */
export interface ActivityHookOpts {
  /** Extra argv appended after the verb (e.g. `--engine claude`, so `kobe
   *  hook` decodes the payload with the RIGHT adapter instead of guessing).
   *  Literal argv recognition accepts this suffix as well as legacy
   *  untagged installs. */
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
    const previous = out[event]
    const groups = Array.isArray(previous) ? previous : []
    groups.push(group)
    out[event] = groups
  }
  return out
}

/**
 * Pure merge: add (`install`) or remove kobe's activity hooks in a SHARED
 * settings object, preserving the user's own hooks for those events + every
 * other key. Rove owns only recognized CLI invocations; they are dropped first so re-install is idempotent and removal clean.
 */
export function mergeActivityHooks(
  current: Record<string, unknown>,
  install: boolean,
  eventMap: readonly HookEventSpec[],
  inv: readonly string[] = kobeHookInvocation(),
  opts: ActivityHookOpts = {},
): Record<string, unknown> {
  const verbs = eventMap.map((spec) => spec.verb)
  const { hooks: rawHooks, ...restSettings } = current
  const hooks: Record<string, unknown> = isObject(rawHooks) ? { ...rawHooks } : {}
  const built = install ? buildActivityHooks(eventMap, inv, opts) : {}
  for (const { event } of eventMap) {
    const groups = hooks[event]
    const prior = Array.isArray(groups) ? groups : []
    const kept = removeRoveHooks(prior, verbs)
    const additions = built[event]
    if (install && Array.isArray(additions)) kept.push(...additions)
    if (kept.length > 0) hooks[event] = kept
    else delete hooks[event]
  }
  return Object.keys(hooks).length > 0 ? { ...restSettings, hooks } : { ...restSettings }
}

/**
 * A `PostToolUse` (Bash) hook Rove only ever REMOVES: an observer that fires
 * `kobe hook worktree-created` after every Bash call, machine-wide, for a
 * ~170ms process spawn each time and nothing in return. These two constants
 * exist so {@link removeWorktreeWatchHook} can find and delete the entries
 * already written into users' settings files.
 */
const RETIRED_WATCH_EVENT = "PostToolUse"

/**
 * Pure merge: drop the worktree-watch hook from a SHARED settings
 * object. Removal-only (there is no install counterpart) and
 * merge-safe: it filters only commands naming Rove's verb, so a
 * hand-edited settings file keeps the user's own PostToolUse hooks and every
 * other key untouched. Idempotent — a second pass finds nothing and returns an
 * equal object, so the write is skipped.
 */
export function removeWorktreeWatchHook(current: Record<string, unknown>): Record<string, unknown> {
  const { hooks: rawHooks, ...restSettings } = current
  const hooks: Record<string, unknown> = isObject(rawHooks) ? { ...rawHooks } : {}
  const groups = hooks[RETIRED_WATCH_EVENT]
  const prior = Array.isArray(groups) ? groups : []
  const kept = removeRoveHooks(prior, ["worktree-created"])
  if (kept.length > 0) hooks[RETIRED_WATCH_EVENT] = kept
  else delete hooks[RETIRED_WATCH_EVENT]
  return Object.keys(hooks).length > 0 ? { ...restSettings, hooks } : { ...restSettings }
}
