/**
 * The PICKER: which tier a prompt deserves.
 *
 * `auto-effort.ts` owns the TABLE (tier → engine/model/effort) and the GATE
 * (can that target start). Neither of them reads the user's sentence. This
 * file is the third piece and it is deliberately a SOCKET, not a model:
 * `autoEffort.classifier` names who answers the question, and the contract is
 * one line — **POST some text, get back a tier and a confidence.**
 *
 *   off (default)  nothing is sent anywhere
 *   jev            TypeSafe System One, with the request shape below
 *   https://…      the user's own endpoint, `{ text } → { tier, confidence }`
 *
 * Four rules this module exists to keep, from `docs/design/auto-effort-classifier.md`:
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
 * The answer is validated before it is believed — type safety is a promise
 * about the SHAPE of a response, not about its contents. See
 * {@link readChoiceAnswer}.
 */

import { getPersistedString } from "@/state/repos"
import { resolveSecret } from "@/state/secrets"
import { DEFAULT_TIER_RUBRIC, type TierRubric, rubricCriteria } from "./auto-effort-rubric.ts"
import { AUTO_EFFORT_TIERS, type AutoEffortTier, isAutoEffortTier } from "./auto-effort.ts"

/** TypeSafe System One. The only endpoint this file knows by name. */
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone"

/** Prompt text beyond this is cut — the request has a 32k ceiling, and a
 *  tier is decided by the first paragraph, never by the last one. */
export const PROMPT_LIMIT = 1200

const DEFAULT_THRESHOLD = 0.5
const DEFAULT_TIMEOUT_MS = 4000
const DEFAULT_MODEL = "jev-latest"
const DEFAULT_KEY_ENV = "TYPESAFE_API_KEY"

/** Probabilities are reported rounded, so they sum to 0.99 or 1.01. Allow
 *  that and NEVER renormalize: rescaling is editing the number the model
 *  reported, and every threshold after it would then be judging our
 *  arithmetic rather than its answer. */
const SUM_TOLERANCE = 0.02

/** Who answers "which tier". */
export type ClassifierMode =
  | { readonly kind: "off" }
  | { readonly kind: "jev" }
  | { readonly kind: "url"; readonly url: string }

export interface ClassifierConfig {
  readonly mode: ClassifierMode
  /** Below this confidence the pick is dropped. `autoEffort.classifierThreshold`. */
  readonly threshold: number
  readonly timeoutMs: number
  /** Model id for `jev` — pin a version here to stop a silent upgrade. */
  readonly model: string
  /**
   * Name of the bearer token — an environment variable first, then the entry
   * under that name in `~/.rove/secrets.json`. Never `state.json`: that file
   * is opened by `rove config` and pasted whole into bug reports.
   */
  readonly keyEnv: string
}

export type Getter = (key: string) => unknown

function stringAt(get: Getter, key: string): string | undefined {
  const raw = get(key)
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined
}

function numberAt(get: Getter, key: string, fallback: number, min: number, max: number): number {
  const raw = get(key)
  const n = typeof raw === "number" ? raw : Number(typeof raw === "string" ? raw : Number.NaN)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * Read the setting. Anything that is not `jev` or an `http(s)` URL reads as
 * `off` — including a typo. A misspelled endpoint must not become "send the
 * prompt somewhere", and off is the shape that sends nothing.
 */
export function readClassifierConfig(get: Getter = getPersistedString): ClassifierConfig {
  const raw = stringAt(get, "autoEffort.classifier") ?? "off"
  let mode: ClassifierMode = { kind: "off" }
  if (raw === "jev") mode = { kind: "jev" }
  else if (/^https?:\/\/\S+$/.test(raw)) mode = { kind: "url", url: raw }
  return {
    mode,
    threshold: numberAt(get, "autoEffort.classifierThreshold", DEFAULT_THRESHOLD, 0, 1),
    timeoutMs: numberAt(get, "autoEffort.classifierTimeoutMs", DEFAULT_TIMEOUT_MS, 200, 60_000),
    model: stringAt(get, "autoEffort.classifierModel") ?? DEFAULT_MODEL,
    keyEnv: stringAt(get, "autoEffort.classifierKeyEnv") ?? DEFAULT_KEY_ENV,
  }
}

export interface TierVerdict {
  readonly tier: AutoEffortTier
  /** Concentration of the distribution — NOT "the probability this is right". */
  readonly confidence: number
  /** The full distribution, when the endpoint reported one. A custom endpoint
   *  owes us only a tier and a confidence, so this is absent for those rather
   *  than invented — a made-up distribution would read as measured. */
  readonly probabilities?: Readonly<Record<AutoEffortTier, number>>
}

/** Why no tier came back. Every one of these is an ordinary outcome. */
export type DeclineReason =
  | "off"
  | "blank"
  /** The classifier is on but no bearer token is set, in either place. */
  | "no-key"
  | "low-confidence"
  /** Network, timeout, non-2xx, or an answer that failed validation. */
  | "failed"

export type ClassifyOutcome =
  | { readonly kind: "picked"; readonly verdict: TierVerdict }
  | { readonly kind: "declined"; readonly reason: DeclineReason; readonly detail?: string }

export interface ClassifyDeps {
  readonly fetch?: typeof globalThis.fetch
  readonly env?: NodeJS.ProcessEnv
  readonly rubric?: TierRubric
  /** Secret lookup, injected so a test never reads the real secrets file. */
  readonly readSecret?: (name: string, env: NodeJS.ProcessEnv) => string | undefined
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
  const prompt = text.trim().slice(0, PROMPT_LIMIT)
  if (!prompt) return declined("blank")

  // The environment first, then `~/.rove/secrets.json` — a long-lived TUI
  // cannot be handed an env var after it started, and the stored key is the
  // only way that process ever gets one. `resolveSecret` owns the order.
  const env = deps.env ?? process.env
  const key = (deps.readSecret ?? resolveSecret)(config.keyEnv, env)
  if (config.mode.kind === "jev" && !key) {
    return declined("no-key", `no ${config.keyEnv} in the environment or ~/.rove/secrets.json`)
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
 * is busy, not that this key is out of quota. Whoever reads this line after
 * a run of blank tiers must not go buy more credit over it.
 *
 * `retry-after` is REPORTED, not slept on. Backing off means holding a task
 * create for seconds to maybe fill in one field, and this picker is not
 * allowed to be that expensive — a caller that can afford to wait (a request
 * fired while the user is still typing) is the one that should honour it,
 * and it now has the number to honour.
 */
function describeHttpFailure(res: { status: number; headers?: Headers }): string {
  const status = `HTTP ${res.status}`
  if (res.status !== 429) return status
  const after = res.headers?.get?.("retry-after")
  const when = after ? `, retry-after ${after}` : ""
  return `${status} — upstream pool rate limit, not necessarily your quota${when}`
}

/* --------------------------------------------------------------------- */
/*  The `jev` request                                                     */
/* --------------------------------------------------------------------- */

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
 *     added it lost 5–9 points.
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
        criteria: rubricCriteria(rubric),
        instructions: { role: rubric.role, criterion: rubric.criterion },
      },
    },
  }
}

