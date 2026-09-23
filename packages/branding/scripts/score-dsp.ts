// Synth and drum parts for scripts/life-score.ts. Everything is computed, nothing is
// sampled: tonal voices are functions of time since onset, drums are one-shot
// buffers rendered once and placed per hit.

export const SR = 48000
export const TAU = Math.PI * 2
export const hz = (m: number) => 440 * 2 ** ((m - 69) / 12)

/** A voice: its signal `t` seconds after onset. Called once per sample, in order. */
export type Voice = (t: number) => number

let seed = 7
export const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

/** RBJ biquad, in place. A function `f` sweeps the cutoff (re-read every 32 samples). */
export function biquad(x: Float32Array, type: "lp" | "hp" | "bp", f: number | ((t: number) => number), q = 0.707) {
  let [b0, b1, b2, a1, a2] = [0, 0, 0, 0, 0]
  const set = (fc: number) => {
    const w = (TAU * Math.min(fc, SR * 0.45)) / SR
    const cos = Math.cos(w)
    const alpha = Math.sin(w) / (2 * q)
    const a0 = 1 + alpha
    if (type === "lp") [b0, b1, b2] = [(1 - cos) / 2 / a0, (1 - cos) / a0, (1 - cos) / 2 / a0]
    else if (type === "hp") [b0, b1, b2] = [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0]
    else [b0, b1, b2] = [alpha / a0, 0, -alpha / a0]
    ;[a1, a2] = [(-2 * cos) / a0, (1 - alpha) / a0]
  }
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    if (i === 0 || (typeof f === "function" && i % 32 === 0)) set(typeof f === "function" ? f(i / SR) : f)
    const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x[i]
    y2 = y1
    y1 = y
    x[i] = y
  }
  return x
}

export function shot(len: number, fn: (t: number, i: number) => number) {
  const buf = new Float32Array(Math.ceil(len * SR))
  for (let i = 0; i < buf.length; i++) buf[i] = fn(i / SR, i)
  return buf
}
const noise = (len: number) => shot(len, () => rand() * 2 - 1)
const drive = (x: number, k: number) => Math.tanh(k * x) / Math.tanh(k)
const smooth = (x: number) => (x >= 1 ? 1 : x * x * (3 - 2 * x))

// Tonal voices ---------------------------------------------------------------

/** Additive pad; `bright` 0..1 tilts it from a sine towards a saw. */
export const pad = (m: number, cents: number, bright: number, hold: number, gain = 1): Voice => {
  const f = hz(m) * 2 ** (cents / 1200)
  const amps: number[] = []
  for (let n = 1; n <= 6 && n * f < 7000; n++) amps.push(n ** -(2.2 - 1.2 * bright))
  return (t) => {
    const env = smooth(t / 0.6) * (t < hold ? 1 : Math.exp(-(t - hold) / 0.4))
    let s = 0
    for (let n = 0; n < amps.length; n++) s += amps[n] * Math.sin(TAU * (n + 1) * f * t)
    return gain * env * s
  }
}

/** Plucked saw; `bright` opens the upper partials, like a filter sweep. */
export const pluck = (m: number, vel: number, bright: number): Voice => {
  const f = hz(m)
  const parts: [number, number, number][] = []
  for (let n = 1; n <= 6 && n * f < 12000; n++) parts.push([n, n === 1 ? 1 : (0.55 * bright) ** (n - 1), 3 + n * (7 - 5 * bright)])
  return (t) => {
    let s = 0
    for (const [n, a, d] of parts) s += a * Math.exp(-t * d) * Math.sin(TAU * n * f * t)
    return vel * Math.min(1, t / 0.003) * s
  }
}

/** Celesta-like bell on slightly inharmonic partials: the revision stamp. */
export const bell = (m: number, vel: number): Voice => {
  const f = hz(m)
  return (t) =>
    vel *
    (1 - Math.exp(-t / 0.002)) *
    (Math.exp(-t * 0.9) * Math.sin(TAU * f * t) +
      0.38 * Math.exp(-t * 1.7) * Math.sin(TAU * 2.01 * f * t) +
      0.2 * Math.exp(-t * 3) * Math.sin(TAU * 3.98 * f * t) +
      0.09 * Math.exp(-t * 5) * Math.sin(TAU * 5.43 * f * t))
}

/** Saw lead with a pluck on the attack and vibrato that blooms on held notes. */
export const lead = (m: number, dur: number, vel: number, cents: number): Voice => {
  const f = hz(m) * 2 ** (cents / 1200)
  const partials: number[] = []
  for (let n = 1; n <= 12 && n * f < 9000; n++) partials.push(n)
  let phase = 0
  return (t) => {
    const vib = t > 0.22 ? 0.006 * Math.min(1, (t - 0.22) / 0.3) * Math.sin(TAU * 5.5 * t) : 0
    phase += (TAU * f * (1 + vib)) / SR
    const env = Math.min(1, t / 0.006) * (0.55 + 0.45 * Math.exp(-t / 0.18)) * (t < dur ? 1 : Math.exp(-(t - dur) / 0.08))
    const bright = 0.3 + 0.55 * Math.exp(-t / 0.25)
    let s = 0
    for (const n of partials) s += (Math.sin(n * phase) / n) * bright ** (n - 1)
    return vel * env * s
  }
}

