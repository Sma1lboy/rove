import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Layout wiring contracts. The logic behind these fixes lives in pure,
 * unit-tested modules (usage-core, view-core, display-width, rule-divider) — but a pure module can be perfectly correct while a
 * component stops CALLING it. These tests pin the call sites: they go red
 * the moment a magic literal or a fixed width sneaks back into the tree.
 */

const src = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)), "utf8")

describe("divider rules never hardcode a repeat count", () => {
  it.each(["tui-react/panes/sidebar/chrome.tsx", "tui-react/component/automations-page.tsx"])(
    "%s renders rules through dividerRule",
    (file) => {
      const source = src(file)
      expect(source).toContain("dividerRule(")
      expect(source).not.toMatch(/"─"\.repeat\(\d+\)/)
    },
  )

  it("dividerRule always covers at least the terminal width", async () => {
    const { dividerRule } = await import("../../src/tui-react/lib/rule-divider.ts")
    expect(dividerRule(300)).toBe("─".repeat(300))
    expect(dividerRule(80)).toBe("─".repeat(80))
    expect(dividerRule(0)).toBe("─")
  })
})

describe("sidebar width is responsive, not a fixed rail", () => {
  it("the workspace host sizes the rail and prefix HUD from sidebarWidthFor", () => {
    const host = src("tui-react/workspace/host.tsx")
    expect(host).toContain("sidebarWidthFor(dims.width)")
    expect(host).not.toContain("width={pageRender.showContent ? SIDEBAR_WIDTH")
    expect(host).not.toContain("width={SIDEBAR_WIDTH - 2}")
  })

  it("the files pane subtracts the responsive rail width", () => {
    const files = src("tui-react/workspace/host-files-pane.tsx")
    expect(files).toContain("sidebarWidthFor(dims.width)")
    expect(files).not.toContain("dims.width - SIDEBAR_WIDTH")
  })
})
