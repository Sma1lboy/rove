/**
 * WAV sample scaling — the mechanism that made the chime's volume settable
 * at all on Windows, where the only available player (`Media.SoundPlayer`
 * via powershell) has no volume API and discarded the argument.
 *
 * The bar is: scale the samples, leave every header byte alone, and refuse
 * (null, so the caller plays the asset untouched) anything that is not the
 * 16-bit PCM this understands. A quieter chime is worth having; a corrupted
 * one is not.
 */

import { describe, expect, it } from "vitest"
import { scaleWavVolume } from "../../src/tui/lib/wav-volume"

/** A minimal 16-bit PCM WAV carrying `samples`, in the canonical chunk order. */
function wav(samples: number[], opts: { bits?: number; format?: number; channels?: number } = {}): Buffer {
  const bits = opts.bits ?? 16
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2))
  const fmt = Buffer.alloc(16)
  fmt.writeUInt16LE(opts.format ?? 1, 0) // PCM
  fmt.writeUInt16LE(opts.channels ?? 1, 2)
  fmt.writeUInt32LE(44100, 4)
  fmt.writeUInt32LE(88200, 8)
  fmt.writeUInt16LE(2, 12)
  fmt.writeUInt16LE(bits, 14)
  const body = Buffer.concat([
    Buffer.from("WAVE"),
    Buffer.from("fmt "),
    len(fmt.length),
    fmt,
    Buffer.from("data"),
    len(data.length),
    data,
  ])
  return Buffer.concat([Buffer.from("RIFF"), len(body.length), body])
}

function len(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}

/** The `data` chunk's samples, read back out of a rendered WAV. */
function samplesOf(buf: Buffer): number[] {
  const start = buf.indexOf(Buffer.from("data")) + 8
  const out: number[] = []
  for (let i = start; i < buf.length; i += 2) out.push(buf.readInt16LE(i))
  return out
}

describe("scaleWavVolume", () => {
  it("scales every sample by the gain, rounding to the nearest step", () => {
    const out = scaleWavVolume(wav([1000, -1000, 300]), 0.5)
    expect(out).not.toBeNull()
    expect(samplesOf(out as Buffer)).toEqual([500, -500, 150])
  })

  it("returns the bytes unchanged at gain 1, and silence at gain 0", () => {
    const source = wav([1000, -1000])
    expect(scaleWavVolume(source, 1)?.equals(source)).toBe(true)
    expect(samplesOf(scaleWavVolume(source, 0) as Buffer)).toEqual([0, 0])
  })

  it("never mutates the caller's buffer", () => {
    const source = wav([1000])
    scaleWavVolume(source, 0.25)
    expect(samplesOf(source)).toEqual([1000])
  })

  it("clamps an out-of-range gain instead of overflowing int16", () => {
    // A gain above 1 would wrap 32000 past the int16 ceiling into a negative
    // sample — an audible click where the caller asked for "louder".
    expect(samplesOf(scaleWavVolume(wav([32000, -32000]), 4) as Buffer)).toEqual([32000, -32000])
    expect(samplesOf(scaleWavVolume(wav([1000]), -1) as Buffer)).toEqual([0])
  })

  it("leaves the RIFF/fmt headers byte-identical — only `data` changes", () => {
    const source = wav([9000, -9000])
    const out = scaleWavVolume(source, 0.5) as Buffer
    const dataAt = source.indexOf(Buffer.from("data"))
    expect(out.subarray(0, dataAt + 8).equals(source.subarray(0, dataAt + 8))).toBe(true)
    expect(out.length).toBe(source.length)
  })

  it("refuses what it does not understand, so the caller plays the asset as-is", () => {
    expect(scaleWavVolume(Buffer.from("not a wav at all"), 0.5)).toBeNull()
    expect(scaleWavVolume(Buffer.alloc(4), 0.5)).toBeNull()
    expect(scaleWavVolume(wav([1], { bits: 24 }), 0.5)).toBeNull()
    expect(scaleWavVolume(wav([1], { format: 3 }), 0.5)).toBeNull() // IEEE float
  })

  it("refuses a chunk whose declared length runs past the buffer", () => {
    const truncated = wav([1000, 2000])
    truncated.writeUInt32LE(0xffff, truncated.indexOf(Buffer.from("data")) + 4)
    expect(scaleWavVolume(truncated, 0.5)).toBeNull()
  })

  it("scales stereo the same way — the walk is per sample, not per frame", () => {
    const out = scaleWavVolume(wav([100, 200, 300, 400], { channels: 2 }), 0.5) as Buffer
    expect(samplesOf(out)).toEqual([50, 100, 150, 200])
  })
})
