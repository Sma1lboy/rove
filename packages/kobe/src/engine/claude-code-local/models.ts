/**
 * Claude-code model catalog + context-window math.
 *
 * Anthropic publishes model ids and ships new ones regularly — when an
 * id is rotated, edit this list rather than relying on aliases
 * (`fable`/`opus`/`sonnet`), which the CLI resolves to the latest of a
 * family at *its* runtime, not ours, and would make the displayed label
 * drift away from what the engine actually loaded.
 *
 * No "default / claude-code" pseudo-entry: claude-code itself doesn't
 * surface one — the unpinned state simply resolves to whatever
 * `getDefaultMainLoopModelSetting` picks for the account's plan. The
 * footer shows that real name; the picker lists real models only.
 */

import type { ModelChoice, ModelEffortLevel } from "@/types/engine"

const CLAUDE_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly ModelEffortLevel[]

/**
 * The effort ladder is only offered on the reasoning-tier families
 * claude-code accepts `--effort` for (Fable 5, Opus 4.7+, Sonnet 5).
 * Sonnet is left off the ladder here to keep the picker short — pin the
 * plain entry and the CLI uses its own default effort.
 */
function effortChoices(id: string, label: string): readonly ModelChoice[] {
  return CLAUDE_EFFORT_LEVELS.map((effort) => ({
    vendor: "claude",
    id,
    effort,
    level: effort,
    label: `${label} · ${effort}`,
    hint: effort === "max" ? "deepest reasoning" : `${effort} effort`,
  }))
}

export const CLAUDE_MODELS: readonly ModelChoice[] = [
  { vendor: "claude", id: "claude-fable-5-1", label: "Fable 5.1", hint: "most capable, hardest tasks" },
  ...effortChoices("claude-fable-5-1", "Fable 5.1"),
  { vendor: "claude", id: "claude-opus-5[1m]", label: "Opus 5 1M", hint: "long context, default" },
  ...effortChoices("claude-opus-5[1m]", "Opus 5 1M"),
  { vendor: "claude", id: "claude-opus-5", label: "Opus 5", hint: "everyday complex tasks" },
  ...effortChoices("claude-opus-5", "Opus 5"),
  { vendor: "claude", id: "claude-sonnet-5[1m]", label: "Sonnet 5 1M", hint: "long context" },
  { vendor: "claude", id: "claude-sonnet-5", label: "Sonnet 5", hint: "efficient for routine tasks" },
  { vendor: "claude", id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", hint: "fastest, cheapest" },
] as const

const LONG_CTX = 1_000_000
const STD_CTX = 200_000

/**
 * Max context tokens for a Claude model id. The only context-window variant
 * across the catalog (and ad-hoc pinned ids) is the `[1m]` suffix — the
 * 1M-context build; everything else is the standard 200k window.
 *
 * ponytail: matched loosely (`/1m/i`) so variant spellings (`[1M]`, a bare
 * `-1m`) still resolve. No catalog id contains an incidental `1m`.
 */
export function claudeContextWindowFor(modelId: string): number {
  return /1m/i.test(modelId) ? LONG_CTX : STD_CTX
}
