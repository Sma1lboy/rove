import { afterEach, beforeEach, expect, test } from "bun:test"
import type { BridgeClient } from "../src/bridge.ts"
import { Dictation, Downsampler } from "../src/voice/dictation.ts"

/** A microphone whose permission prompt resolves only when the test says so. */
let grant: (() => void) | null = null
let liveTracks = 0
let openContexts = 0
let loadWorklet = async () => {}
let contextsCreated = 0

class FakeAudioContext {
  readonly sampleRate = 48_000
  readonly destination = {}
  readonly audioWorklet = { addModule: () => loadWorklet() }
  constructor() {
    openContexts++
    contextsCreated++
  }
  createMediaStreamSource() {
    return { connect() {} }
  }
  createGain() {
    return { gain: { value: 1 }, connect() {} }
  }
  async close() {
    openContexts--
  }
}

class FakeWorkletNode {
  readonly port = { onmessage: null, close() {} }
  connect() {}
}

const saved = {
  window: globalThis.window,
  navigator: globalThis.navigator,
  AudioContext: globalThis.AudioContext,
  AudioWorkletNode: globalThis.AudioWorkletNode,
}

beforeEach(() => {
  grant = null
  liveTracks = 0
  openContexts = 0
  contextsCreated = 0
  loadWorklet = async () => {}
  Object.assign(globalThis, {
    window: globalThis,
    AudioContext: FakeAudioContext,
    AudioWorkletNode: FakeWorkletNode,
  })
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: () =>
          new Promise((resolve) => {
            grant = () => {
              liveTracks++
              let live = true
              const track = {
                stop: () => {
                  if (live) liveTracks--
                  live = false
                },
              }
              resolve({ getTracks: () => [track] })
            }
          }),
      },
    },
  })
})

afterEach(() => {
  Object.assign(globalThis, {
    window: saved.window,
    AudioContext: saved.AudioContext,
    AudioWorkletNode: saved.AudioWorkletNode,
  })
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: saved.navigator })
})

const client = { request: async () => ({ text: "", seconds: 0, ms: 0 }) } as unknown as BridgeClient

test("a cancel while the microphone prompt is open leaves no microphone running once it is granted", async () => {
  const dictation = new Dictation(client, () => ({ draft: "" }))
  const starting = dictation.start()
  dictation.cancel()
  grant?.()
  await starting

  expect(dictation.view.get().phase).toBe("idle")
  expect(liveTracks).toBe(0)
  expect(openContexts).toBe(0)
  // The next press starts a fresh recording rather than finding a stale one.
  void dictation.start()
  expect(dictation.view.get().phase).toBe("recording")
})

test("a stop while the microphone prompt is open ends idle with the microphone released", async () => {
  const dictation = new Dictation(client, () => ({ draft: "" }))
  const starting = dictation.start()
  const stopped = await dictation.stop()
  grant?.()
  await starting

  expect(stopped?.text).toBe("")
  expect(dictation.view.get().phase).toBe("idle")
  expect(liveTracks).toBe(0)
  expect(openContexts).toBe(0)
})

test.each(["stop", "cancel"] as const)("%s releases the microphone before the worklet settles", async (action) => {
  const worklet = Promise.withResolvers<void>()
  loadWorklet = () => worklet.promise
  const dictation = new Dictation(client, () => ({ draft: "" }))
  const starting = dictation.start()
  grant?.()
  await Promise.resolve()
  expect(liveTracks).toBe(1)
  expect(openContexts).toBe(1)

  await dictation[action]()
  expect(dictation.view.get().phase).toBe("idle")
  expect(liveTracks).toBe(0)
  expect(openContexts).toBe(0)

  worklet.resolve()
  await starting
  expect(dictation.view.get().phase).toBe("idle")
  expect(liveTracks).toBe(0)
  expect(openContexts).toBe(0)
})

type Worklet = { resolve: () => void; reject: (error: Error) => void }
const grantNow = async (oldGrant: typeof grant) => {
  oldGrant?.()
  await Promise.resolve()
}

test.each([
  ["permission", async () => {}, (oldGrant: typeof grant) => oldGrant?.()],
  ["worklet resolve", grantNow, (_: typeof grant, worklet: Worklet) => worklet.resolve()],
  [
    "worklet reject",
    grantNow,
    (_: typeof grant, worklet: Worklet) => worklet.reject(new Error("worklet fetch failed")),
  ],
] as const)("an old %s completion leaves a newer recording intact", async (_boundary, beforeCancel, settleOld) => {
  const worklet = Promise.withResolvers<void>()
  loadWorklet = () => worklet.promise
  const dictation = new Dictation(client, () => ({ draft: "" }))
  const oldStart = dictation.start()
  const oldGrant = grant
  await beforeCancel(oldGrant)
  dictation.cancel()
  loadWorklet = async () => {}
  const newStart = dictation.start()
  grant?.()
  await newStart
  const createdBefore = contextsCreated

  settleOld(oldGrant, worklet)
  await oldStart
  expect(contextsCreated).toBe(createdBefore)
  expect(dictation.view.get().phase).toBe("recording")
  expect(liveTracks).toBe(1)
  expect(openContexts).toBe(1)

  dictation.cancel()
  expect(liveTracks).toBe(0)
  expect(openContexts).toBe(0)
})

test("a live take resampled chunk by chunk is the same audio as the whole take resampled at once", () => {
  const input = Float32Array.from({ length: 4801 }, (_, i) => Math.sin(i / 7) * 0.5)
  const whole = new Downsampler(44_100 / 16_000).push([input])
  const live = new Downsampler(44_100 / 16_000)
  // Uneven cuts, as worklet blocks land between ticks.
  const cuts = [
    [0, 128],
    [128, 129],
    [129, 1000],
    [1000, 1000],
    [1000, 4801],
  ] as const
  const parts = cuts.flatMap(([from, to]) => [...live.push([input.subarray(from, to)])])
  expect(parts).toEqual([...whole])
})
