import { expect, test } from "bun:test"
import { BUNDLED_THEMES, type ThemeJson } from "@sma1lboy/rove-core/theme/theme-data.ts"
import { palette, taskColors } from "../src/ops/theme-palette.ts"

test("claude dark palette output is pinned", () => {
  const p = palette(BUNDLED_THEMES.claude as ThemeJson, "dark")
  expect([p.diffAddedColorblind, p.diffAddedBgColorblind]).toEqual(["#7ec9ca", "#1c292b"])
  expect(taskColors(BUNDLED_THEMES.claude as ThemeJson, "dark", ["task-a", "task-b"])).toEqual({
    "task-a": "#cf6798",
    "task-b": "#b16ed3",
  })
})
