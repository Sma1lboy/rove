/**
 * Action entrypoint: read declared plugin settings from the config .env and
 * print the effective values.
 *
 * Demonstrates readSettings(), setting(), and the action-specific env contract
 * (ROVE_PLUGIN_ACTION_ID, ROVE_PLUGIN_INVOKE_CWD).
 */
import { pluginContext, readSettings, setting } from "@sma1lboy/rove-plugin-sdk"

const ctx = pluginContext()

const name = setting(ctx.configDir, "EX_DEMO_NAME", "Rover")
const theme = setting(ctx.configDir, "EX_DEMO_THEME", "system")
const notifyRaw = setting(ctx.configDir, "EX_DEMO_NOTIFY", "1")
const notify = notifyRaw === "1" || notifyRaw.toLowerCase() === "true"

console.log("settings-demo effective config:")
console.log(`  actionId:   ${ctx.actionId ?? "<none>"}`)
console.log(`  invokeCwd:  ${ctx.invokeCwd ?? "<none>"}`)
console.log(`  name:       ${name}`)
console.log(`  theme:      ${theme}`)
console.log(`  notify:     ${notify}`)
console.log("raw .env:")
for (const [key, value] of Object.entries(readSettings(ctx.configDir))) {
  console.log(`  ${key}=${value}`)
}
