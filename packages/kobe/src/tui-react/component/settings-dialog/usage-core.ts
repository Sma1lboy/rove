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

/**
 * One window rendered as a compact chip (the workspace footer line), split
 * into segments so the footer can color the percent by tone — mirroring the
 * Settings dashboard — while label/reset stay muted.
 */
export interface UsageChipView {
  readonly label: string
  readonly percentText: string
  readonly resetText: string
  readonly tone: UsageTone
}

/**
 * Bar-less one-line form of {@link usageRows} for the workspace footer:
 * `5h 42% → 14:00`. Same tone thresholds, no padding — the footer packs
 * several vendors onto one row, so every cell has to earn its width.
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
 * Narrow-footer form: ONE chip per vendor, pinned to the
 * session window — the "5h" rolling window every vendor reports as its
 * tightest budget — falling back to the vendor's first window when no
 * session window exists. Reset time is dropped; at 46 cols only the
 * tone-colored percent earns its cells.
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
 * Fit the quota chips into `budget` cells, degrading instead of overflowing:
 * full label/reset form when it fits, the compact vendor+percent form when
 * it doesn't, truncating the LAST kept vendor's name to soak up the
 * remainder and dropping vendors past it. The percent is the payload — it
 * survives every squeeze; the vendor name is what yields.
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
 * The context-window chip — `ctx 62%`, or `ctx 62%~` when the figure is the
 * engine's own estimate rather than a number it reports.
 *
 * Answers a different question from the quota chips beside it: those say how
 * much budget is left this week, this says how much room is left in THIS
 * conversation. The moment it runs out the session compacts and the agent
 * quietly loses the context you spent an hour building; the first symptom is
 * a worse answer.
 *
 * `null` — render nothing — in three cases, and all three are the same honest
 * refusal: no snapshot, no `contextWindowTokens` (only some vendors report the
 * model's window, and a percentage of an unknown denominator is a made-up
 * number), or a window of zero. The neutral layer must NOT guess the
 * denominator from a model name: what a vendor counts toward its context is
 * the ADAPTER's arithmetic (CLAUDE.md, "Engine-owned UI data").
 *
 * Same three tones as the quota chips, so one glance reads both halves of the
 * footer the same way. Pure — unit-tested.
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
 * One aligned meter row per quota window, in the vendor's own order (the
 * usage API lists session before weekly). Label column width tracks the
 * longest label (scoped windows carry model display names) with a hard cap
 * so one long name can't push the meters off the dialog.
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
