import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BEAT, LIFE, partStart, RELETTER, RENAME_PART } from "../src/life/timeline"
import {
  bass,
  bell,
  crashShot,
  hatShot,
  impactShot,
  kickShot,
  lead,
  pad,
  pluck,
  rand,
  reverb,
  riserShot,
  SR,
  shakerShot,
  snareShot,
  swellShot,
  type Voice,
} from "./score-dsp"

// The rove-life score, synthesised the way the sheet is drawn: no samples, no
// library track. 171 BPM, one milestone = two bars of an anthem progression
// (Bm–G–D–A). The groove builds revision by revision, empties out under a riser
// on the PTY host, drops on the rename with the hook, and lands on D today.
//
// usage: bun scripts/life-score.ts   → public/life/score.wav

const N = Math.ceil((LIFE.durationInFrames / LIFE.fps) * SR)
const END = N / SR
/** One beat at 171.4 BPM; a milestone is eight. */
const B = BEAT / LIFE.fps / 8
const at = (k: number, beat = 0) => partStart(k) / LIFE.fps + beat * B
/** The last revision. Milestone 11 is the resolution bar, 12 the final hit. */
const TODAY = 10
/** The PTY host: its second half empties out under the riser into the drop. */
const BREAK = RENAME_PART - 1
const inDrop = (k: number) => k >= RENAME_PART && k <= TODAY
const cut = (k: number, beat: number) => (k === BREAK && beat >= 4) || (k === 11 && beat >= 6)

// The mix, in one place: level per bus and how hard the kick ducks it (the pump).
// The script prints each bus's RMS so it can be balanced by numbers; relative to the
// kick, aim for bass -3, snare -2, lead/arp/bell/pad -8 to -10, fx -11, hats -14.
const MIX = {
  kick: { level: 0.44, duck: 0 },
  snare: { level: 0.6, duck: 0 },
  hat: { level: 0.28, duck: 0 },
  fx: { level: 0.22, duck: 0 },
  bass: { level: 0.18, duck: 0.75 },
  pad: { level: 0.03, duck: 0.65 },
  arp: { level: 0.2, duck: 0.4 },
  lead: { level: 0.14, duck: 0.2 },
  bell: { level: 0.22, duck: 0 },
}
type Bus = keyof typeof MIX
const energy = Object.fromEntries(Object.keys(MIX).map((bus) => [bus, 0])) as Record<Bus, number>

const L = new Float32Array(N)
const R = new Float32Array(N)
const send = new Float32Array(N)
/** Sidechain amount: 1 on each kick, decaying. Filled before anything ducked is added. */
const pump = new Float32Array(N)

function add(bus: Bus, onset: number, len: number, pan: number, wet: number, fn: Voice) {
  const { level, duck } = MIX[bus]
  const gl = Math.cos(((pan + 1) * Math.PI) / 4)
  const gr = Math.sin(((pan + 1) * Math.PI) / 4)
  const i1 = Math.min(N, Math.ceil((onset + len) * SR))
  for (let i = Math.max(0, Math.ceil(onset * SR)); i < i1; i++) {
    const v = level * fn(i / SR - onset)
    const d = v * (1 - duck * pump[i])
    L[i] += d * gl
    R[i] += d * gr
    send[i] += v * wet
    energy[bus] += d * d
  }
}
const hit = (bus: Bus, buf: Float32Array, onset: number, vel: number, pan = 0, wet = 0) =>
  add(bus, onset, buf.length / SR, pan, wet, (t) => vel * buf[Math.min(buf.length - 1, Math.round(t * SR))])

// Harmony ---------------------------------------------------------------------

// Voicings move by step around G3–A4; bass roots sit at 49–73 Hz.
const CHORDS = {
  Bm: { bass: 35, pad: [59, 62, 66, 69], arp: [69, 71, 74, 78, 81] },
  G: { bass: 31, pad: [59, 62, 67, 69], arp: [67, 71, 74, 79, 81] },
  D: { bass: 38, pad: [57, 62, 66, 69], arp: [69, 74, 78, 81, 86] },
  A: { bass: 33, pad: [57, 61, 64, 69], arp: [69, 73, 76, 81, 85] },
  Asus: { bass: 33, pad: [57, 62, 64, 69], arp: [69, 74, 76, 81, 86] },
  A7: { bass: 33, pad: [55, 61, 64, 69], arp: [67, 73, 76, 79, 81] },
} as const
type Chord = keyof typeof CHORDS

