/** `[[settings]]` + `[[actions]]`: declared settings, edited by the host. */

import { look, press } from "../hero-capture.ts"
import { openPluginsSection, pluginFilm } from "./plugin-shared.ts"

export const settingsDemo = pluginFilm({
  name: "settings-demo",
  rate: 2,
  storyboard: async (page) => {
    // Beat 1 — Settings → Plugins: every linked plugin, what it declares,
    // and the settings rows the manifest asked the host to render.
    await press(page, "ctrl+a")
    await page.waitForTimeout(600)
    await press(page, ",")
    await look(page, "Settings", 15_000)
    await page.waitForTimeout(2_000)
    await openPluginsSection(page)
    await look(page, "examples.settings-demo", 10_000)
    await page.waitForTimeout(4_000)

    // Beat 2 — walk down onto this plugin's own settings rows. The values
    // are the plugin's, the editors are Rove's.
    for (let step = 0; step < 5; step += 1) {
      await press(page, "j")
      await page.waitForTimeout(600)
    }
    await page.waitForTimeout(3_000)

    // Beat 3 — the enum row cycles through the options the manifest
    // declared, and the value reaches the plugin on its next run.
    await press(page, "enter")
    await page.waitForTimeout(2_500)
    await press(page, "esc")
    await page.waitForTimeout(2_500)
  },
})
