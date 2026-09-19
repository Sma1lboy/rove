/**
 * The OTHER shared JSON-hooks shape — flat entries.
 *
 * `./json-hooks.ts` owns the shape Claude Code and Codex share, where each
 * event holds GROUPS and the commands live one level down:
 *
 *   { "hooks": { "<Event>": [ { matcher?, hooks: [ { type, command } ] } ] } }
 *
 * Cursor and GitHub Copilot CLI both read a flatter one — the entry IS the
 * command:
 *
 *   { "version": 1, "hooks": { "<event>": [ { type?, command } ] } }
 *
 * Two engines, one shape, so the merge lives here rather than once per
 * adapter. It is the same three guarantees the nested merge makes: idempotent
 * (a second install replaces rather than appends), merge-safe (a third party's
 * entry, every other event and every other top-level key survive), and
 * ownership decided by {@link isRoveHook} rather than string equality — a dev
 * checkout spells the command `bun /…/src/cli/rove.ts hook …` where a released
 * build spells it `rove hook …`, so literal matching would stack a second
 * entry on the next launch.
 *
 * Pure (no I/O): the read→lock→tmp+rename half is `editJsonSettings` in
 * `./json-hook-adapter.ts`, which both adapters call with the validator below.
 */

import { kobeHookInvocation } from "../cli/invocation.ts"
import { quoteShellArgv } from "../lib/shell-command.ts"
import {
  type HookEventSpec,
  type HookSettingsParse,
  hookCommandQuoting,
  isObject,
  isRoveHook,
  roveHookArgs,
} from "./json-hooks.ts"

/** How one engine spells this shape. */
export interface FlatHookFormat {
  /** Vendor id stamped onto the installed command as `--engine <id>`. */
  readonly vendor: string
  /** This engine's hook event → neutral verb table. */
  readonly eventMap: readonly HookEventSpec[]
  /** Write `"type": "command"` on the entry. Copilot's schema keys the entry
   *  by type (command / http / prompt) and Rove's is a command; cursor's file
   *  has no type field at all. */
  readonly withType?: boolean
}

/**
 * Validate the bytes of a flat hook file for the merge. Same contract as
 * `json-hooks.ts#parseHookSettings`: a missing file is an EMPTY document (the
 * first-install case), and anything we cannot understand is refused with a
 * reason naming the path rather than overwritten.
 */
export function parseFlatHooks(raw: string | undefined): HookSettingsParse {
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
  for (const [event, entries] of Object.entries(parsed.hooks)) {
    if (!Array.isArray(entries)) return { ok: false, reason: `"hooks.${event}" is not an array` }
  }
  return { ok: true, doc: parsed }
}

/**
 * Pure merge: add (`install`) or remove Rove's entries in a flat hooks
 * document. `inv` is injectable for tests.
 */
export function mergeFlatHooks(
  format: FlatHookFormat,
  current: Record<string, unknown>,
  install: boolean,
  inv: readonly string[] = kobeHookInvocation(),
): Record<string, unknown> {
  const verbs = format.eventMap.map((spec) => spec.verb)
  const { hooks: rawHooks, ...rest } = current
  const hooks: Record<string, unknown> = isObject(rawHooks) ? { ...rawHooks } : {}
  const quoting = hookCommandQuoting()
  for (const { event, verb } of format.eventMap) {
    const prior = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []
    const kept = prior.filter((entry) => !isRoveHook(entry, verbs))
    if (install) {
      const command = quoteShellArgv([...inv, "hook", verb, ...roveHookArgs(format.vendor)], quoting)
      kept.push(format.withType ? { type: "command", command } : { command })
    }
    if (kept.length > 0) hooks[event] = kept
    else delete hooks[event]
  }
  // Both engines read `version` as the file's schema marker; a document that
  // lost it (or never had one) is not ours to leave unlabelled.
  return { version: 1, ...rest, hooks }
}