// [milestone, beat, chord]: vi–IV–I–V twice, then vi–IV–V into I for the resolution.
const CHANGES: [number, number, Chord][] = [
  [0, 0, "Bm"],
  [1, 0, "G"],
  [2, 0, "D"],
  [3, 0, "A"],
  [4, 0, "Bm"],
  [5, 0, "G"],
  [6, 0, "D"],
  [7, 0, "A"],
  [8, 0, "Bm"],
  [9, 0, "G"],
  [10, 0, "Asus"],
  [10, 4, "A7"],
  [11, 0, "D"],
]
const segments = CHANGES.map(([k, beat, chord], i) => {
  const next = CHANGES[i + 1]
  return { k, chord: CHORDS[chord], start: i === 0 ? 0 : at(k, beat), end: next ? at(next[0], next[1]) : END - 2.2 }
})
const chordAt = (t: number) => (segments.findLast((s) => s.start <= t + 1e-6) ?? segments[0]).chord

// Drums -------------------------------------------------------------------------

const KICK = kickShot()
const SNARE = snareShot()
const HAT = hatShot(false)
const OPEN = hatShot(true)
const SHAKER = shakerShot()
const CRASH = crashShot()
const IMPACT = impactShot()

// Two-step kick; day 0 is a heartbeat on 1 and 5.
const kicks: [number, number][] = []
for (let k = 0; k <= 11; k++)
  for (const b of k === 0 ? [0, 4] : [0, 2.5, 4, 6.5]) if (!cut(k, b)) kicks.push([at(k, b), b === 0 ? 1 : 0.85])
kicks.push([at(12), 1])
for (const [t] of kicks) {
  const i0 = Math.round(t * SR)
  const a = Math.round(0.004 * SR)
  for (let i = Math.max(0, i0 - a); i < Math.min(N, i0 + 0.4 * SR); i++)
    pump[i] = Math.max(pump[i], i < i0 ? (i - i0 + a) / a : Math.exp(-(i - i0) / SR / 0.09))
}
for (const [t, vel] of kicks) hit("kick", KICK, t, vel)

// Half-time backbeat for v0.1, full backbeat from the daemon on; rolls into the drop and the resolution.
for (let k = 1; k <= 11; k++)
  for (const b of k === 1 ? [2, 6] : [1, 3, 5, 7]) if (!cut(k, b)) hit("snare", SNARE, at(k, b), 1, 0, 0.12)
for (let i = 0; i < 8; i++) hit("snare", SNARE, at(BREAK, 4 + i / 4), 0.3 + 0.03 * i, 0, 0.12)
for (let i = 0; i < 16; i++) hit("snare", SNARE, at(BREAK, 6 + i / 8), 0.5 + 0.03 * i, 0, 0.12)
for (let i = 0; i < 8; i++) hit("snare", SNARE, at(TODAY, 6 + i / 4), 0.45 + 0.07 * i, 0, 0.12)

for (let k = 0; k <= 11; k++) {
  for (let s = 0; s < 16; s++) {
    const b = s / 2
    if (cut(k, b)) continue
    const open = k >= 4 && (b === 3.5 || b === 7.5)
    const vel = (s % 2 ? 0.85 : 0.55) * (k === 0 ? 0.6 : 1) * (0.9 + 0.2 * rand())
    hit("hat", open ? OPEN : HAT, at(k, b), vel, s % 2 ? 0.25 : -0.25, 0.05)
  }
  if (k >= 3) for (let s = 1; s < 32; s += 2) if (!cut(k, s / 4)) hit("hat", SHAKER, at(k, s / 4), 0.35 * (0.8 + 0.4 * rand()), 0.4)
}

hit("fx", swellShot(1.5), at(0) - 1.5, 0.7, 0, 0.3)
for (const [k, vel] of [
  [0, 0.5],
  [RENAME_PART, 1],
  [11, 0.8],
  [12, 1],
])
  hit("fx", IMPACT, at(k), vel, 0, 0.3)
for (const k of [2, RENAME_PART, 9, TODAY, 11, 12]) hit("fx", CRASH, at(k), k === 2 ? 0.6 : 0.9, 0, 0.25)
hit("fx", riserShot(2 * B), at(1, 6), 0.5, 0, 0.3)
hit("fx", riserShot(4 * B), at(BREAK, 4), 1, 0, 0.3)
hit("fx", riserShot(4 * B), at(TODAY, 4), 0.7, 0, 0.3)

// Tonal parts -------------------------------------------------------------------

