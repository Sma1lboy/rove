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
const apiKey = setting(ctx.configDir, "EX_DEMO_API_KEY", "")

console.log("settings-demo effective config:")
console.log(`  actionId:   ${ctx.actionId ?? "<none>"}`)
console.log(`  invokeCwd:  ${ctx.invokeCwd ?? "<none>"}`)
console.log(`  name:       ${name}`)
console.log(`  theme:      ${theme}`)
console.log(`  notify:     ${notify}`)
// A `secret` is masked in Settings; print it the same way. Plugin stdout is
// captured into log.jsonl, which `rove plugin log` then displays.
console.log(`  apiKey:     ${apiKey ? "<set>" : "<unset>"}`)
console.log("raw .env:")
for (const [key, value] of Object.entries(readSettings(ctx.configDir))) {
  console.log(`  ${key}=${key === "EX_DEMO_API_KEY" ? "<redacted>" : value}`)
}
