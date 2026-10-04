// Scratch capture (not committed): start a turn on the fixture task, then
// burst-shoot the sidebar so the breathing spinner can be seen frame by frame.
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { chromium } from "@playwright/test"
import { KOBE_DIR, VISUAL_ENV, VISUAL_WEB_PORT } from "./visual-fixture.ts"

const out = process.argv[2] ?? "/tmp/breathe"
const frames = Number(process.argv[3] ?? 18)
const taskId = process.argv[4] ?? "01M3D2A63C3N1NBMYZHX5DCPHZ"
mkdirSync(out, { recursive: true })

function api(...args: string[]) {
  return Bun.spawnSync(["bun", "--conditions=browser", resolve(KOBE_DIR, "src/cli/rove.ts"), "api", ...args], {
    cwd: KOBE_DIR,
    env: { ...VISUAL_ENV },
  })
}

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${VISUAL_WEB_PORT}/harness?run=breathe-${Date.now()}`)
  const buffer = page.getByTestId("opentui-buffer")
  await page.waitForFunction((el) => el?.textContent?.includes("fixture-repo"), await buffer.elementHandle(), {
    timeout: 45_000,
  })
  await page.getByTestId("opentui-terminal").click({ position: { x: 24, y: 400 } })
  const report = api("engine-report", "--kind", "turn-start", "--task-id", taskId, "--engine", "claude", "--tab", "tab-1")
  console.error(report.stdout.toString(), report.stderr.toString())
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${out}/full.png` })
  for (let i = 0; i < frames; i++) {
    await page.screenshot({ path: `${out}/f${String(i).padStart(2, "0")}.png`, clip: { x: 0, y: 0, width: 1280, height: 800 } })
    await page.waitForTimeout(20)
  }
} finally {
  await browser.close()
}