// [beat, beats, octave]: the bass locks to the kick; in the drop it jumps octaves.
const GROOVE = [
  [0, 2, 0],
  [2.5, 1.25, 0],
  [4, 2, 0],
  [6.5, 1.25, 0],
]
const DRIVE = [
  [0, 1, 0],
  [1, 0.5, 12],
  [1.5, 1, 0],
  [2.5, 1.25, 0],
  [4, 1, 0],
  [5, 0.5, 12],
  [5.5, 1, 0],
  [6.5, 1.25, 0],
]
const RING = [
  [0, 4, 0],
  [4, 2, 0],
]
for (let k = 1; k <= 11; k++) {
  for (const [b, beats, oct] of inDrop(k) ? DRIVE : k === 11 ? RING : GROOVE) {
    if (cut(k, b)) continue
    const t = at(k, b)
    add("bass", t, beats * B + 0.2, 0, 0, bass(chordAt(t).bass + oct, beats * B))
  }
}
add("bass", at(12), 3, 0, 0, bass(CHORDS.D.bass, 2.2))

// Pad: a centre voice plus two light detuned sides, brightening revision by revision.
for (const s of segments) {
  const bright = inDrop(s.k) ? 0.95 : s.k >= 11 ? 0.6 : Math.min(0.8, 0.2 + 0.07 * s.k)
  const gain = inDrop(s.k) ? 1.3 : 1
  const onset = Math.max(0, s.start - 0.06)
  const hold = s.end - onset
  for (const m of s.chord.pad) {
    add("pad", onset, hold + 1.8, 0, 0.25, pad(m, 0, bright, hold, gain))
    add("pad", onset, hold + 1.8, -0.6, 0.25, pad(m, -7, bright, hold, gain * 0.3))
    add("pad", onset, hold + 1.8, 0.6, 0.25, pad(m, 7, bright, hold, gain * 0.3))
  }
}

// Arpeggio: quarters on day 0, eighths after; the break sweeps it open into the drop.
for (let k = 0; k <= 11; k++) {
  const steps = k === 0 ? 8 : k === 11 ? 12 : 16
  for (let s = 0; s < steps; s++) {
    const b = k === 0 ? s : s / 2
    const t = at(k, b)
    const tones = chordAt(t).arp
    const idx = k === 11 ? 4 - (s % 5) : [0, 1, 2, 3, 4, 3, 2, 1][s % 8]
    const bright = inDrop(k) || k === 11 ? 1 : k === BREAK ? 0.7 + (0.3 * b) / 8 : Math.min(0.75, 0.2 + 0.08 * k)
    const vel = (s % 2 ? 0.55 : 0.8) * (0.9 + 0.2 * rand())
    add("arp", t, 0.9, s % 2 ? 0.35 : -0.35, 0.3, pluck(tones[idx], vel, bright))
    if (inDrop(k) && s % 4 === 2) add("arp", t, 0.9, 0, 0.45, pluck(tones[idx] + 12, vel * 0.4, 1))
  }
}

// [milestone, beat, midi, beats]: the hook enters on the rename, its top note as ROVE
// is lettered, and climbs to D for the resolution.
const reletter = (RELETTER - partStart(RENAME_PART)) / LIFE.fps / B
const HOOK: [number, number, number, number][] = [
  [8, 0, 74, 1.5],
  [8, 1.5, 78, 1.7],
  [8, reletter, 83, 2.3],
  [8, 5.5, 81, 1],
  [8, 6.5, 78, 1.5],
  [9, 0, 74, 1],
  [9, 1, 76, 0.5],
  [9, 1.5, 78, 1.5],
  [9, 3, 79, 1],
  [9, 4, 81, 1.5],
  [9, 5.5, 83, 1],
  [9, 6.5, 81, 1.5],
  [10, 0, 76, 1.5],
  [10, 1.5, 74, 0.5],
  [10, 2, 76, 2],
  [10, 4, 73, 1.5],
  [10, 5.5, 76, 1],
  [10, 6.5, 81, 1.5],
  [11, 0, 78, 2],
  [11, 2, 81, 2],
  [11, 4, 86, 4],
]
for (const [k, b, m, beats] of HOOK) {
  const dur = beats * B
  add("lead", at(k, b), dur + 0.5, -0.25, 0.35, lead(m, dur, 0.8, -6))
  add("lead", at(k, b), dur + 0.5, 0.25, 0.35, lead(m, dur, 0.8, 6))
  add("lead", at(k, b), dur + 0.5, 0, 0.2, lead(m - 12, dur, 0.45, 0))
}

