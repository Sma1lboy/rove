/** `[[events]]`: a hook that runs because something happened in Rove. */

import { look, press } from "../hero-capture.ts"
import { HERO_REPO } from "../hero-env.ts"
import { heroApi } from "../hero-fixture.ts"
import type { Film } from "../film/film.ts"
import { openPluginsSection, pluginFilm, resetTakeState, STORY_TITLE } from "./plugin-shared.ts"

/**
 * Remove the story the take filed, so a re-shoot does not stack a second card.
 * The fixture's own board already holds a story with this title, so only the
 * NEWEST one (the take's) goes.
 */
function removeFiledStory(): void {
  const { issues = [] }: { issues?: { id: number; title: string }[] } = heroApi(["issue-list", "--repo", HERO_REPO])
  const copies = issues.filter((issue) => issue.title === STORY_TITLE)
  const filed = copies.length > 1 ? copies.reduce((a, b) => (b.id > a.id ? b : a)) : undefined
  if (!filed) return
  heroApi(["issue-delete", "--repo", HERO_REPO, "--id", String(filed.id)])
  console.log(`[film:hello-events] removed filed story #${filed.id}`)
}

const base = pluginFilm({
  name: "hello-events",
  rate: 2,
  storyboard: async (page) => {
    // Beat 1 — the plugin as the host sees it: two declared events, and a
    // run history that is still empty.
    await press(page, "ctrl+a")
    await page.waitForTimeout(600)
    await press(page, ",")
    await look(page, "Settings", 15_000)
    await page.waitForTimeout(1_500)
    await openPluginsSection(page)
    await look(page, "examples.hello-events", 10_000)
    await page.waitForTimeout(4_000)

    // Beat 2 — fire a real `issue.changed` from outside the TUI, exactly
    // as an agent would. The daemon dispatches it to the plugin's hook.
    heroApi(["issue-create", "--repo", HERO_REPO, "--title", STORY_TITLE])
    await page.waitForTimeout(4_000)

    // Beat 3 — leave the section and come back, which is what makes the
    // run appear. The Plugins section reads the registry ONCE per open
    // (`use-section-data.ts` keys its effect on `section`), so the row
    // never ticks over while it is on screen. `h` alone is not enough —
    // it only moves the cursor back to the section rail without changing
    // which section is open, so the effect does not re-run and the take
    // films a stale "never run". Switching to a DIFFERENT section and
    // back is the thing that re-reads.
    // Detour through Marketplace, the neighbour below Plugins, and come back.
    // Above Plugins sits Auto routing, which is the API-key page.
    await press(page, "h")
    await page.waitForTimeout(600)
    await press(page, "j") // → Marketplace
    await page.waitForTimeout(1_500)
    await press(page, "k") // → Plugins, re-read
    await page.waitForTimeout(1_200)
    await press(page, "l")
    await look(page, "issue.changed", 10_000)
    await page.waitForTimeout(5_000)

    // The take ENDS on the run summary rather than following the story onto
    // the board. The board beat was tried and dropped: the story this take
    // files is a real record with no cleanup, so each re-shoot stacks
    // another identical card and by the third pass the column photographs
    // as five copies of one title. The subject here is the hook that ran,
    // and that is already on screen.
    await press(page, "esc")
    await page.waitForTimeout(1_500)
  },
})

export const helloEvents: Film = {
  ...base,
  afterTake: async (): Promise<void> => {
    await resetTakeState()
    removeFiledStory()
  },
}
