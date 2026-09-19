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
  /**
   * Every surface that sizes off the rail reads `useSidebarWidth`, because the
   * width is no longer a function of the terminal alone — a dragged pin lives
   * in the KV store, and a call site that computes from `dims.width` would
   * silently ignore it. The visible failure is a torn layout: the rail moves
   * under the drag and the pane beside it stays where it was.
   */
  it("the workspace host sizes the rail and prefix HUD from the shared hook", () => {
    const host = src("tui-react/workspace/host.tsx")
    expect(host).toContain("useSidebarWidth()")
    expect(host).toContain("<SidebarResizeGrip")
    expect(host).toContain("width={sidebarWidth.width - 2}")
    expect(host).not.toContain("sidebarWidthFor(")
    expect(host).not.toContain("width={pageRender.showContent ? SIDEBAR_WIDTH")
    expect(host).not.toContain("width={SIDEBAR_WIDTH - 2}")
  })

  it("the files pane subtracts the rail width it was HANDED, not one it derives", () => {
    const files = src("tui-react/workspace/host-files-pane.tsx")
    expect(files).toContain("dims.width - props.sidebarWidth")
    expect(files).not.toContain("sidebarWidthFor(")
    expect(files).not.toContain("dims.width - SIDEBAR_WIDTH")
    const host = src("tui-react/workspace/host.tsx")
    expect(host).toContain("sidebarWidth={sidebarWidth.width}")
  })

  it("the rail itself renders at the hook's width", () => {
    const mount = src("tui-react/workspace/host-sidebar-mount.tsx")
    expect(mount).toContain("useSidebarWidth()")
    expect(mount).toContain("sidebarWidth.width")
    expect(mount).not.toContain("sidebarWidthFor(")
  })
})
