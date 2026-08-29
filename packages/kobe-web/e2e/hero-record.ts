/**
 * `bun e2e/hero-record.ts [--out=dir]` — record the README demo through the
 * sanctioned `/harness` path (`hero-serve.ts` must be running), then encode it
 * to `demo.mp4` + `demo.gif`.
 *
 * What it films is the pitch itself: two tasks alive at once, each on its own
 * worktree and branch, both driven from one TUI — a real follow-up typed into
 * each, real turns running side by side, and the diff of the work at the end.
 * Every pixel is the product's own rendering; nothing is staged in a mock.
 *
 * The turns are REAL, so the recording is nondeterministic and costs quota.
 * Waits are therefore advisory: a beat that never matches its marker times out
 * and the storyboard moves on, because a half-recorded demo is worth more than
 * a hung capture.
 *
 * Browser/PTY plumbing and the ffmpeg encode live in `hero-capture.ts`; this
 * file is only the storyboard. The kanban feature demo is `hero-kanban.ts`.
 */

import { mkdir, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { Page } from "@playwright/test"
import { REPO_ROOT, click, encode, gone, press, record, type as typeText } from "./hero-capture.ts"

const args = process.argv.slice(2)
const outDir = resolve(args.find((arg) => arg.startsWith("--out="))?.slice(6) ?? join(REPO_ROOT, "docs", "assets"))
const workDir = join(REPO_ROOT, ".scratch", "hero-record")
/** Real seconds per delivered second. A live turn is minutes; a README is not. */
const SPEED = Number(args.find((arg) => arg.startsWith("--speed="))?.slice(8) ?? 4)

/** Sidebar row centres at 1280×800 — rows are 16px apart under the header. */
const ROW = { taskA: 215, taskB: 247, routines: 103 } as const
const COMPOSER = { x: 600, y: 711 } as const

async function storyboard(page: Page): Promise<void> {
  // Beat 0 — clear whatever the LAST take left the session sitting on.
  // Engine sessions are hosted and survive a recording, so a take that ended
  // on a permission prompt hands the next one that prompt as its opening
  // frame — which is exactly what shipped: the README demo began on a dialog
  // waiting for a human. `esc` dismisses it; on a clean session it is a
  // no-op, so this costs one keystroke and removes a whole class of bad take.
  await click(page, 80, ROW.taskA)
  await page.waitForTimeout(2_000)
  await press(page, "esc")
  await page.waitForTimeout(1_500)

  // Beat 1 — one task's finished turn: its own branch, its own commit.
  await page.waitForTimeout(2_500)

  // Beat 2 — a follow-up typed into that live session. `ctrl+u` first: the
  // composer is the engine's, and whatever a previous take left in it stays.
  await click(page, COMPOSER.x, COMPOSER.y)
  await press(page, "ctrl+u")
  // Scoped deliberately. "Add a test for the timeout" invites the engine to
  // PROVE the test is not vacuous — it reached for `sed` to strip the timeout
  // and re-run, which is outside the capture's `Bash(git *)`/`Bash(bun test*)`
  // allowlist, so the take filmed an approval dialog waiting on a human. The
  // fix is a narrower ask, not a wider allowlist: a README demo should not
  // need an unattended agent to hold broader permissions.
  await typeText(page, "Add one test asserting the timeout rejects, then commit.")
  await press(page, "enter")

  // Beat 3 — enough of the turn to see it start, then leave. A previous cut
  // held a fixed 90s here and filmed the back half of it frozen on a finished
  // answer; the point of this beat is that you DON'T sit and watch, so the
  // camera does not either.
  await page.waitForTimeout(12_000)

  // Beat 4 — the second task, mid-flight the whole time, on its own worktree
  // and branch. This is the claim the whole product rests on.
  await click(page, 80, ROW.taskB)
  await page.waitForTimeout(8_000)

  // Beat 5 — and the work nobody has to sit through: scheduled prompts that
  // spawn their own tasks.
  await click(page, 40, ROW.routines)
  await page.waitForTimeout(6_000)

  // Beat 6 — back to the first agent, which finished while we were elsewhere.
  // Waiting for the working marker to CLEAR is what makes this beat land on a
  // result instead of on more scrolling: `esc to interrupt` is in the status
  // line only while a turn runs, so its absence is the turn being done.
  await click(page, 80, ROW.taskA)
  await gone(page, "esc to interrupt", 150_000)
  await page.waitForTimeout(7_000)
}

/** Re-encode the take already on disk — the storyboard costs real turns. */
if (!args.includes("--encode-only")) {
  await rm(workDir, { recursive: true, force: true })
  await mkdir(workDir, { recursive: true })
  await record(workDir, storyboard)
}
// `startAt` drops the harness settling into the TUI. Without it the first
// frame is the black terminal before OpenTUI paints — and that frame is also
// the poster every embed shows before playback.
await encode({ workDir, outDir, name: "demo", speed: SPEED, startAt: 1.5 })
