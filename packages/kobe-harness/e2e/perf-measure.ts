/**
 * `bun run perf:measure [--out=dir] [--update-baseline]` — counts and timings
 * for the TUI's user paths, compared against `perf/baseline.json`.
 *
 * Starts its own isolated fixture on port base 5373 (so a warm `visual:serve`
 * on 5273 is left alone), drives the real OpenTUI through the browser harness,
 * and reads the counters the TUI writes under `ROVE_RENDER_PROFILE` /
 * `ROVE_SPAWN_PROFILE`. Wall-clock numbers are machine-dependent: this is a
 * fixed-machine tool, not a CI gate. Exit 1 when any metric regresses past
 * its tolerance.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { chromium, type Page } from "@playwright/test"

const HARNESS_DIR = resolve(import.meta.dirname, "..")
const REPO_ROOT = resolve(HARNESS_DIR, "..", "..")
const BASELINE = join(HARNESS_DIR, "perf", "baseline.json")
const args = process.argv.slice(2)
const updateBaseline = args.includes("--update-baseline")
const out = resolve(
  args.find((a) => a.startsWith("--out="))?.slice(6) ??
    join(REPO_ROOT, ".scratch", "perf", new Date().toISOString().replaceAll(":", "-")),
)
mkdirSync(out, { recursive: true })

// Read at import by visual-fixture and by the TUI command it builds.
process.env.KOBE_VISUAL_PORT_BASE ??= "5373"
process.env.ROVE_RENDER_PROFILE = join(out, "render.jsonl")
process.env.ROVE_SPAWN_PROFILE = join(out, "spawn.jsonl")
for (const f of [process.env.ROVE_RENDER_PROFILE, process.env.ROVE_SPAWN_PROFILE]) writeFileSync(f, "")

const fixture = await import("./visual-fixture.ts")
const { fixturePaths } = await import("../../kobe/scripts/fixture-core.ts")

/** Two tasks on a plain shell: switching and typing must not depend on a real engine starting. */
function seedShellTasks(): void {
  const repo = fixturePaths(fixture.VISUAL_ROOT, "fixture-repo").repo
  for (const [title, extra] of [["Perf A", ["--activate"]], ["Perf B", []]] as const) {
    const run = Bun.spawnSync(
      ["node", fixture.ROVE_CLI, "api", "add", "--repo", repo, "--title", title, "--command", "bash --norc --noprofile -i", ...extra],
      { env: fixture.VISUAL_ENV },
    )
    if (run.exitCode !== 0) throw new Error(`seeding ${title} failed: ${run.stderr.toString().slice(-400)}`)
  }
}

type Row = Record<string, number | string>
type Phase = { name: string; start: number; end: number; ops: number }
const phases: Phase[] = []
const metrics: Record<string, number> = {}
/** Harness cell height at the 1280×800 viewport (50 rows). */
const CELL_H = 16
const median = (xs: number[]) =>
  xs.length ? +(xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number).toFixed(1) : Number.NaN

let page: Page | undefined

async function phase(name: string, ops: number, body: () => Promise<void>): Promise<void> {
  if (page) {
    await page.screenshot({ path: join(out, `${name}.png`) })
    writeFileSync(join(out, `${name}.txt`), (await page.getByTestId("opentui-buffer").textContent()) ?? "")
  }
  const start = Date.now()
  await body()
  const end = Date.now()
  phases.push({ name, start, end, ops })
  // Counters flush once a second: a quiet gap keeps rows from bleeding into the next phase.
  await new Promise((r) => setTimeout(r, 1500))
}

/** Latency from a key press to the first change of the harness buffer. */
async function pressTimed(page: Page, key: string): Promise<number> {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="opentui-buffer"]')
    const w = window as unknown as { perfFirst?: number; perfObs?: MutationObserver }
    w.perfFirst = undefined
    w.perfObs?.disconnect()
    w.perfObs = new MutationObserver(() => {
      w.perfFirst ??= performance.now()
    })
    if (el) w.perfObs.observe(el, { childList: true, subtree: true, characterData: true })
  })
  const t0 = await page.evaluate(() => performance.now())
  await page.keyboard.press(key)
  await page.waitForFunction(() => (window as unknown as { perfFirst?: number }).perfFirst !== undefined, null, {
    timeout: 5000,
  })
  return page.evaluate((t) => ((window as unknown as { perfFirst: number }).perfFirst ?? t) - t, t0)
}

