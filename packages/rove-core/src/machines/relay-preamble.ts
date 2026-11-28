/**
 * `rove daemon relay --preamble` writes {@link RELAY_PREAMBLE} before the first
 * relayed byte, and the hub drops everything up to it. A shell that prints on
 * every ssh command (a PowerShell profile running fastfetch, an rc file that
 * echoes) would otherwise land in front of the daemon protocol and corrupt it.
 */

export const RELAY_PREAMBLE = "\u0000rove-relay-ready\u0000\n"

const MARKER = Buffer.from(RELAY_PREAMBLE, "utf8")
/** A shell that prints this much before Rove starts is not printing a banner. */
const MAX_NOISE_BYTES = 1024 * 1024

/**
 * Feed it the relay's stdout chunk by chunk: returns what follows the marker
 * (empty until it arrives, then everything), or null once the noise overruns
 * {@link MAX_NOISE_BYTES} and the connection should be dropped.
 */
export class PreambleStripper {
  private pending: Buffer | null = Buffer.alloc(0)
  private seen = 0

  push(chunk: Buffer): Buffer | null {
    if (this.pending === null) return chunk
    this.seen += chunk.length
    const joined = Buffer.concat([this.pending, chunk])
    const at = joined.indexOf(MARKER)
    if (at >= 0) {
      this.pending = null
      return joined.subarray(at + MARKER.length)
    }
    if (this.seen > MAX_NOISE_BYTES) return null
    // Keep only a possible marker prefix; the rest is noise.
    this.pending = joined.subarray(Math.max(0, joined.length - (MARKER.length - 1)))
    return Buffer.alloc(0)
  }
}
