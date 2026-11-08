/**
 * Push-to-talk for the web client. The browser already has a microphone and the Mac already has the
 * model, so this records 16 kHz mono PCM, hands it to the bridge op `voice.transcribe` and returns
 * text. No streaming SDK, no second server: `scripts/voice/asr_server.py` is the only backend.
 *
 * Capture is an AudioWorklet because iOS ignores a requested sample rate — the hardware rate decides,
 * and `toWav` resamples whatever came back.
 */

import type { BridgeClient } from "../bridge.ts"
import { type Store, createStore } from "../store.ts"

// Served from `public/` as a plain file: the page's CSP is `script-src 'self'`, so a blob:/data: worklet
// is refused, and a bundler-emitted asset breaks the bun test runner that imports this module.
const WORKLET_URL = "/dictation-worklet.js"

/** Past this a dictation is a monologue; the socket frame and the model's patience both run out. */
const MAX_SECONDS = 60
const TARGET_RATE = 16_000
const SILENCE_LEVEL = 0.004

export type DictationPhase = "idle" | "recording" | "transcribing" | "error"

export interface DictationView {
  readonly phase: DictationPhase
  readonly seconds: number
  /** Loudest block of the last tick, 0–1: what a level meter or waveform draws. */
  readonly level: number
  readonly error: string | null
  /** A live take's text so far (a local recognizer only); empty until the first partial. */
  readonly partial: string
}

const IDLE: DictationView = { phase: "idle", seconds: 0, level: 0, error: null, partial: "" }

export interface DictationResult {
  readonly text: string
  readonly seconds: number
  readonly ms: number
  readonly reason?: string
}

/** What the take is dictated into: the draft so far, and the conversation the bridge reads for vocabulary. */
export interface DictationScope {
  readonly draft: string
  readonly taskId?: string
  readonly tabId?: string
}

/** How often a held take sends what it recorded since the last chunk. */
const LIVE_MS = 1000

/**
 * Down to 16 kHz, the model's rate and a third of the bytes on the wire, one batch of blocks at a time:
 * output sample n is input sample floor(n * step), however the input was split into batches.
 */
export class Downsampler {
  private emitted = 0
  private consumed = 0
  constructor(private readonly step: number) {}

  push(chunks: readonly Float32Array[]): Int16Array {
    const total = chunks.reduce((n, c) => n + c.length, 0)
    const flat = new Float32Array(total)
    let at = 0
    for (const chunk of chunks) {
      flat.set(chunk, at)
      at += chunk.length
    }
    const end = this.consumed + total
    const out: number[] = []
    for (let pos = Math.floor(this.emitted * this.step); pos < end; pos = Math.floor(this.emitted * this.step)) {
      const sample = Math.max(-1, Math.min(1, flat[pos - this.consumed] ?? 0))
      out.push(Math.round(sample * 32767))
      this.emitted++
    }
    this.consumed = end
    return Int16Array.from(out)
  }
}

function pcmBytes(samples: Int16Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true)
  return out
}

function toWav(chunks: readonly Float32Array[], from: number): Uint8Array {
  const samples = new Downsampler(from / TARGET_RATE).push(chunks)
  const frames = Math.max(1, samples.length)
  const out = new Uint8Array(44 + frames * 2)
  const view = new DataView(out.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, "RIFF")
  view.setUint32(4, 36 + frames * 2, true)
  ascii(8, "WAVEfmt ")
  view.setUint32(16, 16, true) // PCM header size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, TARGET_RATE, true)
  view.setUint32(28, TARGET_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, "data")
  view.setUint32(40, frames * 2, true)
  out.set(pcmBytes(samples), 44)
  return out
}

/** Closes a microphone granted after its start was cancelled. */
function drop(stream: MediaStream): null {
  for (const track of stream.getTracks()) track.stop()
  return null
}

function toHex(bytes: Uint8Array): string {
  const parts = new Array<string>(bytes.length)
  for (let i = 0; i < bytes.length; i++) parts[i] = bytes[i].toString(16).padStart(2, "0")
  return parts.join("")
}

/**
 * A held take streamed as it is recorded (`voice.stream`): one chunk in flight at a time, each answered with
 * the text so far. Any failure (an older bridge, a chunk lost) marks it dead and the take is sent whole.
 */
interface LiveTake {
  readonly id: string
  readonly resample: Downsampler
  /** Blocks of `chunks` already sent. */
  sent: number
  seq: number
  inFlight: Promise<unknown> | null
  dead: boolean
}

interface StreamReply {
  readonly partial?: string | null
}

export class Dictation {
  readonly view: Store<DictationView> = createStore<DictationView>(IDLE)

  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private chunks: Float32Array[] = []
  private timer: number | null = null
  private capTimer: number | null = null
  /** Loudest block of the whole take: a take that never rose above silence is dropped. */
  private peak = 0
  private recent = 0
  /** Bumped by every release: a start whose awaits outlive a stop or cancel sees it moved and backs out. */
  private session = 0
  private live: LiveTake | null = null
  private liveTimer: number | null = null

  constructor(
    private readonly client: BridgeClient,
    /** Read at stop: the draft and the conversation as they are when the take ends. */
    private readonly scope: () => DictationScope,
  ) {}

  get recording(): boolean {
    return this.view.get().phase === "recording"
  }

  /** Starts or stops: one button, tap to talk, tap again to finish. */
  async toggle(): Promise<DictationResult | null> {
    return this.recording ? this.stop() : this.start()
  }

