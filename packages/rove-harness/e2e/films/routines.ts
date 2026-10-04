/**
 * The ROUTINES feature demo: scheduled prompts the daemon owns, each with the
 * repo it runs in, when it fires next, and the prompt/precheck/run history
 * behind it — then a routine being composed, with the cron cells restating the
 * next fire time in the operator's own clock as they change. That preview is
 * the reason the composer is a card of five labelled cells and not a raw cron
 * string, so it is the beat the take is built around.
 *
 * Costs NO engine quota and involves no live turn: a routine is a daemon
 * record, and the fixture already seeds three. The take deliberately stops
 * short of `run now` / `s` — a firing creates a task and boots an engine in a
 * worktree Claude Code has never seen, which raises the first-run folder-trust
 * prompt (see `hero-seed.ts`) and would film a modal instead of the product.
 *
 * Idempotent, unlike `films/kanban.ts`: the routine composed on camera is
 * deleted through `rove api routine-delete` after the take, so a re-shoot
 * starts from the same three rows the stills were framed on.
 */

import { clickText, look, press, type as typeText } from "../hero-capture.ts"
import { heroApi } from "../hero-fixture.ts"
import type { Film } from "../film/film.ts"

/**
 * The routine composed on camera, then removed after the take. The name has
 * to agree with the schedule the cron beat lands on (`weekdays at 12:00`) —
 * a demo that files "Nightly …" against a midday schedule reads as a bug. The
 * prompt stays under the field's 57 columns: a longer one scrolls its first
 * characters out of view ("mmarize what merged…") while it is typed.
 */
const NEW_ROUTINE = {
  name: "Midday changelog sweep",
  prompt: "Summarize today's merges and update the changelog.",
} as const

/** Leave the fixture as we found it, so the next shoot frames the same rows. */
function removeComposedRoutine(): void {
  type Automation = { id: string; name: string }
  const listed = (heroApi(["routine-list"]) as { automations?: Automation[] }).automations ?? []
  const composed = listed.find((automation) => automation.name === NEW_ROUTINE.name)
  if (!composed) {
    console.error(`[film:routines] the compose beat created nothing — nothing to clean up`)
    return
  }
  heroApi(["routine-delete", "--id", composed.id])
  console.log(`[film:routines] removed ${composed.id} — fixture restored to 3 routines`)
}

export const routines: Film = {
  name: "routines",
  async take(page, cue) {
    // Beat 1 — the page, opened the discoverable way: the sidebar's own
    // Routines row (`ctrl+a` `2` does the same thing). The header's "keeping
    // the daemon awake" is the claim that this runs with no TUI attached. The
    // cut opens on the click: a poster frame of "no task selected" undersells
    // the page the clip is about.
    await page.waitForTimeout(800)
    await cue("open")
    await clickText(page, "Routines")
    await look(page, "ROUTINES", 15_000)
    await page.waitForTimeout(4_000)

    // Beat 2 — walking the rows swaps the detail box: each routine's prompt,
    // its precheck if it has one, and what its recent runs did. Row three is
    // paused, which is what an `e` toggle looks like from the list.
    await press(page, "j")
    await page.waitForTimeout(2_400)
    await press(page, "j")
    await page.waitForTimeout(2_800)

    // Beat 3 — pause and resume, on camera. `e` is how a schedule is silenced
    // without losing it; the row says `paused` and the daemon-hold header
    // follows the enabled set.
    await press(page, "e")
    await page.waitForTimeout(1_800)
    await press(page, "e")
    await page.waitForTimeout(1_800)
    await press(page, "k", "k")
    await page.waitForTimeout(1_200)

    // Beat 4 — composing one. Fields are walked with tab (name → repo →
    // deliver to → prompt → schedule → confirm); the repo is a picker over
    // saved projects.
    await press(page, "n")
    await look(page, "New routine", 10_000)
    await page.waitForTimeout(1_200)
    await typeText(page, NEW_ROUTINE.name)
    await press(page, "tab") // → repo
    await page.waitForTimeout(1_000)
    await press(page, "tab") // → deliver to
    await press(page, "tab") // → prompt
    await page.waitForTimeout(800)
    await typeText(page, NEW_ROUTINE.prompt)
    await page.waitForTimeout(1_000)

    // Beat 5 — the payoff. `←`/`→` pick a cron cell and `↑`/`↓` change it, and
    // the green line under the cells restates the schedule in the operator's
    // own clock every time — a cron you got wrong is visible before you save.
    await press(page, "tab") // → schedule
    await page.waitForTimeout(1_200)
    await press(page, "right") // → hour
    await page.waitForTimeout(600)
    await press(page, "up", "up", "up") // 09 → 12, and the preview follows
    await page.waitForTimeout(1_800)
    // The weekday cell moves and comes BACK: the point is that ↑/↓ edit the
    // highlighted cell, and the take still has to land on a schedule the
    // routine's own name claims.
    await press(page, "right", "right", "right") // → weekday
    await page.waitForTimeout(600)
    await press(page, "down")
    await page.waitForTimeout(1_400)
    await press(page, "up")
    await page.waitForTimeout(2_200)

    // Beat 6 — create it. The row lands in the list with its own next-run time,
    // computed from the cells that were just edited. The take ENDS on the list
    // rather than on the composer: the page is the subject.
    await press(page, "tab") // → confirm
    await page.waitForTimeout(800)
    await press(page, "enter")
    await look(page, NEW_ROUTINE.name, 10_000)
    await page.waitForTimeout(5_000)
    await cue("end")
  },
  afterTake: removeComposedRoutine,
  // Read (schedules, a prompt, a preview recomputing), not skimmed: the same
  // 3× as kanban.
  cut: [{ from: "open", to: "end", rate: 3 }],
  out: { mp4: "docs/assets/routines.mp4", gif: "docs/assets/routines.gif" },
}
