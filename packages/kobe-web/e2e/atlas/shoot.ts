/**
 * `bun e2e/atlas/shoot.ts [flow…] [--out=dir] [--width=N] [--height=N]`
 *
 * Shoots the TUI atlas: every flow in `flows.ts`, one PNG per step, through the
 * same sanctioned `/harness` path the docs stills use. Requires the hero stack
 * (`hero-fixture.ts`, `hero-issues.ts`, `hero-seed.ts`, `hero-serve.ts`).
 *
 * Each flow gets its OWN browser page and its own PTY — steps are cumulative
 * within a flow but flows never share state, so one wedged flow cannot poison
 * the rest. A step that throws is recorded as failed and the flow moves on.
 *
 * Writes `manifest.json` alongside the frames; `contact-sheet.ts` reads it.
 */

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { chromium } from "@playwright/test"
import { HERO_PTY_PORT, HERO_WEB_PORT } from "../hero-env.ts"
import { heroApi } from "../hero-fixture.ts"
import { FLOWS, type Flow } from "./flows.ts"

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>>

const REPO_ROOT = resolve(import.meta.dirname, "../../../..")
const args = process.argv.slice(2)
function flag(name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
}
const OUT = resolve(flag("out") ?? join(REPO_ROOT, ".scratch", "atlas"))
const DEFAULT_WIDTH = Number(flag("width") ?? 1280)
const DEFAULT_HEIGHT = Number(flag("height") ?? 800)

const selected = args.filter((a) => !a.startsWith("--"))
const queue = selected.length > 0 ? FLOWS.filter((f) => selected.includes(f.name)) : FLOWS
if (queue.length === 0) throw new Error(`no such flow: ${selected.join(", ")}\navailable: ${FLOWS.map((f) => f.name).join(", ")}`)

type Shot = {
  flow: string
  step: string
  index: number
  file: string
  subject: string
  failed?: string
  /** Byte-identical to the previous step's frame — the step changed nothing. */
  unchanged?: boolean
}
const shots: Shot[] = []

if (selected.length === 0) rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

/**
 * Kill split panes left behind by an earlier flow.
 *
 * A split is a HOSTED PTY session, and the PTY host outlives both the daemon
 * and the TUI — a `::leaf-N` session survives a flow, and the next TUI restores
 * it, so the `splits` flow's two extra panes reappear underneath every later
 * flow's screenshot. `pane-close` cannot help: it broadcasts to an ATTACHED
 * TUI, and between flows none is attached. Killing the leaf process is what
 * clears the layout; the engine session (`::tab-N`, no `::leaf-`) is left alone
 * so the workspace still photographs as a live Claude Code.
 *
 * Borrowed from `hero-plugin-demos.ts`'s `resetTakeState`, which found this the
 * same way — by photographing a previous take's leftovers.
 */
function closeStalePanes(): void {
  const sessions =
    (heroApi(["pty-list"]) as { sessions?: { key: string; pid?: number; alive?: boolean }[] }).sessions ?? []
  for (const session of sessions) {
    if (!session.key.includes("::leaf-") || !session.alive || !session.pid) continue
    try {
      process.kill(session.pid, "SIGTERM")
      console.log(`  · closed stale pane ${session.key}`)
    } catch {
      // Already gone between the list and the kill: the state we wanted.
    }
  }
}

/**
 * How many flows shoot at once.
 *
 * Boot dominates: each flow opens a page, starts a PTY, and waits for the TUI
 * to mount — measured at 226s of a 398s run (57%), and the flows that wait on a
 * seeded engine's transcript pay ~36s each. That cost is almost all IDLE time,
 * so lanes overlap it nearly for free.
 *
 * Not unbounded, though: every lane is a real PTY running a real OpenTUI
 * against one shared daemon, and `closeStalePanes` kills `::leaf-` sessions
 * process-wide — it cannot run mid-flight without shooting another lane's
 * splits. So: bounded lanes, and the pane sweep happens once up front.
 */
const LANES = Math.max(1, Number(flag("lanes") ?? 4))

const browser = await chromium.launch({ headless: true })
try {
  // Sweep once, before any lane opens a page — see LANES above for why this
  // cannot be per-flow any more.
  closeStalePanes()
  const pending = [...queue]
  await Promise.all(
    Array.from({ length: Math.min(LANES, pending.length) }, async () => {
      for (;;) {
        const flow = pending.shift()
        if (!flow) return
        await shootFlow(flow)
      }
    }),
  )
} finally {
  await browser.close()
}

/**
 * MERGE into the manifest rather than replacing it.
 *
 * A single-flow re-shoot (`shoot.ts review`) is the normal way to iterate, and
 * a plain overwrite made that run's 4 frames the WHOLE manifest — the contact
 * sheet then rendered 3 flows out of 16 and looked like the atlas had shrunk.
 * Frames on disk from other flows are still valid, so their entries survive;
 * only the flows just re-shot are replaced.
 */
const prior =
  selected.length > 0 && existsSync(join(OUT, "manifest.json"))
    ? (JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8")) as {
        flows?: ReadonlyArray<{ name: string; summary: string }>
        shots?: readonly Shot[]
      })
    : {}
const reshot = new Set(queue.map((f) => f.name))
const mergedShots = [...(prior.shots ?? []).filter((s) => !reshot.has(s.flow)), ...shots]
const mergedFlows = [
  ...(prior.flows ?? []).filter((f) => !reshot.has(f.name)),
  ...queue.map((f) => ({ name: f.name, summary: f.summary })),
]
// Keep the atlas in FLOWS order, not in the order runs happened.
const order = new Map(FLOWS.map((f, i) => [f.name, i]))
mergedFlows.sort((a, b) => (order.get(a.name) ?? 999) - (order.get(b.name) ?? 999))