/** Sub bass, driven so its harmonics survive a phone speaker. */
export const bass = (m: number, dur: number): Voice => {
  const f = hz(m)
  return (t) =>
    Math.min(1, t / 0.008) *
    (t < dur ? 1 : Math.exp(-(t - dur) / 0.04)) *
    drive(Math.sin(TAU * f * t) + 0.5 * Math.exp(-t / 0.3) * Math.sin(TAU * 2 * f * t), 1.8)
}

// Drums and effects (one-shot buffers) ----------------------------------------

export function kickShot() {
  const click = biquad(noise(0.01), "hp", 1500)
  return shot(0.5, (t, i) => {
    const body = Math.exp(-t / 0.22) * Math.sin(TAU * (50 * t + 130 * 0.025 * (1 - Math.exp(-t / 0.025))))
    return drive(body + (i < click.length ? 0.35 * click[i] * Math.exp(-t / 0.003) : 0), 2.2)
  })
}

export function snareShot() {
  const hiss = biquad(biquad(noise(0.45), "hp", 1800), "lp", 9000)
  return shot(0.45, (t, i) => {
    const body =
      Math.exp(-t / 0.07) * Math.sin(TAU * (190 * t + 90 * 0.012 * (1 - Math.exp(-t / 0.012)))) +
      0.4 * Math.exp(-t / 0.05) * Math.sin(TAU * 330 * t)
    return drive(0.55 * body + 0.9 * hiss[i] * Math.exp(-t / 0.16), 1.8)
  })
}

export function hatShot(open: boolean) {
  const len = open ? 0.45 : 0.09
  const hiss = biquad(noise(len), "hp", 7000)
  return shot(len, (t, i) => hiss[i] * Math.exp(-t / (open ? 0.16 : 0.022)))
}

export function shakerShot() {
  const hiss = biquad(noise(0.1), "hp", 5000)
  return shot(0.1, (t, i) => hiss[i] * Math.min(1, t / 0.006) * Math.exp(-t / 0.035))
}

export function crashShot() {
  const hiss = biquad(noise(3), "hp", 4000)
  const modes = [3150, 4720, 6080, 7930, 9340].map((f) => [f, rand() * TAU])
  return shot(3, (t, i) => {
    let shimmer = 0
    for (const [f, p] of modes) shimmer += Math.sin(TAU * f * t + p)
    return (0.9 * hiss[i] + 0.04 * shimmer) * Math.min(1, t / 0.002) * Math.exp(-t / 0.9)
  })
}

/** Cinematic hit: a 70 → 32 Hz boom under low rumble. */
export function impactShot() {
  const rumble = biquad(noise(1.6), "lp", 180)
  return shot(1.6, (t, i) => {
    const boom = Math.exp(-t / 0.8) * Math.sin(TAU * (32 * t + 38 * 0.12 * (1 - Math.exp(-t / 0.12))))
    return drive(boom + 2.5 * rumble[i] * Math.exp(-t / 0.25), 1.5)
  })
}

/** Uplifter ending exactly at `len`: band-passed noise and a tone sweeping up. */
export function riserShot(len: number) {
  const [f0, f1] = [180, 1400]
  const hiss = biquad(noise(len), "bp", (t) => 300 * (7000 / 300) ** (t / len), 1.2)
  return shot(len, (t, i) => {
    const x = t / len
    const tone = Math.sin(((TAU * f0 * len) / Math.log(f1 / f0)) * ((f1 / f0) ** x - 1))
    return (2.2 * x * x * hiss[i] + 0.25 * x ** 3 * tone) * Math.min(1, (1 - x) / 0.02)
  })
}

/** Reverse-cymbal swell into a downbeat. */
export function swellShot(len: number) {
  const hiss = biquad(noise(len), "hp", 3000)
  return shot(len, (t, i) => (hiss[i] * (Math.exp((4 * t) / len) - 1)) / (Math.E ** 4 - 1))
}

/** Freeverb: eight damped combs into four allpasses; `spread` offsets the right channel. */
export function reverb(input: Float32Array, spread: number, room = 0.84, damp = 0.25) {
  const scale = SR / 44100
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => ({
    buf: new Float32Array(Math.round((d + spread) * scale)),
    i: 0,
    lp: 0,
  }))
  const passes = [556, 441, 341, 225].map((d) => ({ buf: new Float32Array(Math.round((d + spread) * scale)), i: 0 }))
  const out = new Float32Array(input.length)
  for (let n = 0; n < input.length; n++) {
    const x = input[n] * 0.015
    let acc = 0
    for (const c of combs) {
      const y = c.buf[c.i]
      c.lp = y * (1 - damp) + c.lp * damp
      c.buf[c.i] = x + c.lp * room
      c.i = (c.i + 1) % c.buf.length
      acc += y
    }
    for (const a of passes) {
      const b = a.buf[a.i]
      a.buf[a.i] = acc + b * 0.5
      a.i = (a.i + 1) % a.buf.length
      acc = b - acc
    }
    out[n] = acc
  }
  return out
}
