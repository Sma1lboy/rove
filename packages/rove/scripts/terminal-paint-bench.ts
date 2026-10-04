/** bun scripts/terminal-paint-bench.ts — compare full-content replacement
 * with retained rows through the real OpenTUI renderer. Not a visual gate. */
import { BoxRenderable, StyledText, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { TerminalRowPainter } from "../src/tui-react/panes/terminal/terminal-row-painter"
import type { TerminalRow } from "../src/tui/panes/terminal/pty-types"
import { rowsToStyledText } from "../src/tui/panes/terminal/sgr-to-text-chunk"
import { resolveInverseAttributes, sealRowEndAttributes } from "../src/tui/panes/terminal/terminal-render"

const colors = { foreground: [234, 231, 223], background: [20, 20, 19] } as const
const width = 120
const height = 40
const rounds = 1000
const percentile = (values: number[], p: number) => values.sort((a, b) => a - b)[Math.floor(values.length * p)]

for (const mode of ["whole-content", "retained-rows"] as const) {
  const view = await createTestRenderer({ width, height })
  const grid = new BoxRenderable(view.renderer, { width, height })
  view.renderer.root.add(grid)
  const text = new TextRenderable(view.renderer, { wrapMode: "none", selectable: false })
  const painter = new TerminalRowPainter(grid, view.renderer)
  if (mode === "whole-content") grid.add(text)
  const rows: TerminalRow[] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: 20 }, (_, x) => ({
      text: `${y.toString().padStart(2, "0")}:${x.toString().padStart(2, "0")} `,
      fg: colors.foreground,
      bg: colors.background,
    })),
  )
  const times: number[] = []
  const paintTimes: number[] = []
  let cpu = process.cpuUsage()
  try {
    for (let i = 0; i < rounds + 100; i++) {
      if (i === 100) cpu = process.cpuUsage()
      rows[height - 1] = [{ text: `PERF> ${i}`, fg: colors.foreground }]
      const start = performance.now()
      if (mode === "whole-content") {
        const resolved = resolveInverseAttributes(rows, colors.foreground, colors.background)
        text.content = new StyledText(
          rowsToStyledText(sealRowEndAttributes(resolved, width, colors.foreground, colors.background)),
        )
      } else {
        painter.paint(rows, width, colors)
      }
      const painted = performance.now()
      await view.renderOnce()
      if (i >= 100) {
        paintTimes.push(painted - start)
        times.push(performance.now() - start)
      }
    }
    const used = process.cpuUsage(cpu)
    console.log(
      JSON.stringify({
        mode,
        width,
        height,
        rounds,
        paintP50Ms: percentile(paintTimes, 0.5),
        frameP50Ms: percentile(times, 0.5),
        frameP95Ms: percentile(times, 0.95),
        cpuMs: (used.user + used.system) / 1000,
      }),
    )
  } finally {
    painter.dispose()
    if (!text.isDestroyed) text.destroy()
    view.renderer.destroy()
  }
}