writeFileSync(
  join(OUT, "manifest.json"),
  JSON.stringify(
    {
      shotAt: new Date().toISOString(),
      viewport: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
      flows: mergedFlows,
      shots: mergedShots,
    },
    null,
    2,
  ),
)
const failed = shots.filter((s) => s.failed)
const unchanged = shots.filter((s) => s.unchanged)
console.log(
  `\n${shots.length} frames → ${OUT}` +
    `${failed.length ? `  (${failed.length} threw)` : ""}` +
    `${unchanged.length ? `  (${unchanged.length} unchanged)` : ""}`,
)
for (const f of failed) console.error(`  FAILED ${f.flow}/${f.step}: ${f.failed}`)
for (const u of unchanged) console.error(`  UNCHANGED ${u.flow}/${u.step} — identical to the previous frame`)

/**
 * Undo state the PREVIOUS flow left in the TUI, before this flow's first step.
 *
 * Two leaks, both found by looking at frames rather than at exit codes:
 *
 * - **Zen mode is sticky.** The `workspace` flow ends on `ctrl+a z`, and the
 *   TUI restores it for every later flow — a whole run photographed a single
 *   column with `ZEN` in the corner, so every layout after that was wrong.
 * - **The seeded engine parks on a permission prompt.** A real Claude Code turn
 *   can stop at `Do you want to proceed? 1. Yes / 2. No`, and that modal eats
 *   every keystroke that follows. Seven frames across `review` and `splits`
 *   came back byte-identical because of it. `esc` cancels the prompt; it is
 *   harmless when no prompt is up.
 *
 * Both are advisory — a flow whose state was already clean loses nothing.
 */
async function clearInheritedState(page: Page): Promise<void> {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)
  // Leave zen if it is on. The chord is a toggle, so this is only safe because
  // `zenActive` reads the footer glyph first rather than pressing blind.
  const zenActive = await page
    .getByTestId("opentui-buffer")
    .textContent()
    .then((text) => text?.includes("ZEN") ?? false)
    .catch(() => false)
  if (zenActive) {
    await page.keyboard.press("Control+a")
    await page.waitForTimeout(200)
    await page.keyboard.press("z")
    await page.waitForTimeout(800)
  }
}

async function shootFlow(flow: Flow): Promise<void> {
  const width = flow.width ?? DEFAULT_WIDTH
  const height = flow.height ?? DEFAULT_HEIGHT
  const runId = `atlas-${flow.name}-${Date.now()}`
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  try {
    // `webgl=1` for the same reason the stills use it: the DOM renderer cannot
    // draw xterm's `customGlyphs`, so pane borders photograph with a seam at
    // every cell boundary. A failed context falls back to DOM in ChatTerminal.
    await page.goto(`http://localhost:${HERO_WEB_PORT}/harness?run=${runId}&webgl=1`).catch(() => {
      throw new Error(`no server on :${HERO_WEB_PORT} — start \`bun e2e/hero-serve.ts\` first`)
    })
    await page.getByTestId("opentui-harness").waitFor({ timeout: 15_000 })
    // TUI takeover marker: the hero repo's own row in the sidebar tree.
    const buffer = await page.getByTestId("opentui-buffer").elementHandle()
    await page.waitForFunction((el) => el?.textContent?.includes("orbit-sdk"), buffer, { timeout: 60_000 })
    // Click low in the rail — (24, 24) would land on the project header.
    await page.getByTestId("opentui-terminal").click({ position: { x: 24, y: Math.min(400, height - 80) } })
    // Wait for the FOOTER instead of a blind 2s: it is the last chrome the TUI
    // paints, so its presence is the real "mounted and interactive" signal.
    // The fixed sleep was both too long on a warm stack and too short on a cold
    // one — this is typically ~300ms and self-adjusts.
    await page
      .waitForFunction(
        (el) => (el as Element | null)?.textContent?.includes("F1 help") ?? false,
        buffer,
        { timeout: 15_000, polling: 150 },
      )
      .catch(() => {})
    await clearInheritedState(page)

    let lastDigest: string | null = null
    for (const [index, step] of flow.steps.entries()) {
      const file = `${flow.name}-${String(index + 1).padStart(2, "0")}-${step.name}.png`
      const shot: Shot = { flow: flow.name, step: step.name, index, file, subject: step.subject }
      try {
        await step.drive(page)
      } catch (err) {
        // Shoot anyway: the frame of a step that went wrong is the evidence.
        shot.failed = err instanceof Error ? err.message : String(err)
      }
      await page.screenshot({ path: join(OUT, file) })
      // A step that changes nothing photographs the PREVIOUS step again, and
      // that failure is otherwise invisible: no throw, no timeout, exit 0. One
      // run shipped 17 duplicate frames across 5 flows — a chat composer eating
      // the keys, a modal swallowing them, a `d` on a directory row — and the
      // manifest called all 48 successful. Compare bytes and say so.
      const digest = createHash("sha1").update(readFileSync(join(OUT, file))).digest("hex")
      if (digest === lastDigest) shot.unchanged = true
      lastDigest = digest
      shots.push(shot)
      console.log(`  ${file}${shot.failed ? "  [step threw]" : ""}${shot.unchanged ? "  [UNCHANGED — step did nothing]" : ""}`)
    }
  } catch (err) {
    console.error(`FLOW ${flow.name} aborted: ${err instanceof Error ? err.message : err}`)
    shots.push({ flow: flow.name, step: "<boot>", index: -1, file: "", subject: flow.summary, failed: String(err) })
  } finally {
    await page.request
      .post(`http://127.0.0.1:${HERO_PTY_PORT}/pty/close`, { data: { tab: `visual-${runId}` } })
      .catch(() => {})
    await page.close().catch(() => {})
  }
}
