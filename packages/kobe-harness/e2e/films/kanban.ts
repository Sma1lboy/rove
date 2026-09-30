/**
 * The KANBAN feature demo: the daemon-owned issue store as Backlog / In
 * progress / Done, a story you can open and edit, a story filed from the TUI —
 * and a card that MOVES because an agent moved it. That last beat is a real
 * `rove api issue-update --task` fired from outside the TUI while the page is
 * open, which is exactly the call an agent makes; the board's poll picks it
 * up on camera.
 *
 * No engine quota. It deliberately stops short of the drawer's Start action:
 * a story started into its own worktree boots the engine in a directory
 * Claude Code has never seen, which raises the first-run folder-trust prompt
 * (see `hero-seed.ts`) and would film a modal instead of the product.
 *
 * NOT idempotent: the take files a real story and creates the task it gets
 * linked to. Take from a clean board — `bun e2e/hero-fixture.ts --fresh &&
 * bun e2e/hero-issues.ts`.
 */

import { clickText, look, press, type as typeText } from "../hero-capture.ts"
import { HERO_REPO } from "../hero-env.ts"
import { heroApi } from "../hero-fixture.ts"
import type { Film } from "../film/film.ts"

/** The story filed on camera, then handed to an "agent" in the next beat. */
const NEW_STORY = {
  title: "Warn on unbounded page size",
  body: "Reject page sizes over 500 instead of truncating silently.",
} as const

/**
 * The agent's half of the story: link the freshly filed issue to a task.
 * The LINK is what puts a card in the In-progress column, and
 * `rove api issue-update --task` is the documented way an agent moves its
 * own card — so the move on screen is the real mechanism, not a repaint.
 */
function agentPicksUpStory(): void {
  const { issues } = heroApi(["issue-list", "--repo", HERO_REPO])
  const story = Array.isArray(issues)
    ? issues.find((issue) => issue?.title === NEW_STORY.title && typeof issue.id === "number")
    : undefined
  if (!story) throw new Error("the intake beat filed no story")
  // Same `#id title` shape a story-spawned task carries in the sidebar.
  const { taskId } = heroApi(["add", "--repo", HERO_REPO, "--title", `#${story.id} ${story.title}`])
  if (typeof taskId !== "string") throw new Error("no task created for the agent move")
  heroApi(["issue-update", "--repo", HERO_REPO, "--id", String(story.id), "--task", taskId])
}

export const kanban: Film = {
  name: "kanban",
  async take(page, cue) {
    // The board, opened the discoverable way: the sidebar's own Kanban row.
    // The cut opens a beat before the click, on the workspace it leaves.
    await page.waitForTimeout(800)
    await cue("open")
    await clickText(page, "Kanban")
    await look(page, "In progress", 15_000)
    await page.waitForTimeout(4_000)

    // The card cursor walks out of In progress and down the backlog.
    await press(page, "left")
    await page.waitForTimeout(700)
    for (let step = 0; step < 3; step += 1) {
      await press(page, "down")
      await page.waitForTimeout(500)
    }
    await page.waitForTimeout(1_200)

    // The detail drawer: the story is editable, and it carries the
    // configuration a session would start with.
    await press(page, "enter")
    await look(page, "WORKSPACE", 10_000)
    await page.waitForTimeout(3_000)
    await press(page, "shift+tab") // → ENGINE
    await page.waitForTimeout(600)
    await press(page, "right", "right", "left", "left") // Codex, Copilot, back to Claude
    await page.waitForTimeout(600)
    await press(page, "tab") // → WORKSPACE
    await page.waitForTimeout(600)
    await press(page, "down", "down", "up", "up") // the three placements, back to the default
    await page.waitForTimeout(1_500)
    await press(page, "esc") // saves the (unchanged) draft and closes
    await page.waitForTimeout(2_000)

    // Filing a story from the TUI. `ctrl+s` files it without starting
    // anything; enter would file it AND start the engine.
    await press(page, "n")
    await look(page, "NEW STORY", 10_000)
    await page.waitForTimeout(1_000)
    await typeText(page, NEW_STORY.title)
    await press(page, "tab")
    await typeText(page, NEW_STORY.body)
    await page.waitForTimeout(1_000)
    await press(page, "ctrl+s")
    await look(page, "unbounded", 10_000)
    await page.waitForTimeout(2_500)

    // An agent picks the story up from outside the TUI; the board's poll
    // (5s) moves the card and the sidebar grows the task. The take ENDS on
    // the board: closing it lands on a task with no worktree.
    agentPicksUpStory()
    await page.waitForTimeout(14_000)
    await cue("end")
  },
  cut: [{ from: "open", to: "end", rate: 3 }],
  out: { mp4: "docs/assets/kanban.mp4", gif: "docs/assets/kanban.gif" },
}
