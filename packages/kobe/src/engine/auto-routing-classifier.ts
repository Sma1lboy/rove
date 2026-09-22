/**
 * The PICKER: which tier a prompt deserves.
 *
 * `auto-routing.ts` owns the TABLE (tier → engine/model/effort) and the GATE
 * (can that target start). Neither of them reads the user's sentence. This
 * file is the third piece, and it is deliberately a SOCKET rather than a
 * model: `autoRouting.classifier` names who answers the question, and the
 * contract is one line — **POST some text, get back a tier and a confidence.**
 *
 *   off (default)  nothing is sent anywhere
 *   jev            TypeSafe System One, with the request shape below
 *   https://…      your own endpoint, `{ text } → { tier, confidence }`
 *
 * Four rules this module exists to keep, from
 * `docs/design/auto-routing-classifier.md`:
 *
 *   1. **Default off.** Rove is local-first; creating a task must not grow a
 *      network call nobody asked for.
 *   2. **Below the threshold, don't guess.** A wrong pre-fill is worse than
 *      none — the user has to notice it before they can undo it.
 *   3. **Never block a create.** No key, no network, a timeout, an endpoint
 *      answering rubbish: all of it comes back as "no pick". Nothing here
 *      throws, and nothing here is on a path that can fail a task.
 *   4. **Say where the text goes.** The prompt reaches a third party that is
 *      NOT the engine vendor the user chose. That belongs in the docs next to
 *      the setting (docs/CONFIGURATION.md), never behind it.
 *
 * Answer validation lives in `tier-answer.ts`; the judgement itself is
 * generated from `docs/design/auto-routing/` into `tier-rubric.generated.ts`.
 */

import { getPersistedValue } from "@/state/repos"
import { type TierVerdict, readJevAnswer, readPlainAnswer } from "./tier-answer.ts"
import type { TierRubric } from "./tier-rubric-types.ts"
import { DEFAULT_TIER_RUBRIC } from "./tier-rubric.generated.ts"

/** TypeSafe System One. The only endpoint this file knows by name. */
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone"

/** Prompt text beyond this is cut — the request has a 32k ceiling, and a
 *  tier is decided by the first paragraph, never by the last one. */
export const PROMPT_LIMIT = 1200

const DEFAULT_THRESHOLD = 0.5
const DEFAULT_TIMEOUT_MS = 4000
const DEFAULT_MODEL = "jev-latest"
const DEFAULT_KEY_ENV = "TYPESAFE_API_KEY"

/** Who answers "which tier". */
export type ClassifierMode =
  | { readonly kind: "off" }
  | { readonly kind: "jev" }
  | { readonly kind: "url"; readonly url: string }
  /**
   * The setting names a destination this will not post to. Distinct from
   * `off` because the intent is legible: someone typed an address, and a
   * silent "off" would leave them watching a feature they configured do
   * nothing at all.
   */
  | { readonly kind: "refused"; readonly why: string }

export interface ClassifierConfig {
  readonly mode: ClassifierMode
  /** Below this confidence the pick is dropped. `autoRouting.classifierThreshold`. */
  readonly threshold: number
  readonly timeoutMs: number
  /** Model id for `jev` — pin a version here to stop a silent upgrade. */
  readonly model: string
  /**
   * Name of the environment variable holding the bearer token for THIS mode.
   *
   * Undefined = this mode has no key, and no `Authorization` header is sent.
   * That is the normal state for a custom endpoint — see the note on the two
   * key settings in {@link readClassifierConfig}.
   */
  readonly keyEnv?: string
}

export type Getter = (key: string) => unknown

function stringAt(get: Getter, key: string): string | undefined {
  const raw = get(key)
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined
}

/**
 * A stored number, or the default.
 *
 * Out of range FALLS BACK rather than clamping, which is the opposite of the
 * obvious choice and the right one. `"autoRouting.classifierThreshold": 50`
 * is someone writing a percentage, not someone asking for a confidence floor
 * of 1.0 — and 1.0 is a floor no answer ever clears, so clamping turns a typo
 * into a feature that is on, costs a request per create, and never picks
 * anything. Out of range is a mistake; the shipped default is the safer guess
 * at what they meant.
 *
 * A blank string is ABSENT, not zero: `Number("")` is 0, and a hand-edited
 * empty threshold in the file the docs invite people to edit would otherwise
 * accept every answer however unsure.
 */
