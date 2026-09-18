/**
 * Event hook: re-stamp the claim label for the task that just changed state.
 *
 * This is the TTL contract from the writer's side. The token only exists
 * between refreshes, so the label on screen is evidence that THIS plugin is
 * alive and still believes the claim — not a record that something once
 * wrote it. Disable the plugin and every label it painted is gone within
 * `CLAIM_TTL_SECONDS`, with nothing to clean up.
 */
import { pluginEvent, setRowToken } from "@sma1lboy/rove-plugin-sdk"
import { CLAIM_TTL_SECONDS, readClaims } from "./claims.ts"

const ev = pluginEvent()
const taskId = ev?.taskId
if (!taskId) process.exit(0)

const who = readClaims()[taskId]
// Not claimed: write nothing. Letting an unclaimed row's old token lapse is
// the correct removal — there is no "clear" to schedule and nothing to undo.
if (!who) process.exit(0)

await setRowToken(taskId, `@${who}`, { key: "claim", ttlSeconds: CLAIM_TTL_SECONDS, tone: "info" })
