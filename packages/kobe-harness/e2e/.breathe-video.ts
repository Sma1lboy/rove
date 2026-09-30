// Scratch (not committed): record a real harness session while the fixture task runs.
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { chromium } from "@playwright/test"
import { readFileSync } from "node:fs"
import { KOBE_DIR, VISUAL_ENV, VISUAL_HOME, VISUAL_WEB_PORT } from "./visual-fixture.ts"

const out = process.argv[2] ?? "/tmp/breathe-video"
const seconds = Number(process.argv[3] ?? 8)
const taskId: string = JSON.parse(readFileSync(resolve(VISUAL_HOME, ".rove/tasks.json"), "utf8")).tasks[0].id
mkdirSync(out, { recursive: true })
const api = (...args: string[]) =>
  Bun.spawnSync(["bun", "--conditions=browser", resolve(KOBE_DIR, "src/cli/rove.ts"), "api", ...args], {
    cwd: KOBE_DIR,
    env: { ...VISUAL_ENV },
  })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: out, size: { width: 1280, height: 800 } },
})
try {
  const page = await context.newPage()
  await page.goto(`http://localhost:${VISUAL_WEB_PORT}/harness?run=video-${Date.now()}`)
  const buffer = page.getByTestId("opentui-buffer")
  await page.waitForFunction((el) => el?.textContent?.includes("fixture-repo"), await buffer.elementHandle(), {
    timeout: 45_000,
  })
  await page.getByTestId("opentui-terminal").click({ position: { x: 24, y: 400 } })
  api("engine-report", "--kind", "turn-start", "--task-id", taskId, "--engine", "claude", "--tab", "tab-1")
  if (process.env.FOCUS_PANE === "1") await page.getByTestId("opentui-terminal").click({ position: { x: 216, y: 420 } })
  const marker = Date.now()
  await page.waitForTimeout(seconds * 1000)
  console.log(`turn-start at +${marker}`)
} finally {
  await context.close()
  await browser.close()
}