  /** `live`: stream the take while it records and show the text so far (a held press). */
  async start(live = false): Promise<null> {
    if (this.view.get().phase !== "idle" && this.view.get().phase !== "error") return null
    const session = ++this.session
    this.live = null
    this.view.set({ ...IDLE, phase: "recording" })
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      if (session !== this.session) return drop(stream)
      this.stream = stream
      const context = new AudioContext()
      this.context = context
      await context.audioWorklet.addModule(WORKLET_URL)
      // release() already closed this start's resources if the worklet outlived it.
      if (session !== this.session) return null
      const source = context.createMediaStreamSource(stream)
      this.node = new AudioWorkletNode(context, "rove-capture")
      this.chunks = []
      this.peak = 0
      this.recent = 0
      this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const block = event.data
        this.chunks.push(block)
        let sum = 0
        for (let i = 0; i < block.length; i++) sum += block[i] * block[i]
        const rms = Math.sqrt(sum / Math.max(1, block.length))
        this.peak = Math.max(this.peak, rms)
        this.recent = Math.max(this.recent, rms)
      }
      source.connect(this.node)
      // A worklet with no sink may not be pulled on every engine; a muted gain keeps it running.
      const mute = context.createGain()
      mute.gain.value = 0
      this.node.connect(mute)
      mute.connect(context.destination)
      const started = Date.now()
      this.timer = window.setInterval(() => {
        this.view.set({ ...this.view.get(), seconds: (Date.now() - started) / 1000, level: this.recent })
        this.recent = 0
      }, 100)
      this.capTimer = window.setTimeout(() => void this.stop(), MAX_SECONDS * 1000)
      if (live) {
        this.live = {
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
          resample: new Downsampler(context.sampleRate / TARGET_RATE),
          sent: 0,
          seq: 0,
          inFlight: null,
          dead: false,
        }
        this.liveTimer = window.setInterval(() => void this.pump(false), LIVE_MS)
      }
      return null
    } catch (err) {
      if (session !== this.session) return null
      this.release()
      this.fail(err)
      return null
    }
  }

  /** Sends what a live take recorded since its last chunk; at `final`, the rest and the transcript back. */
  private async pump(final: boolean): Promise<DictationResult | null> {
    const live = this.live
    if (!live || live.dead || (live.inFlight && !final)) return null
    if (live.inFlight) await live.inFlight.catch(() => {})
    if (live.dead) return null
    const blocks = this.chunks.slice(live.sent)
    live.sent += blocks.length
    const seq = live.seq++
    const scope = seq === 0 ? this.scope() : null
    const request = this.client.request<StreamReply & DictationResult>("voice.stream", {
      session: live.id,
      seq,
      pcm: toHex(pcmBytes(live.resample.push(blocks))),
      final,
      ...(scope ? { context: scope.draft, taskId: scope.taskId, tabId: scope.tabId } : {}),
    })
    live.inFlight = request
    try {
      const reply = await request
      if (final) return reply
      const view = this.view.get()
      if (this.live === live && view.phase === "recording" && typeof reply.partial === "string") {
        this.view.set({ ...view, partial: reply.partial })
      }
    } catch {
      live.dead = true
    } finally {
      if (live.inFlight === request) live.inFlight = null
    }
    return null
  }

  async stop(): Promise<DictationResult | null> {
    if (this.view.get().phase !== "recording") return null
    const rate = this.context?.sampleRate ?? TARGET_RATE
    const chunks = this.chunks
    // Stop the clock before the await: the UI must not keep counting while we wait on the model.
    this.view.set({ ...this.view.get(), phase: "transcribing", level: 0 })
    this.release()
    const wav = toWav(chunks, rate)
    const seconds = (wav.length - 44) / 2 / TARGET_RATE
    if (seconds < 0.3 || this.peak < SILENCE_LEVEL) {
      this.live = null
      this.view.set(IDLE)
      return { text: "", seconds, ms: 0, reason: "silent" }
    }
    try {
      // A live take ends with its last chunk; one whose stream failed is sent whole, as a tapped take is.
      const streamed = this.live ? await this.pump(true) : null
      this.live = null
      const result = streamed ?? (await this.transcribeWhole(wav))
      this.view.set(IDLE)
      return result
    } catch (err) {
      this.live = null
      this.fail(err)
      return null
    }
  }

  private transcribeWhole(wav: Uint8Array): Promise<DictationResult> {
    const scope = this.scope()
    return this.client.request<DictationResult>("voice.transcribe", {
      wav: toHex(wav),
      context: scope.draft,
      taskId: scope.taskId,
      tabId: scope.tabId,
    })
  }

  private fail(err: unknown): void {
    this.view.set({ ...IDLE, phase: "error", error: err instanceof Error ? err.message : String(err) })
  }

  /** Cancels without spending a model call (a stray tap, a swipe away). */
  cancel(): void {
    if (this.view.get().phase !== "recording") return
    this.release()
    this.live = null
    this.view.set(IDLE)
  }

  private release(): void {
    this.session++
    if (this.timer !== null) window.clearInterval(this.timer)
    if (this.capTimer !== null) window.clearTimeout(this.capTimer)
    if (this.liveTimer !== null) window.clearInterval(this.liveTimer)
    this.timer = null
    this.capTimer = null
    this.liveTimer = null
    this.node?.port.close()
    this.node = null
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
    void this.context?.close().catch(() => {})
    this.context = null
  }
}
