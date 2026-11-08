/**
 * Dictation from the web client. The browser records 16 kHz mono PCM; this op hands those bytes to
 * the ASR sidecar (`scripts/voice/asr_server.py`) together with the text of the conversation being
 * dictated into, whose identifiers and file names become the recognizer's vocabulary. The sidecar
 * binds loopback only — these ops are the one public path to it.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { roveStateDir } from "@sma1lboy/rove/src/env.ts"
import { BridgeError } from "../protocol.ts"
import { flag, tabId, taskId } from "./args.ts"
import type { Args, BridgeApi, OpTable } from "./types.ts"

/** 16-bit 16 kHz mono: one second is 32 KB, ~64 KB as hex. A minute is under the socket's cap. */
const MAX_WAV_HEX = 5 * 1024 * 1024
const TIMEOUT_MS = 120_000
const HEX = /^[0-9a-f]+$/
/** The newest part of the conversation is the part being talked about; the sidecar caps it too. */
const CONVERSATION_CHARS = 20_000
/** Reading the transcript must not hold the dictation up: past this, recognize without it. */
const CONVERSATION_MS = 1500

/** Where the sidecar keeps its secret and dictionary: `<ROVE_HOME>/voice`, same as `asr_server.py`. */
export function voiceDir(): string {
  return process.env.ROVE_VOICE_HOME || join(roveStateDir(), "voice")
}

export function voicePort(): number {
  const raw = Number(process.env.ROVE_VOICE_PORT || "")
  return Number.isInteger(raw) && raw > 0 && raw < 65_536 ? raw : 8791
}

/** `<ROVE_HOME>/voice/token`, written on the sidecar's first start; absent means it never ran. */
function voiceToken(): string | null {
  try {
    return readFileSync(join(voiceDir(), "token"), "utf8").trim() || null
  } catch {
    return null
  }
}

export interface VoiceHealth {
  /** Something answers on the port, warming or not. */
  readonly up: boolean
  readonly ready: boolean
  readonly model: string | null
  readonly warmMs: number | null
  /** Why the recognizer could not start (a missing package, a cloud key), from the sidecar itself. */
  readonly error: string | null
}

export interface VoiceTranscript {
  readonly text: string
  readonly raw: string
  readonly language: string | null
  readonly seconds: number
  readonly ms: number
  /** `silent` / `too_short` when nothing was said; the UI shows the reason instead of text. */
  readonly reason?: string
}

/** One fix `voice.learn` kept: the term, the form the recognizer wrote, and what undoing it must restore. */
export interface LearnedTerm {
  readonly term: string
  readonly spoken: string
  readonly created: boolean
  readonly newForm: boolean
  readonly renamed?: string
}

/** A message, not a document: past this an edit is not a dictation fix. */
const MAX_LEARN_CHARS = 8000
const MAX_SPANS = 16

function text(value: unknown, name: string): string {
  if (typeof value !== "string") throw new BridgeError("BAD_ARGS", `${name} must be text`)
  if (value.length > MAX_LEARN_CHARS) throw new BridgeError("BAD_ARGS", `${name} is longer than a message`)
  return value
}

const isSpan = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  Number.isInteger(value[0]) &&
  Number.isInteger(value[1]) &&
  value[0] >= 0 &&
  value[0] < value[1]

const isLearned = (value: unknown): value is LearnedTerm =>
  typeof value === "object" &&
  value !== null &&
  "term" in value &&
  typeof value.term === "string" &&
  "spoken" in value &&
  typeof value.spoken === "string"

const DOWN: VoiceHealth = { up: false, ready: false, model: null, warmMs: null, error: null }

