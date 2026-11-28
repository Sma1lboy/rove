/**
 * Crockford-base32 ULID: 10 chars of 48-bit ms timestamp (MSB first) + 16
 * chars of 80-bit randomness. The task index relies on two properties:
 *   1. Lex-sortable by creation time — `Task.id` is a string-compare
 *      "created at" tiebreaker.
 *   2. Monotonic — if the clock doesn't advance (same ms, or stepped backward:
 *      NTP, VM resume), hold the last timestamp and increment the last random
 *      tail, so an id never sorts before its predecessor
 *      (github.com/ulid/spec "Monotonicity").
 */

/** Crockford base32 alphabet — no I, L, O, U to avoid ambiguity. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const TIME_LEN = 10
const RAND_LEN = 16

/** Last emitted (timestamp_ms, encoded random tail). Drives monotonicity. */
let lastTime = -1
let lastRand: number[] = new Array(RAND_LEN).fill(0)

/** Timestamp half only: ≤ 48 bits fits in a JS number. */
function encodeTime(now: number, len: number): string {
  let out = ""
  let n = now
  for (let i = len - 1; i >= 0; i--) {
    const mod = n % 32
    out = ALPHABET[mod] + out
    n = (n - mod) / 32
  }
  return out
}

function randomIndices(len: number): number[] {
  const buf = new Uint8Array(len)
  crypto.getRandomValues(buf)
  // Low 5 bits: uniform because the alphabet is exactly 32.
  const out: number[] = new Array(len)
  for (let i = 0; i < len; i++) {
    out[i] = (buf[i] ?? 0) & 0x1f
  }
  return out
}

/** Increment a base-32 indices array in place. Returns false on overflow. */
function incrementIndices(indices: number[]): boolean {
  for (let i = indices.length - 1; i >= 0; i--) {
    const v = indices[i] ?? 0
    if (v < 31) {
      indices[i] = v + 1
      return true
    }
    indices[i] = 0
  }
  // All 16 chars were "Z"; caller regenerates.
  return false
}

function indicesToString(indices: number[]): string {
  let out = ""
  for (const idx of indices) {
    out += ALPHABET[idx] ?? "0"
  }
  return out
}

/** @param now ms override so tests can assert monotonicity deterministically. */
export function ulid(now: number = Date.now()): string {
  let randIndices: number[]
  let time: number
  if (now > lastTime) {
    time = now
    randIndices = randomIndices(RAND_LEN)
  } else {
    // Clock didn't advance: never regress the prefix; increment the tail.
    time = lastTime
    const next = lastRand.slice()
    if (!incrementIndices(next)) {
      randIndices = randomIndices(RAND_LEN)
    } else {
      randIndices = next
    }
  }
  lastTime = time
  lastRand = randIndices
  return encodeTime(time, TIME_LEN) + indicesToString(randIndices)
}

export function _resetUlidStateForTests(): void {
  lastTime = -1
  lastRand = new Array(RAND_LEN).fill(0)
}

export const ULID_ALPHABET = ALPHABET
