/**
 * IBM Bob Shell login detection — the per-engine half of `account-detect.ts`,
 * which keeps the shared surface (the `DetectDeps` seam, the binary probe,
 * the vendor list) and the older engines' detectors.
 *
 * Bob logs in two ways. Interactive: the first `bob chat` opens
 * bob.ibm.com/login in a browser (IBMid or corporate SSO) and stores the
 * OAuth token bundle in `~/.bob/settings/auth-secrets.json` — a flat JSON map
 * whose values are the serialized token records. Headless: `BOB_API_KEY`
 * (legacy spelling `BOBSHELL_API_KEY`). There is no `bob login` verb and no
 * identity in the token store Rove can read, so a logged-in account is
 * reported without an email.
 */

import { errorMessage } from "@/lib/error-message"
import {
  type DetectDeps,
  type EngineAccountStatus,
  defaultDetectDeps,
  hasStringDeep,
  isRecord,
  probeBinary,
} from "../account-detect"
import { bobAuthSecretsPath } from "../vendor-home"

export type BobAccount = { kind: "oauth" } | { kind: "apikey" } | { kind: "none" }

/** Token-record keys that mean "a login happened", in either casing bob's
 *  bundle uses (`access_token` on the wire, `accessToken` in its session). */
const BOB_TOKEN_KEYS = ["access_token", "refresh_token", "accessToken", "refreshToken", "id_token"] as const

export async function detectBobAccount(deps: DetectDeps = defaultDetectDeps): Promise<EngineAccountStatus<BobAccount>> {
  const binary = await probeBinary(() => deps.findBobBinary())
  // The key wins over the token store: a set `BOB_API_KEY` is what bob itself
  // uses first, and it is the only login a headless machine has.
  const key = deps.env("BOB_API_KEY") ?? deps.env("BOBSHELL_API_KEY")
  if (typeof key === "string" && key.trim().length > 0) return { binary, account: { kind: "apikey" } }
  const secretsPath = bobAuthSecretsPath(deps.env, deps.home())
  let raw: string | null
  try {
    raw = deps.readFile(secretsPath)
  } catch (err) {
    return { binary, account: { kind: "none" }, accountError: `read ${secretsPath}: ${errorMessage(err)}` }
  }
  if (raw === null) return { binary, account: { kind: "none" } }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { binary, account: { kind: "none" }, accountError: `parse ${secretsPath}: ${errorMessage(err)}` }
  }
  if (!isRecord(parsed)) return { binary, account: { kind: "none" } }
  // The store is `{ "<key>": <record or its JSON string> }`. A value that is
  // itself JSON text is unwrapped one level so the token keys inside it count.
  for (const value of Object.values(parsed)) {
    const record = typeof value === "string" ? parseJsonRecord(value) : value
    if (hasStringDeep(record, BOB_TOKEN_KEYS)) return { binary, account: { kind: "oauth" } }
  }
  return { binary, account: { kind: "none" } }
}

function parseJsonRecord(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