function numberAt(get: Getter, key: string, fallback: number, min: number, max: number): number {
  const raw = get(key)
  if (typeof raw === "string" && !raw.trim()) return fallback
  const n = typeof raw === "number" ? raw : Number(typeof raw === "string" ? raw : Number.NaN)
  if (!Number.isFinite(n) || n < min || n > max) return fallback
  return n
}

/**
 * `http://` is fine for a classifier you run yourself and refused for
 * anything else.
 *
 * Banning plain http outright would close the escape hatch the custom option
 * exists for: "run the model on your own machine and nothing leaves it" is
 * how this design answers "I don't want my prompts going to a third party",
 * and `http://127.0.0.1:8000` is what that looks like. Over a network the
 * same URL carries the task's first 1,200 characters — and the bearer token,
 * once one is named — in cleartext, to a host anyone on the path can
 * impersonate.
 */
function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host)
}

function endpointMode(raw: string): ClassifierMode {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { kind: "off" }
  }
  if (url.protocol === "https:") return { kind: "url", url: raw }
  if (url.protocol !== "http:") return { kind: "off" }
  if (isLoopback(url.hostname)) return { kind: "url", url: raw }
  return {
    kind: "refused",
    why: `http:// is only accepted for a loopback address; use https:// for ${url.hostname}`,
  }
}

/**
 * Read the setting. Anything that is not `jev` or an `http(s)` URL reads as
 * `off` — including a typo. A misspelled endpoint must not become "send the
 * prompt somewhere", and off is the shape that sends nothing.
 *
 * **The two modes read DIFFERENT key settings, and that is the whole point.**
 * One shared variable name leaks in both directions across a mode switch: a
 * name chosen for a self-hosted endpoint would send that credential to
 * TypeSafe the moment someone changed the setting to `jev`, and TypeSafe's
 * own token would go to a custom endpoint the moment they changed it back.
 * Neither is a mistake the user could watch themselves make. So `jev` reads
 * `autoRouting.classifierKeyEnv` (shipped default `TYPESAFE_API_KEY`) and a
 * custom endpoint reads `autoRouting.classifierCustomKeyEnv`, which has NO
 * default — unset means no header, which is the right thing to send a host
 * that never asked for one.
 */
export function readClassifierConfig(get: Getter = getPersistedValue): ClassifierConfig {
  const raw = stringAt(get, "autoRouting.classifier") ?? "off"
  const mode: ClassifierMode = raw === "jev" ? { kind: "jev" } : raw === "off" ? { kind: "off" } : endpointMode(raw)
  const keyEnv =
    mode.kind === "jev"
      ? (stringAt(get, "autoRouting.classifierKeyEnv") ?? DEFAULT_KEY_ENV)
      : stringAt(get, "autoRouting.classifierCustomKeyEnv")
  return {
    mode,
    threshold: numberAt(get, "autoRouting.classifierThreshold", DEFAULT_THRESHOLD, 0, 1),
    timeoutMs: numberAt(get, "autoRouting.classifierTimeoutMs", DEFAULT_TIMEOUT_MS, 200, 60_000),
    model: stringAt(get, "autoRouting.classifierModel") ?? DEFAULT_MODEL,
    ...(keyEnv ? { keyEnv } : {}),
  }
}

/** Why no tier came back. Every one of these is an ordinary outcome. */
export type DeclineReason =
  | "off"
  | "blank"
  /** The classifier is on but the named environment variable is not set. */
  | "no-key"
  | "low-confidence"
  /** The endpoint setting names somewhere this will not post to. */
  | "refused"
  /** Network, timeout, non-2xx, or an answer that failed validation. */
  | "failed"

export type ClassifyOutcome =
  | { readonly kind: "picked"; readonly verdict: TierVerdict }
  | { readonly kind: "declined"; readonly reason: DeclineReason; readonly detail?: string }

export interface ClassifyDeps {
  readonly fetch?: typeof globalThis.fetch
  readonly env?: NodeJS.ProcessEnv
  readonly rubric?: TierRubric
}

