/**
 * Scale a 16-bit PCM WAV's samples, so volume is a property of the FILE, not
 * a player argument: four of `sound.ts`'s eleven players take no volume flag
 * (`afplay`, `aplay`, `omxplayer`, and Windows' only option, powershell's
 * `Media.SoundPlayer`).
 *
 * Total: anything unexpected (not RIFF/WAVE, not 16-bit PCM, truncated)
 * returns null and the caller plays the asset untouched.
 */

const RIFF = 0x52494646 // "RIFF"
const WAVE = 0x57415645 // "WAVE"
const FMT = 0x666d7420 // "fmt "
const DATA = 0x64617461 // "data"

const PCM_FORMAT = 1
const INT16_MIN = -32768
const INT16_MAX = 32767

/**
 * `wav` with every sample multiplied by `volume` (0..1), or null when the
 * bytes are not the 16-bit PCM this understands. `volume` at 1 returns a
 * copy unchanged; out-of-range values are clamped.
 */
export function scaleWavVolume(wav: Buffer, volume: number): Buffer | null {
  const gain = Math.min(1, Math.max(0, volume))
  if (wav.length < 12) return null
  if (wav.readUInt32BE(0) !== RIFF || wav.readUInt32BE(8) !== WAVE) return null

  let bitsPerSample: number | undefined
  let format: number | undefined
  let data: { start: number; end: number } | undefined

  // Chunk walk from just past the RIFF header: 4-byte id, 4-byte LE length,
  // payload padded to an even boundary.
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const id = wav.readUInt32BE(offset)
    const size = wav.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + size
    if (size < 0 || end > wav.length) return null
    if (id === FMT) {
      if (size < 16) return null
      format = wav.readUInt16LE(start)
      bitsPerSample = wav.readUInt16LE(start + 14)
    } else if (id === DATA) {
      data = { start, end }
    }
    offset = end + (size % 2)
  }

  if (format !== PCM_FORMAT || bitsPerSample !== 16 || !data) return null
  if ((data.end - data.start) % 2 !== 0) return null

  const out = Buffer.from(wav)
  if (gain === 1) return out
  for (let i = data.start; i < data.end; i += 2) {
    const scaled = Math.round(out.readInt16LE(i) * gain)
    out.writeInt16LE(Math.min(INT16_MAX, Math.max(INT16_MIN, scaled)), i)
  }
  return out
}
