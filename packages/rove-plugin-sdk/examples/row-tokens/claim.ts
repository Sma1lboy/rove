/**
 * Action: claim the ACTIVE task for review (or `--release` it).
 *
 * Note the task resolution: an `[[actions]]` entrypoint gets
 * `ROVE_PLUGIN_ACTION_ID` and `ROVE_PLUGIN_INVOKE_CWD` but NO
 * `ROVE_PLUGIN_TASK_ID` (see the environment contract), so an action that
 * wants "the task the user is looking at" reads `activeTaskId` from
 * `rove api list`. Event hooks get the id directly — see `refresh.ts`.
 *
 * The claim is the plugin's own state; the row token is how the human sees
 * it. Release does BOTH — drops the state and clears the token rather than
 * waiting out the TTL, because a stale claim is exactly what the next
 * reviewer would act on.
 */
import { clearRowToken, listTasks, promptUser, setRowToken } from "@sma1lboy/rove-plugin-sdk"
import { CLAIM_TTL_SECONDS, readClaims, writeClaims } from "./claims.ts"

const { activeTaskId } = await listTasks<{ activeTaskId: string | null }>()
if (!activeTaskId) {
  console.error("row-tokens: no active task — open one first")
  process.exit(1)
}

const claims = readClaims()

if (process.argv.includes("--release")) {
  delete claims[activeTaskId]
  writeClaims(claims)
  await clearRowToken(activeTaskId)
  console.log(`row-tokens: released ${activeTaskId}`)
} else {
  const who = await promptUser("Claim as", { initial: claims[activeTaskId] ?? "" })
  if (!who) {
    console.log("row-tokens: cancelled")
    process.exit(0)
  }
  claims[activeTaskId] = who
  writeClaims(claims)
  // `tone` names a ROLE, not a colour: whatever theme the user runs decides
  // what "info" looks like, so the label can never clash with their palette.
  const shown = await setRowToken(activeTaskId, `@${who}`, {
    key: "claim",
    ttlSeconds: CLAIM_TTL_SECONDS,
    tone: "info",
  })
  // `false` is an older host with no row-token surface. The claim is still
  // recorded; it just is not painted. Never a reason to fail the action.
  console.log(`row-tokens: claimed by ${who}${shown ? "" : " (host has no row tokens — label skipped)"}`)
}
