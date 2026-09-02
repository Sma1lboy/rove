export type HarnessRenderer = "automatic" | "dom"

/**
 * Captures use xterm's custom-glyph renderers by default. They draw block and
 * box glyphs as geometry, while the DOM renderer draws them from the font and
 * leaves visible gaps between cells. Keep DOM available only for renderer
 * comparisons and environments that need an explicit diagnostic fallback.
 */
export function resolveHarnessRenderer(
  search: URLSearchParams,
): HarnessRenderer {
  return search.get("renderer") === "dom" ? "dom" : "automatic"
}
