import { afterEach, beforeEach, expect, test } from "bun:test"
import type { BridgeClient } from "../src/bridge.ts"
import { Dictation } from "../src/voice/dictation.ts"

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

for (const action of ["stop", "cancel"] as const) {
  test(`${action} releases the microphone before the worklet settles`, async () => {
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
}

for (const boundary of ["permission", "worklet resolve", "worklet reject"] as const) {
  test(`an old ${boundary} completion leaves a newer recording intact`, async () => {
    const worklet = Promise.withResolvers<void>()
    loadWorklet = () => worklet.promise
    const dictation = new Dictation(client, () => ({ draft: "" }))
    const oldStart = dictation.start()
    const oldGrant = grant
    if (boundary !== "permission") {
      oldGrant?.()
      await Promise.resolve()
    }
    dictation.cancel()
    loadWorklet = async () => {}
    const newStart = dictation.start()
    grant?.()
    await newStart
    const createdBefore = contextsCreated

    if (boundary === "permission") oldGrant?.()
    else if (boundary === "worklet resolve") worklet.resolve()
    else worklet.reject(new Error("worklet fetch failed"))
    await oldStart
    expect(contextsCreated).toBe(createdBefore)
    expect(dictation.view.get().phase).toBe("recording")
    expect(liveTracks).toBe(1)
    expect(openContexts).toBe(1)

    dictation.cancel()
    expect(liveTracks).toBe(0)
    expect(openContexts).toBe(0)
  })
}
