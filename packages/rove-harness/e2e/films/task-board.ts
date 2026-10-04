/** `[[panes]]`: the plugin's own surface, drawn beside the engine. */

import { look, press } from "../hero-capture.ts"
import { HERO_REPO } from "../hero-env.ts"
import { heroApi } from "../hero-fixture.ts"
import { BOARD_TASK_TITLE, openWorkspace, pickBackwards, pluginFilm } from "./plugin-shared.ts"

export const taskBoard = pluginFilm({
  name: "task-board",
  rate: 2,
  storyboard: async (page) => {
    await openWorkspace(page)

    // Beat 1 — the picker, where a plugin pane is offered next to the
    // engines. `Task Board` is the plugin's declared title, verbatim.
    await press(page, "ctrl+e")
    await look(page, "Task Board", 10_000)
    await page.waitForTimeout(3_000)

    // Beat 2 — pick it and let it split. Two steps back from `claude`
    // wraps past `scratch shell` onto the pane.
    await pickBackwards(page, 2)
    await page.waitForTimeout(1_200)
    await press(page, "enter")
    await look(page, "TASK BOARD", 20_000)
    await page.waitForTimeout(5_000)

    // Beat 3 — the board is LIVE, not a snapshot: a task created from
    // outside the TUI arrives over the `task.snapshot` channel the pane
    // subscribed to, and the pane redraws itself.
    heroApi(["add", "--repo", HERO_REPO, "--title", BOARD_TASK_TITLE])
    await look(page, BOARD_TASK_TITLE, 20_000)
    await page.waitForTimeout(6_000)
  },
})