async function waitForText(page: Page, needle: string): Promise<void> {
  await page.waitForFunction(
    (value) => document.querySelector('[data-testid="opentui-buffer"]')?.textContent?.includes(value),
    needle,
    { timeout: 45_000 },
  )
}

async function drive(): Promise<void> {
  const browser = await chromium.launch({ headless: true, args: ["--force-device-scale-factor=1"] })
  try {
    const pg = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
    page = pg
    const bootStart = Date.now()
    await pg.goto(`http://localhost:${fixture.VISUAL_WEB_PORT}/harness?run=perf-${bootStart}`)
    await waitForText(pg, "fixture-repo")
    metrics["boot.ready.ms"] = Date.now() - bootStart
    await pg.waitForTimeout(3000)
    await phase("idle", 1, () => pg.waitForTimeout(10_000))

    // Each shell gets its own prompt, so "the other task is showing" is a text check.
    const openTask = async (title: string) => {
      const lines = ((await pg.getByTestId("opentui-buffer").textContent()) ?? "").split("\n")
      // The row shows the title ("Perf A") until the task has a branch ("perf-a").
      const row = lines.findIndex((line) => {
        const cell = line.slice(0, 30).toLowerCase()
        return cell.includes(title) || cell.includes(title.replace("-", " "))
      })
      if (row < 0) throw new Error(`no sidebar row for ${title}`)
      await pg.mouse.click(40, row * CELL_H + CELL_H / 2)
      await pg.keyboard.press("Enter")
    }
    const setPrompt = async (title: string, prompt: string) => {
      await openTask(title)
      await pg.waitForTimeout(1500)
      await pg.mouse.click(600, 300)
      await pg.keyboard.type(`PS1='${prompt}'; clear`)
      await pg.keyboard.press("Enter")
      await waitForText(pg, prompt)
    }
    await setPrompt("perf-a", "A> ")
    await setPrompt("perf-b", "B> ")
    await pg.waitForTimeout(1000)

    const switches: number[] = []
    await phase("switch", 10, async () => {
      for (let i = 0; i < 10; i++) {
        const [title, prompt] = i % 2 === 0 ? ["perf-a", "A> "] : ["perf-b", "B> "]
        const t0 = Date.now()
        await openTask(title)
        await waitForText(pg, prompt)
        switches.push(Date.now() - t0)
        await pg.waitForTimeout(400)
      }
    })
    metrics["switch.shown.p50.ms"] = median(switches)

    // The last switch landed on Perf B.
    await pg.mouse.click(600, 300)
    await pg.keyboard.press("Control+u")
    await pg.waitForTimeout(1500)

    const text = "abcdefghijklmnopqrstuvwxyzabcd"
    const echoes: number[] = []
    await phase("typing", text.length, async () => {
      for (const ch of text) {
        echoes.push(await pressTimed(pg, ch))
        await pg.waitForTimeout(60)
      }
      await waitForText(pg, `B> ${text}`)
    })
    metrics["typing.echo.p50.ms"] = median(echoes)
    await pg.keyboard.press("Control+u")

    await pg.request
      .post(`http://127.0.0.1:${fixture.VISUAL_PTY_PORT}/pty/close`, {
        data: { tab: `visual-perf-${bootStart}` },
        headers: fixture.fixtureAuthHeaders(),
      })
      .catch(() => {})
  } finally {
    await browser.close()
  }
}

function readRows(path: string): Row[] {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row)
}

function summarize(): void {
  const render = readRows(process.env.ROVE_RENDER_PROFILE as string)
  const tui = render.find((r) => r.mark === "firstFrame")
  if (!tui) throw new Error("the TUI never reported a first frame — is ROVE_RENDER_PROFILE reaching it?")
  metrics["boot.firstFrame.ms"] = Number(tui.ms)
  const tuiRows = render.filter((r) => r.pid === tui.pid && r.mark === undefined)
  const spawns = readRows(process.env.ROVE_SPAWN_PROFILE as string)
  for (const p of phases) {
    // A row flushed at t covers the second before it.
    const inWindow = (t: number) => t > p.start && t <= p.end + 1000
    const sums = new Map<string, number>()
    for (const row of tuiRows.filter((r) => inWindow(Number(r.t)))) {
      for (const [k, v] of Object.entries(row)) if (k.endsWith("_n")) sums.set(k.slice(0, -2), (sums.get(k.slice(0, -2)) ?? 0) + Number(v))
    }
    const per = p.ops > 1 ? ".perOp" : ""
    for (const [k, v] of sums) metrics[`${p.name}${per}.${k}`] = +(v / p.ops).toFixed(2)
    metrics[`${p.name}${per}.spawns`] = +(spawns.filter((s) => inWindow(Number(s.t))).length / p.ops).toFixed(2)
  }
}

