import { expect, test } from "bun:test"
import { fitsJoined } from "../src/settings-rows.tsx"

const picks = (...labels: string[]) => labels.map((label) => ({ label }))

test("a Chinese label counts each character at two Latin widths, so long ones go to a drop-down", () => {
  expect(fitsJoined(picks("始终显示", "仅 2 个以上标签时显示", "关闭 — 标签在左侧树里"))).toBe(false)
  expect(fitsJoined(picks("深色", "浅色", "自动"))).toBe(true)
  expect(fitsJoined(picks("always", "with 2+ tabs", "off"))).toBe(true)
})

test("a phone joins only a short pair; the rest open a sheet", () => {
  expect(fitsJoined(picks("English", "中文"), true)).toBe(true)
  expect(fitsJoined(picks("default ~/.rove/worktrees", "next to project"), true)).toBe(false)
  expect(fitsJoined(picks("深色", "浅色", "自动"), true)).toBe(false)
})
