// Scratch (not committed): record Settings → Appearance with the animated preview.
import { mkdirSync } from "node:fs"
import { chromium } from "@playwright/test"
import { VISUAL_WEB_PORT } from "./visual-fixture.ts"

const out = process.argv[2] ?? "/tmp/settings-video"
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } })
try {
  const page = await context.newPage()
  await page.goto(`http://localhost:${VISUAL_WEB_PORT}/harness?run=settings-${Date.now()}`)
  const buffer = page.getByTestId("opentui-buffer")
  await page.waitForFunction((el) => el?.textContent?.includes("New task"), await buffer.elementHandle(), { timeout: 60_000 })
  const term = page.getByTestId("opentui-terminal")
  await term.click({ position: { x: 1225, y: 791 } })
  await page.waitForTimeout(3500)
  const find = async (needle: string) => {
    const rows = (await buffer.textContent())?.split("\n") ?? []
    return rows.findIndex((r) => r.includes(needle))
  }
  for (const label of ["State glyphs", "Working border"]) {
    const row = await find(label)
    console.log(label, "row", row)
    if (row < 0) continue
    await term.click({ position: { x: 200, y: row * 16 + 8 } })
    await page.waitForTimeout(2500)
    for (let k = 0; k < 2; k++) {
      await page.keyboard.press("j")
      await page.waitForTimeout(2500)
    }
    await page.keyboard.press("Escape")
    await page.waitForTimeout(1200)
  }
} finally {
  await context.close()
  await browser.close()
}
