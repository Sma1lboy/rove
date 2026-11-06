/** The Usage tab's meters (`quota.list`), and the pure bits of drawing one: bar segments and swatch colours. */

export interface QuotaPart {
  readonly label?: string
  readonly labelKey?: string
  readonly value: string
  readonly share?: number
  readonly resetsAt?: number | null
}

export interface QuotaMeter {
  readonly id: string
  readonly source: "context" | "engine" | "e2b"
  readonly title?: string
  readonly titleKey?: string
  readonly percent: number
  readonly amount: string
  readonly resetsAt: number | null
  readonly expiresAt?: number
  readonly parts: readonly QuotaPart[]
  readonly note?: { readonly key: "estimated" | "approximate"; readonly since?: number; readonly error?: string }
}

export interface QuotaReply {
  readonly meters: readonly QuotaMeter[]
  readonly engineReported: boolean
}

/** Segment colours in part order, as the reference's legend: theme roles, never literal hex. */
const PALETTE = ["var(--info)", "var(--accent)", "var(--success)", "var(--warning)", "var(--error)"] as const

/** A single-figure meter (an engine window) fills by how close it is to its limit. */
export function toneOf(percent: number): string {
  if (percent >= 90) return "var(--error)"
  if (percent >= 70) return "var(--warning)"
  return "var(--accent)"
}

export interface Segment {
  readonly width: number
  readonly color: string
}

/** The bar: one segment per part with a share; a meter with none fills to its percent in its tone. */
export function segmentsOf(meter: QuotaMeter): readonly Segment[] {
  const shared = meter.parts.filter((part) => part.share !== undefined)
  if (shared.length === 0) return [{ width: clamp(meter.percent), color: toneOf(meter.percent) }]
  return shared.map((part, i) => ({ width: clamp(part.share ?? 0), color: PALETTE[i % PALETTE.length] }))
}

/** The legend swatch: a part with a segment gets that segment's colour; the rest a quiet grey. */
export function swatchOf(meter: QuotaMeter, index: number): string | null {
  const part = meter.parts[index]
  if (part?.share === undefined) return null
  const at = meter.parts.slice(0, index).filter((p) => p.share !== undefined).length
  return PALETTE[at % PALETTE.length]
}

export function percentText(n: number): string {
  if (n > 0 && n < 0.1) return "<0.1%"
  return `${n < 10 ? +n.toFixed(1) : Math.round(n)}%`
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n))
}
