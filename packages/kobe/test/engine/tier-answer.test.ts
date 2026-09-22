/**
 * Believing an answer (`engine/tier-answer.ts`).
 *
 * A well-typed response is not a trustworthy one. Every case here is a
 * payload that would deserialize perfectly and must still be refused: an
 * out-of-enum tier, a distribution that disagrees with its own choice, a
 * confidence that is not one. The pass cases exist mainly to pin what is NOT
 * done to a good answer — the numbers come back exactly as they were sent.
 */

import { describe, expect, it } from "vitest"
import { readChoiceAnswer, readJevAnswer, readPlainAnswer } from "../../src/engine/tier-answer.ts"

const ok = { choice: "standard", confidence: 0.6, probabilities: { swift: 0.2, standard: 0.5, deep: 0.3 } }

describe("readChoiceAnswer", () => {
  it("accepts a well-formed answer", () => {
    expect(readChoiceAnswer(ok)).toMatchObject({ ok: true })
  })

  it("refuses a choice outside the enum we offered — the one check that is about safety", () => {
    expect(readChoiceAnswer({ ...ok, choice: "urgent" })).toMatchObject({ ok: false })
    expect(readChoiceAnswer({ ...ok, choice: 2 })).toMatchObject({ ok: false })
  })

  it("refuses probability keys that are not exactly the enum", () => {
    // A missing tier, and an extra one that skews the total.
    expect(readChoiceAnswer({ ...ok, probabilities: { swift: 0.5, standard: 0.5 } })).toMatchObject({ ok: false })
    expect(
      readChoiceAnswer({ ...ok, probabilities: { swift: 0.2, standard: 0.5, deep: 0.2, urgent: 0.1 } }),
    ).toMatchObject({ ok: false })
  })

  it("refuses an EXTRA tier even when the three we asked about are perfectly well-formed", () => {
    // The case that pins this check on its own. Both rows above are also
    // refused with the key check deleted — a missing key reads back as
    // `undefined` and trips the range check, and an extra key that carries
    // probability mass makes the total miss 1 and trips the sum check. A
    // fourth option at zero trips neither: the three tiers we offered sum to
    // 1, agree with `choice`, and are each in range. Without this check that
    // answer is accepted, and an endpoint answering a FOUR-tier question we
    // never asked passes for one answering ours.
    expect(
      readChoiceAnswer({ ...ok, probabilities: { swift: 0.2, standard: 0.5, deep: 0.3, urgent: 0 } }),
    ).toMatchObject({ ok: false })
  })

  it("refuses a number that is not a probability", () => {
    for (const bad of [Number.NaN, -0.1, 1.2, "0.5", null]) {
      expect(readChoiceAnswer({ ...ok, probabilities: { ...ok.probabilities, deep: bad } })).toMatchObject({
        ok: false,
      })
    }
  })

  it("refuses a choice that is not the argmax of its own distribution", () => {
    expect(readChoiceAnswer({ ...ok, choice: "swift" })).toMatchObject({ ok: false })
  })

  it("tolerates a sum of 0.99 and of 1.01, and passes the numbers through UNSCALED", () => {
    // `jev-1.13.0` reports probabilities rounded to the cent, so a real
    // distribution sums to 0.99 or 1.01 — both of these are answers the live
    // endpoint actually returns, not contrived ones.
    for (const probabilities of [
      { swift: 0.2, standard: 0.5, deep: 0.29 }, // 0.99
      { swift: 0.2, standard: 0.5, deep: 0.31 }, // 1.01
    ]) {
      const read = readChoiceAnswer({ choice: "standard", confidence: 0.5, probabilities })
      expect(read, JSON.stringify(probabilities)).toMatchObject({ ok: true })
      // Renormalizing would rewrite these to sum to exactly 1; every
      // threshold comparison after it would then be judging our arithmetic
      // rather than the model's answer.
      expect(read.ok && read.value.probabilities).toEqual(probabilities)
    }
  })

  it("refuses a distribution that does not sum to 1 within tolerance", () => {
    expect(readChoiceAnswer({ ...ok, probabilities: { swift: 0.1, standard: 0.2, deep: 0.3 } })).toMatchObject({
      ok: false,
    })
    // Just outside ±0.02 on each side — the tolerance is a window, not a
    // one-sided allowance, and a test that only ever fails far away from it
    // would pass with the bound written wrong.
    expect(readChoiceAnswer({ ...ok, probabilities: { swift: 0.2, standard: 0.5, deep: 0.27 } })).toMatchObject({
      ok: false,
    })
    expect(readChoiceAnswer({ ...ok, probabilities: { swift: 0.2, standard: 0.5, deep: 0.33 } })).toMatchObject({
      ok: false,
    })
  })

  it("accepts a TIE — the argmax check refuses a choice that is beaten, not one that is matched", () => {
    // Deliberate: with two tiers at the same probability the reported choice
    // IS an argmax, and refusing it would throw away a legitimate answer. The
    // check exists to catch a response that disagrees with itself.
    const tied = { choice: "swift", confidence: 0.4, probabilities: { swift: 0.5, standard: 0.5, deep: 0 } }
    expect(readChoiceAnswer(tied)).toMatchObject({ ok: true })
  })

  it("refuses a missing or out-of-range confidence", () => {
    expect(readChoiceAnswer({ ...ok, confidence: undefined })).toMatchObject({ ok: false })
    expect(readChoiceAnswer({ ...ok, confidence: 1.4 })).toMatchObject({ ok: false })
  })
})

describe("readJevAnswer", () => {
  it("reaches the verdict through the envelope, and refuses one that is not there", () => {
    expect(readJevAnswer({ model: "jev-1.13.0", answers: { verdict: ok } })).toMatchObject({ ok: true })
    expect(readJevAnswer({ model: "jev-1.13.0", answers: {} })).toMatchObject({ ok: false })
    expect(readJevAnswer({ model: "jev-1.13.0" })).toMatchObject({ ok: false })
    expect(readJevAnswer("deep")).toMatchObject({ ok: false })
  })
})

describe("readPlainAnswer", () => {
  it("takes a tier and a confidence, and reports no distribution it was not given", () => {
    const read = readPlainAnswer({ tier: "deep", confidence: 0.8 })
    expect(read).toEqual({ ok: true, value: { tier: "deep", confidence: 0.8 } })
  })

  it("refuses a tier outside the enum and a confidence that is not one", () => {
    expect(readPlainAnswer({ tier: "urgent", confidence: 0.8 })).toMatchObject({ ok: false })
    expect(readPlainAnswer({ tier: "deep", confidence: "high" })).toMatchObject({ ok: false })
    expect(readPlainAnswer("deep")).toMatchObject({ ok: false })
  })
})
