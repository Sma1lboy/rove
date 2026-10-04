/**
 * Believing a classifier's answer.
 *
 * Split from `auto-routing-classifier.ts` on purpose: that file owns WHO gets
 * asked (the setting, the key, the request, the timeout), this one owns
 * whether what came back may be acted on. They fail for different reasons and
 * a reviewer reads them with different questions in mind.
 *
 * Type safety is a promise about the SHAPE of a response, not about its
 * contents: `{"choice": "urgent"}` is a perfectly well-typed JSON object and
 * naming a tier that was never offered is exactly the answer that must never
 * reach `readAutoRoutingTable`. Everything here returns a `Read`, never
 * throws, and never repairs an answer — a repaired answer is our answer
 * wearing the model's name.
 */

import { AUTO_ROUTING_TIERS, type AutoRoutingTier, isAutoRoutingTier } from "./auto-routing.ts"

/**
 * Probabilities come back rounded to the cent, so a distribution sums to 0.99
 * or 1.01. Tolerate that and NEVER renormalize: rescaling edits the number
 * the model reported, and every confidence comparison after it would then be
 * judging our arithmetic instead of its answer.
 */
export const SUM_TOLERANCE = 0.02

export interface TierVerdict {
  readonly tier: AutoRoutingTier
  /** Concentration of the distribution — NOT "the probability this is right". */
  readonly confidence: number
  /**
   * The full distribution, when the endpoint reported one. Absent rather than
   * invented for an endpoint that owes us only a tier and a confidence: a
   * fabricated distribution would read as a measured one.
   */
  readonly probabilities?: Readonly<Record<AutoRoutingTier, number>>
}

export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string }

const bad = (why: string): Read<never> => ({ ok: false, why })

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** A confidence that is a finite number in [0,1], or nothing. */
function readConfidence(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined
}

/**
 * Validate a Choice answer — the five checks
 * `docs/design/auto-routing-classifier-interface.md` names:
 *
 *   1. `choice` is one of the options WE offered. This is the one check that
 *      is about safety rather than hygiene: an out-of-enum id is never acted
 *      on, whatever else the payload says.
 *   2. the probability keys are exactly that enum — no missing tier, no extra;
 *   3. every probability is a finite number in [0,1];
 *   4. the reported choice is the argmax of its own distribution, so an answer
 *      that disagrees with itself is refused instead of half-believed;
 *   5. the distribution sums to 1 ± {@link SUM_TOLERANCE}, and is passed
 *      through unscaled.
 */
export function readChoiceAnswer(answer: unknown): Read<TierVerdict> {
  if (!isRecord(answer)) return bad("answer is not an object")
  const choice = answer.choice
  if (typeof choice !== "string" || !isAutoRoutingTier(choice)) {
    return bad(`choice ${JSON.stringify(choice)} is not one of the offered tiers`)
  }
  const probs = answer.probabilities
  if (!isRecord(probs)) return bad("probabilities is not an object")
  const keys = Object.keys(probs).sort()
  const expected = [...AUTO_ROUTING_TIERS].sort()
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    return bad(`probabilities keys ${keys.join(",")} do not match the offered tiers`)
  }
  const values = {} as Record<AutoRoutingTier, number>
  let sum = 0
  for (const tier of AUTO_ROUTING_TIERS) {
    const p = probs[tier]
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
      return bad(`probability for ${tier} is not a number in [0,1]`)
    }
    values[tier] = p
    sum += p
  }
  if (Math.abs(sum - 1) > SUM_TOLERANCE) return bad(`probabilities sum to ${sum.toFixed(3)}`)
  for (const tier of AUTO_ROUTING_TIERS) {
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
  if (typeof tier !== "string" || !isAutoRoutingTier(tier)) {
    return bad(`tier ${JSON.stringify(tier)} is not one of ${AUTO_ROUTING_TIERS.join(", ")}`)
  }
  const confidence = readConfidence(payload.confidence)
  if (confidence === undefined) return bad("confidence is missing or not a number in [0,1]")
  return { ok: true, value: { tier, confidence } }
}