/* --------------------------------------------------------------------- */
/*  Reading an answer back                                                */
/* --------------------------------------------------------------------- */

type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string }

const bad = (why: string): Read<never> => ({ ok: false, why })

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** A confidence that is a finite number in [0,1], or nothing. */
function readConfidence(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined
}

/**
 * Validate a Choice answer. The four checks the interface doc names, plus the
 * sum tolerance:
 *
 *   1. `choice` is one of the options WE offered — an out-of-enum id is never
 *      acted on, and this is the one check that is about safety rather than
 *      hygiene;
 *   2. the probability keys are exactly that enum;
 *   3. every probability is a finite number in [0,1];
 *   4. the reported choice is the argmax of the distribution;
 *   5. the distribution sums to 1 ± 0.02, and is passed through unscaled.
 */
export function readChoiceAnswer(answer: unknown): Read<TierVerdict> {
  if (!isRecord(answer)) return bad("answer is not an object")
  const choice = answer.choice
  if (typeof choice !== "string" || !isAutoEffortTier(choice)) {
    return bad(`choice ${JSON.stringify(choice)} is not one of the offered tiers`)
  }
  const probs = answer.probabilities
  if (!isRecord(probs)) return bad("probabilities is not an object")
  const keys = Object.keys(probs).sort()
  const expected = [...AUTO_EFFORT_TIERS].sort()
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    return bad(`probabilities keys ${keys.join(",")} do not match the offered tiers`)
  }
  const values = {} as Record<AutoEffortTier, number>
  let sum = 0
  for (const tier of AUTO_EFFORT_TIERS) {
    const p = probs[tier]
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
      return bad(`probability for ${tier} is not a number in [0,1]`)
    }
    values[tier] = p
    sum += p
  }
  if (Math.abs(sum - 1) > SUM_TOLERANCE) return bad(`probabilities sum to ${sum.toFixed(3)}`)
  for (const tier of AUTO_EFFORT_TIERS) {
    if (values[tier] > values[choice]) return bad(`choice ${choice} is not the most likely tier`)
  }
  const confidence = readConfidence(answer.confidence)
  if (confidence === undefined) return bad("confidence is missing or out of range")
  return { ok: true, value: { tier: choice, confidence, probabilities: values } }
}

/** `{ model, answers: { verdict: … } }` → a verdict. */
export function readJevAnswer(payload: unknown): Read<TierVerdict> {
  if (!isRecord(payload)) return bad("response is not an object")
  const answers = payload.answers
  if (!isRecord(answers)) return bad("response has no answers")
  return readChoiceAnswer(answers.verdict)
}

/**
 * A custom endpoint's answer: `{ tier, confidence }`, nothing else required.
 * The socket's whole contract — anyone can stand this up in ten lines, which
 * is the point of offering a URL at all.
 */
export function readPlainAnswer(payload: unknown): Read<TierVerdict> {
  if (!isRecord(payload)) return bad("response is not an object")
  const tier = payload.tier
  if (typeof tier !== "string" || !isAutoEffortTier(tier)) {
    return bad(`tier ${JSON.stringify(tier)} is not one of swift, standard, deep`)
  }
  const confidence = readConfidence(payload.confidence)
  if (confidence === undefined) return bad("confidence is missing or not a number in [0,1]")
  return { ok: true, value: { tier, confidence } }
}