/** One probe: a sidecar that is up but still warming reports `ready: false`, not an error. */
export async function voiceHealth(): Promise<VoiceHealth> {
  try {
    const res = await fetch(`http://127.0.0.1:${voicePort()}/health`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return DOWN
    const body = (await res.json()) as { ready?: boolean; model?: string; warm_ms?: number | null; error?: string }
    return {
      up: true,
      ready: body.ready === true,
      model: body.model ?? null,
      warmMs: body.warm_ms ?? null,
      error: body.error ?? null,
    }
  } catch {
    return DOWN
  }
}

async function post(path: string, payload: unknown): Promise<Record<string, unknown>> {
  const token = voiceToken()
  if (!token) throw new BridgeError("VOICE_DOWN", "the voice sidecar has never run on this host")
  let res: Response
  try {
    res = await fetch(`http://127.0.0.1:${voicePort()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-voice-token": token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new BridgeError("VOICE_DOWN", "the voice sidecar is not answering on this host")
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new BridgeError("VOICE_FAILED", String(body.error ?? `sidecar answered ${res.status}`))
  }
  return body
}

interface OutputReply {
  readonly history?: { readonly messages?: readonly { readonly blocks?: readonly Record<string, unknown>[] }[] }
  readonly terminal?: { readonly tail?: readonly string[] }
}

/** An `output.read` reply as plain text: message text and tool inputs (commands, paths), or the terminal tail. */
export function conversationText(reply: OutputReply): string {
  const lines: string[] = []
  for (const message of reply.history?.messages ?? []) {
    for (const block of message.blocks ?? []) {
      if (typeof block.text === "string") lines.push(block.text)
      else if (block.input !== undefined) lines.push(JSON.stringify(block.input).slice(0, 1000))
    }
  }
  lines.push(...(reply.terminal?.tail ?? []))
  return lines.join("\n").slice(-CONVERSATION_CHARS)
}

async function conversation(a: Args, api: BridgeApi): Promise<string | undefined> {
  if (a.taskId === undefined) return undefined
  const argv = [flag("task-id", taskId(a)), flag("limit", 30)]
  if (a.tabId !== undefined) argv.push(flag("tab", tabId(a)))
  // An abortable timer: the race's loser must not hold the event loop for the full wait.
  const stop = new AbortController()
  const late = sleep(CONVERSATION_MS, null, { signal: stop.signal }).catch(() => null)
  try {
    const reply = await Promise.race([api.verb<OutputReply>("read-output", argv), late])
    return reply ? conversationText(reply) : undefined
  } catch {
    return undefined
  } finally {
    stop.abort()
  }
}

const SESSION = /^[A-Za-z0-9_-]{1,64}$/

function draftText(value: unknown): string | undefined {
  if (value !== undefined && typeof value !== "string") throw new BridgeError("BAD_ARGS", "context must be text")
  return typeof value === "string" ? value.slice(-400) : undefined
}

function transcript(body: Record<string, unknown>): VoiceTranscript {
  return {
    text: String(body.text ?? ""),
    raw: String(body.raw ?? ""),
    language: typeof body.language === "string" ? body.language : null,
    seconds: Number(body.seconds ?? 0),
    ms: Number(body.ms ?? 0),
    ...(typeof body.reason === "string" && body.reason ? { reason: body.reason } : {}),
  }
}

export const voiceOps: OpTable = {
  "voice.transcribe": {
    kind: "read",
    destructive: false,
    wraps: "rove api read-output (vocabulary) + POST :8791/transcribe of scripts/voice/asr_server.py",
    async run(a: Args, { api }) {
      const wav = a.wav
      if (typeof wav !== "string" || wav.length === 0) throw new BridgeError("BAD_ARGS", "wav is empty")
      if (wav.length > MAX_WAV_HEX) throw new BridgeError("BAD_ARGS", "wav is longer than a dictation")
      if (!HEX.test(wav)) throw new BridgeError("BAD_ARGS", "wav must be lowercase hex")
      const context = draftText(a.context)
      const language = a.language === "zh" || a.language === "en" ? a.language : undefined
      const body = await post("/transcribe", {
        wav,
        context,
        conversation: await conversation(a, api),
        language,
      })
      return transcript(body)
    },
  },
  "voice.stream": {
    kind: "read",
    destructive: false,
    wraps:
      "POST :8791/stream of scripts/voice/asr_server.py (live.py): one chunk of a held take; the first reads the vocabulary like voice.transcribe",
    async run(a: Args, { api }) {
      const session = a.session
      if (typeof session !== "string" || !SESSION.test(session))
        throw new BridgeError("BAD_ARGS", "session is not an id")
      const seq = a.seq
      if (!Number.isInteger(seq) || (seq as number) < 0) throw new BridgeError("BAD_ARGS", "seq must count from 0")
      const pcm = typeof a.pcm === "string" ? a.pcm : ""
      if (pcm.length > MAX_WAV_HEX) throw new BridgeError("BAD_ARGS", "chunk is longer than a dictation")
      if (pcm !== "" && !HEX.test(pcm)) throw new BridgeError("BAD_ARGS", "pcm must be lowercase hex")
      const first = seq === 0
      const body = await post("/stream", {
        session,
        seq,
        pcm,
        final: a.final === true,
        ...(first
          ? {
              context: draftText(a.context),
              conversation: await conversation(a, api),
              language: a.language === "zh" || a.language === "en" ? a.language : undefined,
            }
          : {}),
      })
      if (a.final === true) return transcript(body)
      const partial = body.partial
      return { partial: typeof partial === "string" ? partial : null }
    },
  },
  "voice.learn": {
    kind: "write",
    destructive: false,
    wraps: "POST :8791/learn of scripts/voice/asr_server.py (learn.py; writes <ROVE_HOME>/voice/vocab.json)",
    async run(a: Args) {
      const base = text(a.base, "base")
      const sent = text(a.sent, "sent")
      const spans = Array.isArray(a.spans) ? a.spans.filter(isSpan).slice(0, MAX_SPANS) : []
      if (spans.length === 0) throw new BridgeError("BAD_ARGS", "spans must list the dictated [start, end] ranges")
      const body = await post("/learn", { base, sent, spans })
      return { learned: Array.isArray(body.learned) ? body.learned.filter(isLearned) : [] }
    },
  },
  "voice.unlearn": {
    kind: "write",
    destructive: false,
    wraps: "POST :8791/unlearn of scripts/voice/asr_server.py (undoes one voice.learn)",
    async run(a: Args) {
      if (!Array.isArray(a.learned)) throw new BridgeError("BAD_ARGS", "learned must be what voice.learn returned")
      const body = await post("/unlearn", { learned: a.learned.slice(0, MAX_SPANS) })
      return { undone: Number(body.undone ?? 0) }
    },
  },
}
