/**
 * Engine-neutral JSON-hooks merge core. Claude Code
 * (`~/.claude/settings.json`) and Codex (`~/.codex/hooks.json`) share one
 * hook file shape:
 *
 *   { "hooks": { "<Event>": [ { "matcher"?: string,
 *                               "hooks": [ { "type": "command", "command": … } ] } ] } }
 *
 * so install/merge/remove is identical; each adapter passes only its own
 * {@link HookEventSpec}[]. Pure (no I/O).
 */

import { kobeHookInvocation } from "../cli/invocation.ts"
import { type QuoteShellArgvOptions, quoteShellArgv } from "../lib/shell-command.ts"
import type { EngineActivityKind } from "./hook-events.ts"

/**
 * Shape version of the hooks Rove writes into an engine's config, stamped
 * onto every installed command as `--hook-version <n>`.
 *
 * Lets an entry written by an older Rove be told apart from a current one. An
 * entry with no flag reads as `outdated`, not a parse failure
 * (`integration-status.ts`).
 *
 * BUMP when an old entry gets the shape wrong: a verb renamed or retired, an
 * event remapped, the argv contract changed. Don't bump otherwise — every
 * bump rewrites every user's engine config on next launch.
 */
export const ROVE_HOOK_VERSION = 1

/** Argv every adapter appends after the verb: which engine decodes the payload
 *  and which shape wrote the entry. */
export function roveHookArgs(vendor: string): readonly string[] {
  return ["--engine", vendor, "--hook-version", String(ROVE_HOOK_VERSION)]
}

/** Verbs installed only while a plugin subscribes to tool.* hooks (volume gate);
 *  shared by the JSON- and TOML-shaped adapters. */
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

/**
 * Whether a hook merge reached the settings file. Returned, not thrown: every
 * caller is best-effort and continues — but must still name the file, since a
 * silently skipped install just looks slow (badges fall back to the ~10s poll).
 */
export type HookEditOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly file: string; readonly reason: string }

/**
 * A settings document the hook merge may run on, or why not. Rejecting is
 * deliberate — never clobber a config we can't understand — and the reason
 * names the offending path, since a rejected file silently stops hook installs.
 */
export type HookSettingsParse =
  | { readonly ok: true; readonly doc: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string }

/**
 * Validate a shared settings file for the hook merge. Missing (`undefined`) is
 * an empty document, not a rejection. Shared with `cli/doctor-hook-channel.ts`
 * so doctor gives the same verdict.
 */
export function parseHookSettings(raw: string | undefined): HookSettingsParse {
  if (raw === undefined) return { ok: true, doc: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { ok: false, reason: `not valid JSON (${err instanceof Error ? err.message : String(err)})` }
  }
  if (!isObject(parsed)) return { ok: false, reason: "top level is not a JSON object" }
  if (parsed.hooks === undefined) return { ok: true, doc: parsed }
  if (!isObject(parsed.hooks)) return { ok: false, reason: '"hooks" is not an object' }
  for (const [event, groups] of Object.entries(parsed.hooks)) {
    if (!Array.isArray(groups)) return { ok: false, reason: `"hooks.${event}" is not an array` }
    const bad = groups.findIndex((group) => !isObject(group) || !Array.isArray(group.hooks))
    if (bad >= 0) return { ok: false, reason: `"hooks.${event}[${bad}]" is not an object with a "hooks" array` }
  }
  return { ok: true, doc: parsed }
}

// Accept literal argv from the current quoter and older bare/double-quoted
// installs. Shell operators, expansions and wrappers are not ours to remove.
const HOOK_WORD = String.raw`(?:'(?:[^']|'\\'')*'|"[^"$\x60\\]*"|[A-Za-z0-9_./:=+-]+)`
const HOOK_ARGV = new RegExp(`^${HOOK_WORD}(?:[ \t]+${HOOK_WORD})*$`)

/** Flags Rove appends after the verb, and what each accepts as a value. */
const ROVE_HOOK_FLAGS: Readonly<Record<string, RegExp>> = {
  "--engine": /^[a-z][a-z0-9-]*$/,
  "--hook-version": /^\d+$/,
}

/**
 * Is this hook entry a recognized `rove hook <verb>` invocation? Ownership,
 * not string equality: a dev checkout spells it `bun /…/src/cli/rove.ts hook …`,
 * and literal matching would leave a duplicate instead of replacing it.
 *
 * `type` is optional: Claude/Codex write `{ "type": "command", … }`, Cursor's
 * `~/.cursor/hooks.json` a bare `{ "command": … }`. Any other `type` is
 * somebody else's.
 */
export function isRoveHook(hook: unknown, verbs: readonly string[]): boolean {
  if (!isObject(hook) || typeof hook.command !== "string") return false
  if (hook.type !== undefined && hook.type !== "command") return false
  const command = hook.command.replace(/^[ \t]+|[ \t]+$/g, "")
  if (HOOK_ARGV.exec(command)?.[0] !== command) return false
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
  // Every known trailing flag is a pair. An empty tail or bare `--engine <id>`
  // (older installs) is still ours, so an upgrade rewrites instead of duplicating.
  const rest = argv.slice(offset + 2)
  for (let i = 0; i < rest.length; i += 2) {
    const value = rest[i + 1]
    const pattern = ROVE_HOOK_FLAGS[rest[i] ?? ""]
    if (!pattern || value === undefined || !pattern.test(value)) return false
  }
  return true
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

/** True if a shared settings object still carries any of kobe's activity hooks.
 *  Read-only, for the plugin-migration hint. */
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
  /** Extra argv after the verb (e.g. `--engine claude`, so `kobe hook` decodes
   *  with the right adapter instead of guessing). */
  readonly extraArgs?: readonly string[]
  /** When present, only specs passing the filter are INSTALLED; every spec
   *  still participates in removal (so disabling a gated family cleans up). */
  readonly buildFilter?: (spec: HookEventSpec) => boolean
}

/**
 * How a persisted hook command line is quoted. Bare tokens wherever possible:
 * `kobe hook turn-complete --engine codex` is one command in sh, cmd.exe AND
 * PowerShell, whereas `'kobe' 'hook' …` is a program named `'kobe'` to cmd
 * and a string literal to PowerShell (Windows hooks fail silently). Tokens
 * that still need quoting get the platform's own dialect.
 */
export function hookCommandQuoting(platform: NodeJS.Platform = process.platform): QuoteShellArgvOptions {
  return { bareSafe: true, windows: platform === "win32" }
}

/** Build the activity hook groups kobe installs, pointing each event at
 *  `kobe hook <verb>` (cwd-based; no task id). `inv` is injectable for tests. */
export function buildActivityHooks(
  eventMap: readonly HookEventSpec[],
  inv: readonly string[] = kobeHookInvocation(),
  opts: ActivityHookOpts = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const quoting = hookCommandQuoting()
  for (const spec of eventMap) {
    if (opts.buildFilter && !opts.buildFilter(spec)) continue
    const { event, matcher, verb } = spec
    const command = quoteShellArgv([...inv, "hook", verb, ...(opts.extraArgs ?? [])], quoting)
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
 * Event of the retired `kobe hook worktree-created` observer (a ~170ms spawn
 * after every Bash call, machine-wide), which Rove now only removes.
 */
const RETIRED_WATCH_EVENT = "PostToolUse"

/**
 * Pure merge: drop the worktree-watch hook from a shared settings object,
 * keeping the user's own PostToolUse hooks and every other key. Idempotent —
 * a second pass returns an equal object, so the write is skipped.
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
