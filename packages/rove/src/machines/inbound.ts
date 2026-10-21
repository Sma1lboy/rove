/**
 * What THIS machine lets another machine's hub do to it. A forwarded verb
 * (`api.invoke` with `forwarded: true`) is checked against a deny list of verb
 * classes kept in this machine's own state.json; the hub's word is never the
 * policy. Classes are the verb groups (`rove api schema --group`) plus `land`
 * for the two verbs that send work out (`land`, `publish`). Everything is
 * allowed until denied: landing included, by the owner's decision.
 */

import { VERB_GROUP_IDS } from "../cli/api/types.ts"
import { findVerb } from "../cli/api/verbs.ts"
import { loadStateFile, updateStateFile } from "../state/store.ts"

export const INBOUND_KEY = "machineInbound"
export const INBOUND_CLASSES: readonly string[] = [...VERB_GROUP_IDS, "land"]

const LAND_VERBS: ReadonlySet<string> = new Set(["land", "publish"])

/** The class a verb is judged under; null for a verb this build does not know. */
export function inboundClassOf(verb: string): string | null {
  if (LAND_VERBS.has(verb)) return "land"
  return findVerb(verb)?.group ?? null
}

export function deniedClasses(state: Record<string, unknown> = loadStateFile() as Record<string, unknown>): string[] {
  const raw = state[INBOUND_KEY]
  const deny = raw && typeof raw === "object" ? (raw as { deny?: unknown }).deny : undefined
  return Array.isArray(deny) ? deny.filter((c): c is string => typeof c === "string") : []
}

/** The denied class a forwarded verb falls under, or null when it may run. */
export function inboundRefusal(verb: string, state?: Record<string, unknown>): string | null {
  const cls = inboundClassOf(verb)
  return cls && deniedClasses(state).includes(cls) ? cls : null
}

export function setInbound(cls: string, allow: boolean): string[] {
  let next: string[] = []
  updateStateFile((state) => {
    const current = new Set(deniedClasses(state as Record<string, unknown>))
    if (allow) current.delete(cls)
    else current.add(cls)
    next = [...current].sort()
    ;(state as Record<string, unknown>)[INBOUND_KEY] = { deny: next }
    return true
  })
  return next
}
