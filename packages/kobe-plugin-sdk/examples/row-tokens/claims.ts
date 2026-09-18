/**
 * Plugin-owned claim state: taskId → reviewer, in the plugin's own state dir.
 *
 * Deliberately NOT a Rove field. The whole reason a plugin needs row tokens
 * is that its state is its own — Rove has no idea what a review queue is, and
 * should not learn.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pluginContext } from "@sma1lboy/rove-plugin-sdk"

const FILE = join(pluginContext().stateDir, "claims.json")

export type Claims = Record<string, string>

export function readClaims(): Claims {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Claims
  } catch {
    return {} // no file yet, or unreadable — an empty queue either way
  }
}

export function writeClaims(claims: Claims): void {
  mkdirSync(pluginContext().stateDir, { recursive: true })
  writeFileSync(FILE, JSON.stringify(claims, null, 2))
}

/**
 * Refresh window. Shorter than the event cadence that renews it would be a
 * label that blinks; much longer would be a claim that outlives the session
 * that made it. Ten minutes is one review.
 */
export const CLAIM_TTL_SECONDS = 600
