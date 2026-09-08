/**
 * The chime volume preference: coercion of whatever is on disk, and the
 * cycle the Settings row steps through. Both are pure — the persisted read
 * is the same `loadStateFile()` seam every other preference uses.
 */

import { describe, expect, it } from "vitest"
import {
  DEFAULT_SOUND_VOLUME,
  SOUND_VOLUME_STEPS,
  nextSoundVolume,
  normalizeSoundVolume,
} from "../../src/state/sound-volume"

describe("normalizeSoundVolume", () => {
  it("keeps a value already in range, including the silent 0", () => {
    expect(normalizeSoundVolume(0.25)).toBe(0.25)
    expect(normalizeSoundVolume(0)).toBe(0)
    expect(normalizeSoundVolume(1)).toBe(1)
  })

  it("clamps out-of-range numbers rather than letting them reach the scaler", () => {
    expect(normalizeSoundVolume(4)).toBe(1)
    expect(normalizeSoundVolume(-2)).toBe(0)
  })

  it("falls back to the default for anything unparseable", () => {
    for (const junk of [undefined, null, "loud", {}, [], Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeSoundVolume(junk)).toBe(DEFAULT_SOUND_VOLUME)
    }
  })

  it("reads a numeric string, so a hand-edited state.json still works", () => {
    expect(normalizeSoundVolume("0.6")).toBe(0.6)
  })
})

describe("nextSoundVolume", () => {
  it("walks the steps in order and wraps at the top", () => {
    const walked = SOUND_VOLUME_STEPS.map((_, i) =>
      SOUND_VOLUME_STEPS.slice(0, i + 1).reduce((v) => nextSoundVolume(v), SOUND_VOLUME_STEPS[0] as number),
    )
    expect(walked[SOUND_VOLUME_STEPS.length - 1]).toBe(SOUND_VOLUME_STEPS[0])
  })

  it("includes the shipped default, so cycling always returns to it", () => {
    expect(SOUND_VOLUME_STEPS).toContain(DEFAULT_SOUND_VOLUME)
  })

  it("advances by exactly one step from a value between steps, never skipping one", () => {
    // A hand-edited state.json can hold a value that is not itself a step;
    // cycling must land on the next step UP, not the one after it.
    expect(nextSoundVolume(0.33)).toBe(0.4)
    expect(nextSoundVolume(0.5)).toBe(0.6)
    expect(nextSoundVolume(0.7)).toBe(0.8)
  })

  it("cycles up to the quietest step from a sub-minimum value, including the silent 0", () => {
    expect(nextSoundVolume(0.05)).toBe(SOUND_VOLUME_STEPS[0])
    expect(nextSoundVolume(0)).toBe(SOUND_VOLUME_STEPS[0])
  })

  it("advances by exactly one step from every on-step value, wrapping at the top", () => {
    const advanced = SOUND_VOLUME_STEPS.map((step) => nextSoundVolume(step))
    expect(advanced).toEqual([...SOUND_VOLUME_STEPS.slice(1), SOUND_VOLUME_STEPS[0]])
  })

  it("offers something quieter than the default to cycle down to", () => {
    // The whole point of the row: "too loud" had no answer but muting.
    expect(SOUND_VOLUME_STEPS.some((step) => step < DEFAULT_SOUND_VOLUME)).toBe(true)
  })
})
