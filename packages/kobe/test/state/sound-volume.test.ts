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

  it("lands on a step from a value between steps, never staying put", () => {
    const off = nextSoundVolume(0.33)
    expect(SOUND_VOLUME_STEPS).toContain(off)
    expect(off).not.toBe(0.33)
  })

  it("offers something quieter than the default to cycle down to", () => {
    // The whole point of the row: "too loud" had no answer but muting.
    expect(SOUND_VOLUME_STEPS.some((step) => step < DEFAULT_SOUND_VOLUME)).toBe(true)
  })
})
