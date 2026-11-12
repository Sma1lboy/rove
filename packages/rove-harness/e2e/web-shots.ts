/**
 * `bun run web:shots` — screenshots of rove-web's pages on the isolated visual fixture, compared
 * with the last run's. Prints `{ dir, from, to, changed, added }` as JSON; the shots are in
 * `<dir>/current` and the ones they were compared with in `<dir>/previous`. A run that fails
 * leaves both as they were. Needs `bun run build` first (the web client and the CLI).
 *   ROVE_WEB_SHOTS_DIR   where runs are kept (default `.scratch/web-shots`)
 *   ROVE_WEB_SHOTS_PORT  the bridge port (default 7979)
 */

import { execFileSync } from "node:child_process"
import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { chromium } from "@playwright/test"
import setupVisualFixture, { ROVE_DIR, VISUAL_ENV, VISUAL_HOME } from "./visual-fixture.ts"

const REPO_ROOT = resolve(import.meta.dirname, "../../..")
const DIR = resolve(process.env.ROVE_WEB_SHOTS_DIR ?? join(REPO_ROOT, ".scratch", "web-shots"))
const PORT = process.env.ROVE_WEB_SHOTS_PORT ?? "7979"
const CURRENT = join(DIR, "current")
const PREVIOUS = join(DIR, "previous")
const NEXT = join(DIR, "next")

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } }
interface Scene {
  /** The rail row to click, as a person would reach the scene. */
  readonly click?: string
  /** For a page with no rail row: the `sessionStorage` a reload comes back to. A phone opens on the rail, so these are desktop only. */
  readonly storage?: Record<string, string>
}
/** Keep the page ids in step with `PAGE_IDS` in rove-web's `ui.ts`. */
const SCENES: Record<string, Scene> = {
  "new-session": { click: "New task" },
  kanban: { click: "Kanban" },
  routines: { click: "Routines" },
  issues: { click: "Issues" },
  settings: { click: "Settings" },
  ...Object.fromEntries(
    ["worktrees", "update", "mods", "compare", "usage"].map((id) => [id, { storage: { "rove.web.page": JSON.stringify(id) } }]),
  ),
  // Last: once a task is open its terminal sits behind every later scene, blinking.
  workspace: { click: "Visual Fixture" },
}

async function readMeta(dir: string): Promise<{ commit: string } | null> {
  try {
    return JSON.parse(await readFile(join(dir, "meta.json"), "utf8"))
  } catch {
    return null
  }
}

await setupVisualFixture()
await mkdir(NEXT, { recursive: true })

const server = Bun.spawn(["bun", "--conditions=browser", "src/cli/rove.ts", "--web", "--port", PORT, "--no-qr"], {
  cwd: ROVE_DIR,
  env: { ...VISUAL_ENV, ROVE_HOME_DIR: VISUAL_HOME },
  stdout: "pipe",
  stderr: "inherit",
})

async function openLink(): Promise<string> {
  let seen = ""
  const decoder = new TextDecoder()
  for await (const chunk of server.stdout) {
    seen += decoder.decode(chunk)
    const link = /^open: (\S+)/m.exec(seen)?.[1]
    if (link) return link
  }
  throw new Error(`rove --web exited before printing its link:\n${seen}`)
}

/** Rounded corners antialias differently run to run: up to 20 pixels between two shots of one build. A row moved by 1px is hundreds. */
const NOISE_PIXELS = 50
const changed: { name: string; pixels: number }[] = []
const added: string[] = []
try {
  const link = await openLink()
  const browser = await chromium.launch()
  const bench = await browser.newPage()
  /** How many pixels differ; a size change counts as all of them. */
  const differing = (before: Buffer, after: Buffer): Promise<number> =>
    bench.evaluate(
      async ([a, b]) => {
        const pixels = async (png: string) => {
          const image = new Image()
          image.src = `data:image/png;base64,${png}`
          await image.decode()
          const ctx = new OffscreenCanvas(image.width, image.height).getContext("2d")!
          ctx.drawImage(image, 0, 0)
          return ctx.getImageData(0, 0, image.width, image.height)
        }
        const [x, y] = await Promise.all([pixels(a!), pixels(b!)])
        if (x.width !== y.width || x.height !== y.height) return x.width * x.height
        let count = 0
        for (let i = 0; i < x.data.length; i += 4) {
          if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2]) count++
        }
        return count
      },
      [before.toString("base64"), after.toString("base64")],
    )
  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce", locale: "en-US" })
    const page = await context.newPage()
    const loaded = () => page.getByText("Visual Fixture").first().waitFor()
    await page.goto(link)
    await loaded()
    // A first-run notice toasts once per home; let it leave before the first shot.
    await page.waitForTimeout(6000)
    for (const [scene, { click, storage }] of Object.entries(SCENES)) {
      if (storage && viewportName === "phone") continue
      await page.evaluate((entries) => {
        sessionStorage.clear()
        for (const [key, value] of Object.entries(entries)) sessionStorage.setItem(key, value)
      }, storage ?? {})
      try {
        await page.reload()
        await loaded()
        // A row's text can carry a key hint after its label.
        if (click) await page.getByText(new RegExp(`^${click}`)).first().click()
      } catch (err) {
        // What the page showed instead, for whoever reads the failure.
        await page.screenshot({ path: join(DIR, `failed-${scene}-${viewportName}.png`) })
        throw err
      }
      await page.evaluate(() => document.fonts.ready.then(() => undefined))
      await page.waitForTimeout(2000)
      // An unfocused terminal draws a still, hollow cursor.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.waitForTimeout(300)
      const name = `${scene}-${viewportName}.png`
      const shot = await page.screenshot({ animations: "disabled", caret: "hide" })
      await writeFile(join(NEXT, name), shot)
      const before = await readFile(join(CURRENT, name)).catch(() => null)
      if (!before) added.push(name)
      else if (!before.equals(shot)) {
        const pixels = await differing(before, shot)
        if (pixels > NOISE_PIXELS) changed.push({ name, pixels })
      }
    }
    await context.close()
  }
  await browser.close()
} finally {
  server.kill()
}

const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim()
const from = (await readMeta(CURRENT))?.commit ?? null
// Copied over, never removed: a scene dropped since stays behind, unused.
if (from) await cp(CURRENT, PREVIOUS, { recursive: true, force: true })
await cp(NEXT, CURRENT, { recursive: true, force: true })
await writeFile(join(CURRENT, "meta.json"), `${JSON.stringify({ commit })}\n`)
console.log(JSON.stringify({ dir: DIR, from, to: commit, changed, added }, null, 2))
process.exit(0)
