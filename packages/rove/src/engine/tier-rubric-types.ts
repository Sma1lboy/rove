/**
 * The shape of the judgement the tier classifier applies.
 *
 * Types only, and separate from both the reader
 * (`tier-rubric-source.ts`, which runs at build time and reads
 * `docs/design/auto-routing/`) and the generated data
 * (`tier-rubric.generated.ts`, which is what ships). The generated module
 * imports these, so a type change surfaces as a compile error in the
 * generator rather than as a differently-shaped request on the wire.
 */

import type { AutoRoutingTier } from "./auto-routing.ts"

/**
 * One tier's case, as the wire format's `criteria` entry wants it.
 *
 * `边界` is spelled in the source language on purpose. The `criteria` map is
 * serialized straight into the request, so these keys are read by the model
 * as words — the field name is part of the prompt, not an implementation
 * detail, and this is the name the measured configuration used.
 */
export interface TierCriterion {
  /** What this tier IS — the positive case, judged on its own. */
  readonly what: string
  /** Where it stops: the rule separating it from its neighbours. */
  readonly 边界: string
}

/** A labelled example. `task` is the opening message someone actually typed. */
export interface TierExample {
  readonly task: string
  readonly tier: AutoRoutingTier
}

export interface TierRubric {
  /** Who the model is being asked to be, in one sentence. */
  readonly role: string
  /** The single question every option is judged against. */
  readonly criterion: string
  readonly criteria: Readonly<Record<AutoRoutingTier, TierCriterion>>
  /**
   * Examples that ride in `state`. Prose cannot express where `swift`
   * actually starts and these can: adding them took swift recall from 32% to
   * 62% on the labelled set.
   */
  readonly examples: readonly TierExample[]
}
