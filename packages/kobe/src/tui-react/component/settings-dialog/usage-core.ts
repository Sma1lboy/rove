/**
 * Framework-free view model for the Settings usage dashboard (General,
 * top-right corner): turns the daemon's `usage.snapshot` windows into
 * aligned meter rows. Pure — the React component only maps rows to <text>.
 */

import { approxCharCells, displayWidth } from "../../../lib/display-width.ts"
import { ratioBar } from "../../../tui/lib/progress-bar.ts"
import { truncateEndCells } from "../../../tui/lib/truncate.ts"
import type { EngineQuotaUsage } from "../../../types/engine.ts"

/** Meter track width in cells. */
export const USAGE_BAR_WIDTH = 10

/** Severity tone → theme color pick happens in the component. */
type UsageTone = "ok" | "warn" | "crit"

export interface UsageRowView {
  readonly label: string
  readonly bar: string
  readonly percentText: string
  readonly resetText: string
  readonly tone: UsageTone
}

const toneOf = (percent: number): UsageTone => (percent >= 95 ? "crit" : percent >= 75 ? "warn" : "ok")

const pad2 = (n: number): string => String(n).padStart(2, "0")

/**
 * Compact local-time reset stamp: within 24h just the clock ("→ 14:00"),
 * beyond that day+clock ("→ 7/30 14:00"), empty when the vendor reported
 * no reset. Numeric-only on purpose — no locale words to translate.
 */
export function formatReset(resetsAt: number | null, nowMs: number): string {
  if (resetsAt == null || resetsAt <= nowMs) return ""
  const d = new Date(resetsAt)
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (resetsAt - nowMs < 24 * 60 * 60 * 1000) return `→ ${clock}`
  return `→ ${d.getMonth() + 1}/${d.getDate()} ${clock}`
}

/** One window as a footer chip; segmented so only the percent takes the tone color. */
export interface UsageChipView {
  readonly label: string
  readonly percentText: string
  readonly resetText: string
  readonly tone: UsageTone
}

/**
 * Bar-less footer form of {@link usageRows}: `5h 42% → 14:00`. Same tones, no
 * padding: several vendors share one row.
 */
function usageChips(usage: EngineQuotaUsage, nowMs: number): UsageChipView[] {
  return usage.windows.map((w) => ({
    label: w.label,
    percentText: `${w.percent}%`,
    resetText: formatReset(w.resetsAt, nowMs),
    tone: toneOf(w.percent),
  }))
}

/**
 * Narrow-footer form: ONE chip per vendor, the session ("5h", tightest)
 * window, else the first window. Callers drop the reset time at 46 cols.
 */
export function narrowUsageChip(usage: EngineQuotaUsage, nowMs: number): UsageChipView | null {
  const w = usage.windows.find((win) => win.kind === "session") ?? usage.windows[0]
  if (!w) return null
  return {
    label: w.label,
    percentText: `${w.percent}%`,
    resetText: formatReset(w.resetsAt, nowMs),
    tone: toneOf(w.percent),
  }
}

/** One vendor's full chip block in the footer row (label + tone + reset). */
interface FooterVendorFull {
  readonly vendor: string
  readonly chips: UsageChipView[]
}

/** Compact fallback: vendor name + tone percent only (the narrow form). */
interface FooterVendorCompact {
  readonly vendor: string
  readonly percentText: string
  readonly tone: UsageTone
}

export type FooterChipsView =
  | { form: "full"; vendors: FooterVendorFull[] }
  | { form: "compact"; vendors: FooterVendorCompact[] }

/** Cell width of one full chip: `· 7d 12% → 8/4 06:00`-style parts + gaps. */
function fullChipCells(chip: UsageChipView, index: number): number {
  const label = index === 0 ? chip.label : `· ${chip.label}`
  const parts = [displayWidth(label), displayWidth(chip.percentText)]
  if (chip.resetText) parts.push(displayWidth(chip.resetText))
  return parts.reduce((a, b) => a + b, 0) + (parts.length - 1)
}

/** Cell width of one vendor block: name + chips, gap 1 between children. */
function fullVendorCells(vendor: FooterVendorFull): number {
  return (
    displayWidth(vendor.vendor) +
    vendor.chips.reduce((sum, chip, i) => sum + fullChipCells(chip, i), 0) +
    vendor.chips.length
  )
}

/**
 * The footer row's two halves share one line: padding (1+1), the inter-box
 * gap (2), and the hint bar all reserve cells before the chips get any.
 * `hintCells` is the bar's measured width (see host-footer.tsx).
 */
export function usageChipsBudget(opts: { terminalWidth: number; hintCells: number }): number {
  return Math.max(0, opts.terminalWidth - 4 - opts.hintCells)
}

/**
 * Fit the quota chips into `budget` cells: full form if it fits, else compact
 * vendor+percent, truncating the last kept vendor's name and dropping the
 * rest. The percent always survives; the name yields.
 */
