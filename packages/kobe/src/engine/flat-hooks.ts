/**
 * The flat JSON-hooks shape (Cursor, GitHub Copilot CLI), where the entry IS
 * the command:
 *
 *   { "version": 1, "hooks": { "<event>": [ { type?, command } ] } }
 *
 * vs the grouped Claude/Codex shape in `./json-hooks.ts`:
 *
 *   { "hooks": { "<Event>": [ { matcher?, hooks: [ { type, command } ] } ] } }
 *
 * Same guarantees as the nested merge: idempotent, merge-safe (third-party
 * entries, other events and keys survive), and ownership by {@link isRoveHook}
 * rather than string equality — a dev checkout spells the command
 * `bun /…/src/cli/rove.ts hook …`, a release `rove hook …`.
 *
 * Pure: the I/O half is `editJsonSettings` in `./json-hook-adapter.ts`.
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
  /** Write `"type": "command"` (Copilot keys entries by type; cursor has no type field). */
  readonly withType?: boolean
}

/** Same contract as `json-hooks.ts#parseHookSettings`: missing file = EMPTY
 *  document; anything not understood is refused with a reason, never overwritten. */
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

/** Add (`install`) or remove Rove's entries. */
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
  // Both engines read `version` as the schema marker.
  return { version: 1, ...rest, hooks }
}