const declined = (reason: DeclineReason, detail?: string): ClassifyOutcome => ({
  kind: "declined",
  reason,
  ...(detail ? { detail } : {}),
})

/**
 * Classify one prompt. Resolves — always. The caller treats a `declined` of
 * any reason identically: create the task with the fields the user already
 * had. A reason is for a one-line note, not for a branch.
 */
export async function classifyTier(
  text: string,
  config: ClassifierConfig,
  deps: ClassifyDeps = {},
): Promise<ClassifyOutcome> {
  if (config.mode.kind === "off") return declined("off")
  if (config.mode.kind === "refused") return declined("refused", config.mode.why)
  const prompt = text.trim().slice(0, PROMPT_LIMIT)
  if (!prompt) return declined("blank")

  const env = deps.env ?? process.env
  const key = config.keyEnv ? env[config.keyEnv]?.trim() || undefined : undefined
  if (config.mode.kind === "jev" && !key) {
    return declined("no-key", `${config.keyEnv} is not set in the environment`)
  }

  const doFetch = deps.fetch ?? globalThis.fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const request =
      config.mode.kind === "jev"
        ? { url: JEV_ENDPOINT, body: jevRequest(prompt, config.model, deps.rubric ?? DEFAULT_TIER_RUBRIC) }
        : { url: config.mode.url, body: { text: prompt } }
    const res = await doFetch(request.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // `config.keyEnv` is already this mode's own variable, so there is no
        // cross-provider decision left to make here.
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    })
    if (!res.ok) return declined("failed", describeHttpFailure(res))
    const payload: unknown = await res.json()
    const verdict = config.mode.kind === "jev" ? readJevAnswer(payload) : readPlainAnswer(payload)
    if (!verdict.ok) return declined("failed", verdict.why)
    if (verdict.value.confidence < config.threshold) {
      return declined("low-confidence", `${verdict.value.tier} at ${verdict.value.confidence.toFixed(2)}`)
    }
    return { kind: "picked", verdict: verdict.value }
  } catch (err) {
    const why =
      err instanceof Error && err.name === "AbortError" ? `timed out after ${config.timeoutMs}ms` : String(err)
    return declined("failed", why)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Why a non-2xx response is not a pick, in words someone can act on.
 *
 * 429 gets its own sentence because the obvious reading of it is wrong:
 * upstream shares one rate-limit pool, so a 429 usually means *someone else*
 * is busy, not that this key is out of quota. Whoever reads this line after a
 * run of blank tiers must not go buy more credit over it.
 *
 * `retry-after` is REPORTED, not slept on. Backing off means holding a task
 * create for seconds to maybe fill in one field, and this picker is not
 * allowed to be that expensive — a caller that can afford to wait (a request
 * fired while the user is still typing) is the one that should honour it, and
 * it now has the number to honour.
 */
function describeHttpFailure(res: { status: number; headers?: Headers }): string {
  const status = `HTTP ${res.status}`
  if (res.status !== 429) return status
  const after = res.headers?.get?.("retry-after")
  const when = after ? `, retry-after ${after}` : ""
  return `${status} — upstream pool rate limit, not necessarily your quota${when}`
}

/**
 * One Choice question over the three tiers.
 *
 * Two shapes here are load-bearing and neither is obvious:
 *
 *   - **`state` field names are part of the prompt.** The model reads
 *     `task_text` and `labelled_examples` literally; the question's key
 *     (`verdict`) it never sees, which is why the whole question has to be
 *     spelled out in `instructions`.
 *   - **Repo/topic context is deliberately absent.** Every configuration that
 *     added it lost 5–9 points on the dev slice.
 */
export function jevRequest(prompt: string, model: string, rubric: TierRubric): Record<string, unknown> {
  return {
    model,
    state: {
      task_text: prompt,
      labelled_examples: rubric.examples.map((e) => ({ task: e.task, tier: e.tier })),
    },
    questions: {
      verdict: {
        type: "choice",
        criteria: rubric.criteria,
        instructions: { role: rubric.role, criterion: rubric.criterion },
      },
    },
  }
}

export type { TierVerdict }