// [milestone, beat, midi, velocity]: the revision stamps, all chord tones.
const BELLS: [number, number, number, number][] = [
  [0, 0, 78, 0.8],
  [1, 0, 79, 0.7],
  [2, 0, 81, 0.75],
  [3, 0, 85, 0.7],
  [4, 0, 86, 0.7],
  [5, 0, 83, 0.7],
  [6, 0, 81, 0.7],
  [7, 0, 76, 0.7],
  [RENAME_PART, 0, 74, 0.8],
  [RENAME_PART, 1.5, 78, 0.7],
  [RENAME_PART, reletter, 83, 0.9],
  [9, 0, 86, 0.7],
  [TODAY, 0, 88, 0.7],
  [TODAY, 4, 85, 0.6],
  [11, 0, 74, 0.7],
  [11, 0.25, 78, 0.65],
  [11, 0.5, 81, 0.65],
  [11, 0.75, 86, 0.6],
  [11, 1, 90, 0.6],
  [12, 0, 90, 0.5],
]
for (const [k, b, m, vel] of BELLS) add("bell", at(k, b), 5, 0, 0.5, bell(m, vel))

// Mixdown and master -------------------------------------------------------------

const wetL = reverb(send, 0)
const wetR = reverb(send, 23)
const FADE = [END - 2.8, END - 0.1]
let peak = 0
for (let i = 0; i < N; i++) {
  const t = i / SR
  const fade = t < FADE[0] ? 1 : t > FADE[1] ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * (t - FADE[0])) / (FADE[1] - FADE[0]))
  L[i] = (L[i] + wetL[i]) * fade
  R[i] = (R[i] + wetR[i]) * fade
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
}

const pcm = Buffer.alloc(44 + N * 4)
pcm.write("RIFF", 0)
pcm.writeUInt32LE(36 + N * 4, 4)
pcm.write("WAVEfmt ", 8)
pcm.writeUInt32LE(16, 16)
pcm.writeUInt16LE(1, 20)
pcm.writeUInt16LE(2, 22)
pcm.writeUInt32LE(SR, 24)
pcm.writeUInt32LE(SR * 4, 28)
pcm.writeUInt16LE(4, 32)
pcm.writeUInt16LE(16, 34)
pcm.write("data", 36)
pcm.writeUInt32LE(N * 4, 40)
const g = 0.9 / peak
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(Math.round(L[i] * g * 32767), 44 + i * 4)
  pcm.writeInt16LE(Math.round(R[i] * g * 32767), 46 + i * 4)
}
const raw = join(tmpdir(), "rove-life-score.raw.wav")
const limited = join(tmpdir(), "rove-life-score.limited.wav")
writeFileSync(raw, pcm)

// Push 1 dB past -14 LUFS into a limiter, then one linear gain capped at -1 dBTP.
const outDir = join(import.meta.dir, "../public/life")
mkdirSync(outDir, { recursive: true })
const out = join(outDir, "score.wav")
const ff = (...args: string[]) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(r.stderr)
  return r.stderr
}
const loudness = (file: string) => {
  const log = ff("-i", file, "-af", "loudnorm=print_format=json", "-f", "null", "-")
  const m = JSON.parse(log.slice(log.lastIndexOf("{"), log.lastIndexOf("}") + 1))
  return { i: Number(m.input_i), tp: Number(m.input_tp) }
}
const pre = -13 - loudness(raw).i
ff(
  "-y",
  "-i",
  raw,
  "-af",
  `aformat=sample_fmts=fltp,volume=${pre.toFixed(2)}dB,alimiter=limit=0.84:attack=3:release=60:level=false:latency=true`,
  "-c:a",
  "pcm_s16le",
  limited,
)
const m = loudness(limited)
const gain = Math.min(-14 - m.i, -1 - m.tp)
ff("-y", "-i", limited, "-af", `volume=${gain.toFixed(2)}dB`, "-c:a", "pcm_s16le", out)

const rms = Object.entries(energy).map(([bus, e]) => `${bus} ${(10 * Math.log10(e / N)).toFixed(1)}`)
console.log(`bus rms dBFS (pre-master): ${rms.join(" · ")}`)
console.log(
  `${out} · ${END.toFixed(2)}s · ${(m.i + gain).toFixed(1)} LUFS · TP ${(m.tp + gain).toFixed(1)} dBTP · limiter took ${(-13 - m.i).toFixed(1)} LU`,
)
