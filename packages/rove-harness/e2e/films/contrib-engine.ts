/** `[[engines]]`: a manifest-only plugin contributing a coding CLI. */

import { look, press } from "../hero-capture.ts"
import { openWorkspace, pickBackwards, pluginFilm } from "./plugin-shared.ts"

export const contribEngine = pluginFilm({
  name: "contrib-engine",
  rate: 2,
  storyboard: async (page) => {
    await openWorkspace(page)

    // The whole claim is one frame: the engine list Rove offers now
    // carries an engine no Rove build ships. `fake-coder` is the id from
    // the plugin's `[[engines]]` table.
    await press(page, "ctrl+e")
    await look(page, "fake-coder", 10_000)
    await page.waitForTimeout(4_000)

    // Walk the ring onto it so the highlight names it, then hold. The take
    // stops short of launching: the example's command is a placeholder
    // `echo`, and filming it exit immediately would undersell the seam.
    // Backwards from `claude`: scratch shell, Task Board, shell, fake-coder.
    // Counting forward breaks whenever a built-in engine is added ahead of it.
    await pickBackwards(page, 4)
    await page.waitForTimeout(4_000)
    await press(page, "esc")
    await page.waitForTimeout(1_500)
  },
})
