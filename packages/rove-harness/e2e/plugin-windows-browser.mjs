import { chromium, expect } from "@playwright/test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const baseline = process.env.PLUGIN_BASELINE === "true"
const out = process.env.PLUGIN_EVIDENCE
const label = process.env.PLUGIN_LABEL
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await context.tracing.start({ screenshots: true, snapshots: true })
const web = await context.newPage()
const tui = await context.newPage()
try {
  await web.goto(`http://127.0.0.1:5276/#token=${process.env.PLUGIN_TOKEN}`)
  await expect(web.getByRole("button", { name: "Kanban", exact: true })).toBeVisible({ timeout: 60000 })
  await tui.goto(`http://127.0.0.1:5273/harness?run=plugin-${label}`)
  const buffer = tui.getByTestId("opentui-buffer")
  await expect(tui.getByTestId("opentui-harness")).toHaveAttribute("data-pty-status", "open", { timeout: 60000 })
  await expect(buffer).toContainText("Kanban", { timeout: 60000 })
  if (baseline) {
    // Give both live subscribers time to receive a pane from the already-running mod.
    await new Promise((resolve) => setTimeout(resolve, 3000))
    await expect(web.getByRole("button", { name: "Mods", exact: true })).toHaveCount(0)
    await expect(buffer).not.toContainText("Mods")
  } else {
    await expect(buffer).toContainText("Mods")
    await web.getByRole("button", { name: "Mods", exact: true }).click()
    await expect(web.getByText("Native count: 0", { exact: true })).toBeVisible()
    await web.getByRole("button", { name: "Increment native counter", exact: true }).click()
    await expect(web.getByText("Native count: 1", { exact: true })).toBeVisible()
    const terminal = tui.locator(".xterm-helper-textarea")
    const lines = (await buffer.textContent()).split("\n")
    const row = lines.findIndex((line) => /^\s*Mods\s/.test(line))
    if (row < 0) throw new Error("Mods rail row missing")
    const screen = tui.locator(".xterm-screen")
    const bounds = await screen.boundingBox()
    await screen.click({ position: { x: 50, y: (row + 0.5) * bounds.height / lines.length } })
    await expect(buffer).toContainText("Windows Counter")
    await expect(buffer).toContainText("Native count: 1")
    await terminal.press("Enter")
    await expect(buffer).toContainText("Native count: 2")
    await expect(web.getByText("Native count: 2", { exact: true })).toBeVisible()
  }
  console.log(JSON.stringify({ baseline, web: "pass", tui: "pass", url: tui.url(), viewport: "1280x800" }))
} finally {
  await web.screenshot({ path: join(out, `${label}-web.png`) })
  await tui.screenshot({ path: join(out, `${label}-tui.png`) })
  writeFileSync(join(out, `${label}-tui.txt`), await tui.getByTestId("opentui-buffer").textContent().catch(() => ""))
  await context.tracing.stop({ path: join(out, `${label}-clients-trace.zip`) })
  await browser.close()
}
