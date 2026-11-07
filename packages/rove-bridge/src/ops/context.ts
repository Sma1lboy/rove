/**
 * `context.usage`: what one conversation's context window holds, for the side panel's Context tab. The engine's
 * history reader does the arithmetic and, when its transcript records one, the split (`system`, `messages`);
 * this only shapes it into a bar and rows. Nothing to read → `meter: null`, never a zero.
 */

import { type UsageStore, usageStore } from "../usage-store.ts"
import { optText } from "./args.ts"
import type { OpTable } from "./types.ts"

/** One row under the bar; `share` (0..100 of the bar) gives it a segment. */
export interface ContextRow {
  /** `context.part.<key>` in the web's catalog. */
  readonly key: string
  readonly tokens: number
  readonly share?: number
}

export interface ContextMeter {
  /** 0..100 of the window; null when the engine names no window. */
  readonly percent: number | null
  readonly used: number
  readonly window: number | null
  readonly rows: readonly ContextRow[]
  readonly approximate: boolean
}

/** The bar is the window when known, else what is used (the split alone). */
export function contextMeter(usage: UsageStore, session: string): ContextMeter | null {
  const ctx = usage.context(session)
  if (!ctx || ctx.contextTokens <= 0) return null
  const used = ctx.contextTokens
  const window = ctx.contextWindowTokens ?? null
  const share = (n: number) => Math.min(100, (n / (window ?? used)) * 100)
  const rows: ContextRow[] = ctx.parts?.length
    ? ctx.parts.map((part) => ({ key: part.key, tokens: part.tokens, share: share(part.tokens) }))
    : [{ key: "used", tokens: used, share: share(used) }]
  if (window) rows.push({ key: "free", tokens: Math.max(0, window - used) })
  return { percent: window ? share(used) : null, used, window, rows, approximate: ctx.approximate === true }
}

export function createContextOps(usage: UsageStore): OpTable {
  return {
    "context.usage": {
      kind: "read",
      destructive: false,
      wraps: "the bridge usage store's `usage.context` entry for taskId::tabId (the engine history reader's reading)",
      async run(args) {
        const taskId = optText(args, "taskId", 64)
        const tabId = optText(args, "tabId", 32)
        return { meter: taskId && tabId ? contextMeter(usage, `${taskId}::${tabId}`) : null }
      },
    },
  }
}

export const contextOps: OpTable = createContextOps(usageStore)