export function buildFooterChips(opts: {
  usage: ReadonlyMap<string, EngineQuotaUsage>
  budget: number
  nowMs: number
  vendorLabel: (vendor: string) => string
  forceCompact?: boolean
}): FooterChipsView | null {
  const entries = [...opts.usage.entries()]
    .map(([id, snapshot]) => ({
      vendor: opts.vendorLabel(id).toUpperCase(),
      snapshot,
      chips: usageChips(snapshot, opts.nowMs),
    }))
    .filter((entry) => entry.chips.length > 0)
  if (entries.length === 0) return null
  if (!opts.forceCompact) {
    const fulls: FooterVendorFull[] = entries.map((entry) => ({ vendor: entry.vendor, chips: entry.chips }))
    const total = fulls.reduce((sum, v) => sum + fullVendorCells(v), 0) + (fulls.length - 1) * 2
    if (total <= opts.budget) return { form: "full", vendors: fulls }
  }
  const vendors: FooterVendorCompact[] = []
  let remaining = opts.budget
  for (const entry of entries) {
    const chip = narrowUsageChip(entry.snapshot, opts.nowMs)
    if (!chip) continue
    const gap = vendors.length > 0 ? 2 : 0
    const need = displayWidth(entry.vendor) + 1 + displayWidth(chip.percentText)
    if (need + gap <= remaining) {
      vendors.push({ vendor: entry.vendor, percentText: chip.percentText, tone: chip.tone })
      remaining -= need + gap
      continue
    }
    // Does not fit whole: truncate THIS vendor's name to the remainder
    // (keeping at least `X…`) and drop everything after it.
    const nameBudget = remaining - gap - 1 - displayWidth(chip.percentText)
    if (nameBudget >= 3) {
      vendors.push({
        vendor: truncateEndCells(entry.vendor, nameBudget, approxCharCells),
        percentText: chip.percentText,
        tone: chip.tone,
      })
    }
    break
  }
  return { form: "compact", vendors }
}

/**
 * Context-window chip: `ctx 62%`, or `ctx 62%~` when the engine estimated it.
 * Room left in THIS conversation, before it compacts.
 *
 * `null` with no snapshot, no `contextWindowTokens`, or a zero window. Never
 * guess the denominator from a model name: that is the ADAPTER's arithmetic
 * (CLAUDE.md, "Engine-owned UI data"). Same tones as the quota chips.
 */
export function contextChip(
  usage: { contextTokens: number; contextWindowTokens?: number; approximate?: boolean } | null | undefined,
): UsageChipView | null {
  if (!usage) return null
  const window = usage.contextWindowTokens
  if (window === undefined || window <= 0) return null
  // Clamp: a vendor that reports a prompt slightly over its own advertised
  // window (tool definitions, system prompt) must read as full, not 103%.
  const percent = Math.min(100, Math.max(0, Math.round((usage.contextTokens / window) * 100)))
  return {
    label: "ctx",
    percentText: `${percent}%${usage.approximate ? "~" : ""}`,
    resetText: "",
    tone: toneOf(percent),
  }
}

/**
 * Session token chip: `Σ 45k`, what the conversation has cost so far.
 *
 * `Σ` is prompt + completion. Cache reads/writes (`cacheReadTokens` /
 * `cacheCreationTokens`) are deliberately excluded: a cached prompt can be an
 * order of magnitude larger than the turn that used it.
 *
 * `null` when neither count was reported (a `0` would claim a free session);
 * one missing count is omitted, not treated as a gap. Always muted: a past
 * total has no threshold.
 */
export function tokenTotalChip(
  usage: { inputTokens?: number; outputTokens?: number } | null | undefined,
): { label: string; text: string } | null {
  if (!usage) return null
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) return null
  return { label: "Σ", text: humanTokens((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)) }
}

/** Four cells. Truncate, never round up: `999_999` reads `999k`, not `1.0M`. */
function humanTokens(total: number): string {
  if (total < 1_000) return String(total)
  if (total < 1_000_000) return `${Math.floor(total / 1_000)}k`
  return `${(Math.floor(total / 100_000) / 10).toFixed(1)}M`
}

/**
 * One aligned meter row per window, in the vendor's order. Label column tracks
 * the longest label, capped so one long model name can't push meters off.
 */
export function usageRows(usage: EngineQuotaUsage, nowMs: number): UsageRowView[] {
  const labelWidth = Math.min(
    8,
    usage.windows.reduce((w, win) => Math.max(w, win.label.length), 2),
  )
  return usage.windows.map((w) => ({
    label: (w.label.length > labelWidth ? w.label.slice(0, labelWidth) : w.label).padEnd(labelWidth),
    bar: ratioBar(w.percent / 100, USAGE_BAR_WIDTH),
    percentText: `${String(w.percent).padStart(3)}%`,
    resetText: formatReset(w.resetsAt, nowMs),
    tone: toneOf(w.percent),
  }))
}