function golden(): void {
  const run = Bun.spawnSync(["bun", "run", "perf:golden", "--fast", "--json"], {
    cwd: join(REPO_ROOT, "packages", "kobe"),
    stderr: "inherit",
  })
  const text = run.stdout.toString()
  const json = JSON.parse(text.slice(text.indexOf("{"))) as { results?: { metric: string; value: number; skipped?: boolean }[] }
  for (const r of json.results ?? []) if (!r.skipped) metrics[`golden.${r.metric}`] = r.value
}

/** Counts get 10% (or 1) slack, timings 50% (or 15 ms): wall-clock on a working machine is noisy, a structural slowdown is not. */
function compare(base: Record<string, number>): string[] {
  const failures: string[] = []
  const lines = ["| metric | baseline | now | Δ |", "| --- | ---: | ---: | ---: |"]
  for (const key of Object.keys({ ...base, ...metrics }).sort()) {
    const was = base[key]
    const now = metrics[key]
    const floor = key.endsWith("-min")
    const timing = key.endsWith(".ms") || key.includes("-ms") || key.includes("-mb")
    let mark = ""
    if (was !== undefined && now !== undefined && Number.isFinite(was) && Number.isFinite(now)) {
      const slack = timing ? Math.max(was * 0.5, 15) : Math.max(was * 0.1, 1)
      if (floor ? now < was - slack : now > was + slack) {
        mark = " ✗"
        failures.push(`${key}: ${was} → ${now}`)
      } else if (floor ? now > was + slack : now < was - slack) mark = " ✓"
    }
    const delta = was !== undefined && now !== undefined ? `${now - was >= 0 ? "+" : ""}${+(now - was).toFixed(2)}${mark}` : ""
    lines.push(`| ${key} | ${was ?? ""} | ${now ?? ""} | ${delta} |`)
  }
  writeFileSync(join(out, "report.md"), `${lines.join("\n")}\n`)
  console.log(lines.join("\n"))
  return failures
}

// Always cold: a warm fixture may carry tasks from an earlier visual:serve on this port base.
await fixture.cleanupVisualFixture()
await fixture.default()
seedShellTasks()
const server = Bun.spawn(["bun", "run", "dev.ts"], {
  cwd: HARNESS_DIR,
  stdio: ["ignore", "ignore", "ignore"],
  env: {
    ...fixture.VISUAL_ENV,
    KOBE_HOME_DIR: fixture.VISUAL_HOME,
    KOBE_WEB_PORT: String(fixture.VISUAL_WEB_PORT),
    KOBE_PTY_PORT: String(fixture.VISUAL_PTY_PORT),
    KOBE_PTY_DEV_CWD: fixture.KOBE_DIR,
    KOBE_PTY_DEV_COMMAND: fixture.VISUAL_PTY_COMMAND,
  },
})
try {
  for (let i = 0; i < 60; i++) {
    if (await fetch(`http://localhost:${fixture.VISUAL_WEB_PORT}/`).then(() => true, () => false)) break
    await new Promise((r) => setTimeout(r, 500))
  }
  await drive()
} finally {
  server.kill()
  await server.exited
  await fixture.cleanupVisualFixture()
}
summarize()
golden()
writeFileSync(join(out, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`)
const base = existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, number>) : {}
const failures = compare(base)
if (updateBaseline) {
  mkdirSync(join(HARNESS_DIR, "perf"), { recursive: true })
  writeFileSync(BASELINE, `${JSON.stringify(metrics, null, 2)}\n`)
  console.log(`baseline written: ${BASELINE}`)
} else if (failures.length > 0) {
  appendFileSync(join(out, "report.md"), `\nRegressed:\n${failures.map((f) => `- ${f}`).join("\n")}\n`)
  console.error(`regressed: ${failures.join("; ")}`)
  process.exit(1)
}
console.log(`report: ${join(out, "report.md")}`)
