/** One pass of the tour over one checkout: seed homes, start a bridge per home, shoot every entry. */

import { type ChildProcess, spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { join } from "node:path"
import { type Browser, type BrowserContext, type Page, chromium } from "@playwright/test"
import { type Locale, runSteps, scrollTo, settle, trackWire } from "./drive.ts"
import { type Entry, type HomeKind, MANIFEST, type Target, type Viewport } from "./manifest.ts"
import { type Home, seedHome, settled, stopHome } from "./seed.ts"

export type Variant = "default" | "light" | "zh"
export interface Shot {
  readonly file: string
  readonly entry: string
  readonly caption: string
  readonly viewport: Viewport
  readonly variant: Variant
  readonly page: number
  /** Animated marks (status dots), in image pixels: a compare ignores what changes inside them. */
  readonly moving?: readonly (readonly number[])[]
}
export interface ShootOptions {
  readonly checkout: string
  readonly out: string
  readonly runRoot: string
  readonly viewports: readonly Viewport[]
  readonly variants: readonly Variant[]
  readonly filter?: RegExp
  /** Drives an already-open page instead of a fresh Chromium (the Electron window); returns the frame capture. */
  readonly window?: WindowDriver
}
export interface WindowDriver {
  open(url: string, entry: Entry): Promise<Page>
  capture(page: Page): Promise<Buffer>
  close(): Promise<void>
}

const SIZES: Record<Viewport, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
}
/** What shows once a home's page has loaded and talked to its bridge. */
const READY: Record<HomeKind, Target> = {
  full: "Fix login redirect loop",
  empty: { t: "rail.settings" },
  token: { css: "input" },
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
    server.on("error", reject)
  })
}

interface Bridge {
  readonly home: Home
  readonly url: string
  readonly proc: ChildProcess
}

