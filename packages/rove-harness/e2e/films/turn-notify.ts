/** `[[events]]` + `notify()`: a hook calling back INTO the host UI. */

import { look } from "../hero-capture.ts"
import { heroApi } from "../hero-fixture.ts"
import { openWorkspace, pluginFilm } from "./plugin-shared.ts"

export const turnNotify = pluginFilm({
  name: "turn-notify",
  rate: 2,
  storyboard: async (page) => {
    await openWorkspace(page)

    // One beat, and it is the whole point: an engine turn completes, the
    // plugin's hook runs, and the toast on screen is the plugin's own copy
    // delivered through Rove's notification surface. `engine-report` is the
    // documented way a wrapper reports its own activity — the same RPC the
    // built-in hook adapters use, so nothing here is staged.
    const { tasks = [] }: { tasks?: { id: string; title: string }[] } = heroApi(["list"])
    const task = tasks.find((candidate) => candidate.title === "orbit-sdk")
    if (!task) throw new Error("no project-main task to report a turn for")
    await page.waitForTimeout(2_000)
    heroApi(["engine-report", "--kind", "turn-complete", "--task-id", task.id])
    await look(page, "completed a turn", 20_000)
    await page.waitForTimeout(7_000)
  },
})
