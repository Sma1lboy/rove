/**
 * `context.usage`: what one conversation's context window holds, for the side panel's Context tab. The engine's
 * history reader does the arithmetic and the split (its transcript's `system` / `messages`, or the engine's own
 * breakdown once `probe` asked for it); this only shapes it into a bar and rows. Nothing to read → `meter: null`,
 * never a zero.
 */

import type { EngineContextUsage } from "@sma1lboy/rove-daemon/daemon/contracts"
import { type UsageStore, usageStore } from "../usage-store.ts"
import { optText } from "./args.ts"
import type { OpTable } from "./types.ts"

/** One row under the bar; `share` (0..100 of the bar) gives it a segment. */
export interface ContextRow {
  /** `context.part.<key>` in the web's catalog. */
  readonly key: string
  readonly tokens: number
  readonly share?: number
  /** The engine's own name for the part, for a key the catalog does not word. */
  readonly label?: string
  /** The largest things in the part, biggest first. */
  readonly items?: readonly { readonly name: string; readonly tokens: number }[]
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
export function contextMeter(ctx: EngineContextUsage | null): ContextMeter | null {
  if (!ctx || ctx.contextTokens <= 0) return null
  const used = ctx.contextTokens
  const window = ctx.contextWindowTokens ?? null
  const share = (n: number) => Math.min(100, (n / (window ?? used)) * 100)
  const rows: ContextRow[] = ctx.parts?.length
    ? ctx.parts.map((part) => ({ ...part, share: share(part.tokens) }))
    : [{ key: "used", tokens: used, share: share(used) }]
  if (window) rows.push({ key: "free", tokens: Math.max(0, window - used) })
  return { percent: window ? share(used) : null, used, window, rows, approximate: ctx.approximate === true }
}

export function createContextOps(usage: UsageStore): OpTable {
  return {
    "context.usage": {
      kind: "read",
      destructive: false,
      wraps:
        "daemon RPC `engine.contextUsage` (the engine history reader's reading; `probe` first asks the engine for its own breakdown), else the usage store's `usage.context` entry",
      async run(args, ctx) {
        const taskId = optText(args, "taskId", 64)
        const tabId = optText(args, "tabId", 32)
        if (!taskId || !tabId) return { meter: null }
        // A task on another machine has no session in this daemon; the store's pushed reading covers it.
        const fresh = await ctx.api
          .rpc<{ usage: EngineContextUsage | null }>("engine.contextUsage", {
            taskId,
            tabId,
            probe: args.probe === true,
          })
          .catch(() => null)
        return { meter: contextMeter(fresh?.usage ?? usage.context(`${taskId}::${tabId}`)) }
      },
    },
  }
}

export const contextOps: OpTable = createContextOps(usageStore)