export async function startBridge(home: Home): Promise<Bridge> {
  const port = await freePort()
  const proc = spawn("bun", ["--conditions=browser", join(home.roveDir, "src/cli/rove.ts"), "--web", "--port", String(port), "--no-qr"], {
    cwd: home.root,
    env: home.env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let seen = ""
  const url = await new Promise<string>((resolve, reject) => {
    const read = (chunk: Buffer) => {
      seen += chunk.toString()
      const link = /^open: (\S+)/m.exec(seen)?.[1]
      if (link) resolve(link)
    }
    proc.stdout!.on("data", read)
    proc.stderr!.on("data", read)
    proc.on("exit", () => reject(new Error(`rove --web exited before printing its link:\n${seen}`)))
  })
  return { home, url, proc }
}

/** SIGTERM, then wait for the exit: the bridge is the one process the tour itself started. */
async function stopBridge(bridge: Bridge): Promise<void> {
  if (bridge.proc.exitCode !== null) return
  const gone = new Promise((r) => bridge.proc.once("exit", r))
  bridge.proc.kill("SIGTERM")
  await gone
}

async function variantState(home: Home, variant: Variant): Promise<void> {
  if (variant === "default") return
  const path = join(home.home, ".config", "rove", "state.json")
  const state = JSON.parse(await readFile(path, "utf8"))
  Object.assign(state, variant === "light" ? { themeMode: "light" } : { locale: "zh" })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`)
}

export async function shoot(opts: ShootOptions, log: (line: string) => void): Promise<{ shots: Shot[]; failures: string[] }> {
  const version = JSON.parse(await readFile(join(opts.checkout, "packages/rove/package.json"), "utf8")).version as string
  const roveDir = join(opts.checkout, "packages/rove")
  const wanted = MANIFEST.filter((e) => !opts.filter || opts.filter.test(e.id))
  const shots: Shot[] = []
  const failures: string[] = []
  await mkdir(opts.out, { recursive: true })
  const browser: Browser | null = opts.window ? null : await chromium.launch()

  for (const variant of opts.variants) {
    const entries = wanted.filter((e) => (variant === "default" || e.variants) && (opts.window ? true : e.electron !== "only"))
    const kinds = [...new Set(entries.filter((e) => e.electron !== "only").map((e) => e.home ?? "full"))]
    const homes = new Map<HomeKind, Home>()
    const bridges = new Map<HomeKind, Bridge>()
    const runRoot = join(opts.runRoot, variant)
    let seededAt = Date.now()
    try {
      for (const kind of kinds) {
        const started = Date.now()
        const home = await seedHome(kind === "full" ? "full" : "empty", join(runRoot, kind), roveDir, version)
        if (kind === "token") {
          await mkdir(join(home.home, ".rove", "bridge"), { recursive: true })
          await writeFile(join(home.home, ".rove", "bridge", "config.json"), `${JSON.stringify({ auth: "token" })}\n`)
        }
        await variantState(home, variant)
        homes.set(kind, home)
        seededAt = Date.now()
        bridges.set(kind, await startBridge(home))
        await settled(home)
        log(`  ${variant}/${kind}: seeded and serving in ${((Date.now() - started) / 1000).toFixed(1)}s`)
      }
      const viewports = opts.window ? (["desktop"] as const) : opts.viewports
      const contexts = new Map<Viewport, BrowserContext>()
      for (const viewport of browser ? viewports : []) {
        const context = await browser!.newContext({
          viewport: SIZES[viewport],
          deviceScaleFactor: viewport === "phone" ? 2 : 1,
          isMobile: viewport === "phone",
          hasTouch: viewport === "phone",
          reducedMotion: "reduce",
          colorScheme: variant === "light" ? "light" : "dark",
          locale: variant === "zh" ? "zh-CN" : "en-US",
        })
        await context.addInitScript(SEEDED_RANDOM)
        // "12m ago" instead of whatever the seconds since seeding were: the page's clock stands still past the seed.
        await context.clock.setFixedTime(seededAt + 12 * 60_000)
        contexts.set(viewport, context)
      }
      // Entry by entry, every viewport in turn: an entry that changes the seeded state (a split) does so for the
      // entries after it on every viewport alike.
      for (const entry of entries) {
        for (const viewport of viewports) {
          if (!(entry.on ?? ["desktop"]).includes(viewport)) continue
          const name = `${entry.id}${viewport === "phone" ? "-phone" : ""}${variant === "default" ? "" : `-${variant}`}`
          const kind = entry.home ?? "full"
          const t0 = Date.now()
          try {
            shots.push(...(await shootEntry({ entry, viewport, variant, name, bridges, kind, context: contexts.get(viewport), opts })))
            log(`  ✓ ${name} (${Date.now() - t0}ms)`)
          } catch (err) {
            failures.push(`${name}: ${String(err).split("\n")[0]}`)
            log(`  ✗ ${name}: ${String(err).split("\n")[0]}`)
          }
        }
      }
      for (const context of contexts.values()) await context.close()
    } finally {
      for (const bridge of bridges.values()) await stopBridge(bridge)
      for (const home of homes.values()) stopHome(home)
    }
  }
  await browser?.close()
  return { shots, failures }
}

interface EntryRun {
  readonly entry: Entry
  readonly viewport: Viewport
  readonly variant: Variant
  readonly name: string
  readonly kind: HomeKind
  readonly bridges: Map<HomeKind, Bridge>
  readonly context: BrowserContext | undefined
  readonly opts: ShootOptions
}

/** Loads the entry's home fresh, runs its steps, and writes one shot per screenful. */
async function shootEntry({ entry, viewport, variant, name, kind, bridges, context, opts }: EntryRun): Promise<Shot[]> {
  // The install window has no bridge: it is what the shell shows when it finds no Rove at all.
  const bridge = entry.electron === "only" ? undefined : bridges.get(kind)
  const shots: Shot[] = []
  let page: Page | null = null
  try {
    const url = bridge ? (kind === "token" ? bridge.url.replace(/#.*/, "") : bridge.url) : ""
    if (opts.window) page = await opts.window.open(url, entry)
    else {
      page = await context!.newPage()
      trackWire(page)
      await page.goto(url)
    }
    const locale: Locale = variant === "zh" ? "zh" : "en"
    if (bridge) {
      await page.evaluate((storage) => {
        localStorage.clear()
        sessionStorage.clear()
        for (const [k, v] of Object.entries(storage)) sessionStorage.setItem(k, v)
      }, entry.storage ?? {})
      await page.reload()
      await runSteps(page, [{ wait: READY[kind] }], locale, false)
    }
    const steps = (viewport === "phone" ? (entry.phoneSteps ?? entry.steps) : entry.steps) ?? []
    await runSteps(page, steps, locale, viewport === "phone")
    if (entry.offline && bridge) {
      await stopBridge(bridge)
      await page.waitForFunction(() => /reconnect|disconnect|lost|offline/i.test(document.body.innerText), undefined, { timeout: 20_000 })
    }
    if (!steps.some((s) => "hover" in s)) await page.mouse.move(SIZES[viewport].width - 2, SIZES[viewport].height - 2)
    const shown = page
    const capture = () => (opts.window ? opts.window.capture(shown) : shown.screenshot({ animations: "disabled", caret: "hide" }))
    for (let n = 0; n <= (entry.pages ?? 0); n++) {
      if (n > 0 && !(await scrollTo(page, n))) break
      const file = `${name}${n > 0 ? `-p${n + 1}` : ""}.png`
      await writeFile(join(opts.out, file), await settle(page, capture))
      const moving = opts.window ? undefined : await page.evaluate(MOVING)
      shots.push({ file, entry: entry.id, caption: entry.caption, viewport, variant, page: n + 1, moving })
    }
    return shots
  } catch (err) {
    if (page) await page.screenshot({ path: join(opts.out, `failed-${name}.png`) }).catch(() => {})
    throw err
  } finally {
    if (!opts.window) await page?.close()
    if (entry.offline && bridge) bridges.set(kind, await startBridge(bridge.home))
  }
}

const MOVING = () =>
  [...document.querySelectorAll("[data-dots]")].map((e) => {
    const r = e.getBoundingClientRect()
    return [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * devicePixelRatio))
  })

/** Same sequence every load: anything drawn from `Math.random` (sky scenes, ids in the DOM) stops differing run to run. */
const SEEDED_RANDOM = `(() => { let s = 0x2f6b1d; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000 } })()`

