/** Persisted presentation choice for one prefix tap. */
export const PREFIX_TAP_PRESENTATION_KEY = "hints.keyboard.prefixTapPresentation"

export const PREFIX_TAP_PRESENTATIONS = ["local", "guide"] as const
export type PrefixTapPresentation = (typeof PREFIX_TAP_PRESENTATIONS)[number]

export const DEFAULT_PREFIX_TAP_PRESENTATION: PrefixTapPresentation = "local"

/** Missing, malformed, and obsolete values preserve the product default. */
export function normalizePrefixTapPresentation(raw: unknown): PrefixTapPresentation {
  return raw === "guide" ? "guide" : DEFAULT_PREFIX_TAP_PRESENTATION
}
