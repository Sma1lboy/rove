/** @jsxImportSource @opentui/react */
import { type RGBA, TextAttributes } from "@opentui/core"
import { charWidth } from "../../lib/display-width"
import { SHIMMER_CREST, shimmerInk, shimmerIntensity } from "../../tui/lib/shimmer"

/** `label` as per-glyph spans lit by the shimmer band at `tick`; wide glyphs count by cells. */
export function ShimmerLabel(props: {
  readonly label: string
  readonly tick: number
  readonly muted: RGBA
  readonly accent: RGBA
}) {
  const glyphs: { text: string; cell: number; width: number }[] = []
  let cells = 0
  for (const ch of props.label) {
    const width = charWidth(ch.codePointAt(0) ?? 0)
    const last = glyphs[glyphs.length - 1]
    // A zero-width mark rides on the glyph it combines with.
    if (width === 0 && last) last.text += ch
    else glyphs.push({ text: ch, cell: cells, width })
    cells += width
  }
  return glyphs.map((glyph, i) => {
    const intensity = shimmerIntensity(glyph.cell + (glyph.width - 1) / 2, cells, props.tick)
    return (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: glyph order is the identity
        key={i}
        fg={shimmerInk(props.muted, props.accent, intensity)}
        attributes={intensity >= SHIMMER_CREST ? TextAttributes.BOLD : undefined}
      >
        {glyph.text}
      </span>
    )
  })
}
