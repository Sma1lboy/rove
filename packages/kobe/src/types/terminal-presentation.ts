/** Engine-owned presentation adjustments applied by the embedded terminal renderer. */

export type TerminalRgb = readonly [number, number, number]

export interface TerminalPresentationPalette {
  readonly foreground: `#${string}`
  readonly background: `#${string}`
}

/** Exact cell-style substitution. A rewrite only matches default foreground text. */
export interface TerminalStyleRewrite {
  readonly matchBackground: TerminalRgb
  readonly foreground: TerminalRgb
  readonly background: TerminalRgb
}

/**
 * Vendor-specific visual knowledge compiled into renderer-neutral cell rules.
 * Only the alternate screen receives these rules; the normal composer screen
 * keeps the terminal application's native styling.
 */
export interface EngineTerminalPresentation {
  alternateScreenStyleRewrites(palette: TerminalPresentationPalette): readonly TerminalStyleRewrite[]
}
