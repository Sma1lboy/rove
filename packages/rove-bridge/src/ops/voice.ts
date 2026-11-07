/**
 * Dictation from the web client. The browser records 16 kHz mono PCM; this op hands those bytes to
 * the local ASR sidecar (`scripts/voice/asr_server.py`) and returns its transcript. The model never
 * leaves this machine, and the sidecar binds loopback only — this op is the one public path to it.
 *
 * No daemon RPC: the bridge and the sidecar are the same host, and nothing here touches task state.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { roveStateDir } from "@sma1lboy/rove/src/env.ts"
import { BridgeError } from "../protocol.ts"
import type { Args, OpTable } from "./types.ts"

/** 16-bit 16 kHz mono: one second is 32 KB, ~64 KB as hex. A minute is under the socket's cap. */
const MAX_WAV_HEX = 5 * 1024 * 1024
const TIMEOUT_MS = 120_000
const HEX = /^[0-9a-f]+$/

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
  readonly ready: boolean
  readonly model: string | null
  readonly warmMs: number | null
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

/** One probe: a sidecar that is up but still warming reports `ready: false`, not an error. */
export async function voiceHealth(): Promise<VoiceHealth> {
  try {
    const res = await fetch(`http://127.0.0.1:${voicePort()}/health`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return { ready: false, model: null, warmMs: null }
    const body = (await res.json()) as { ready?: boolean; model?: string; warm_ms?: number | null }
    return { ready: body.ready === true, model: body.model ?? null, warmMs: body.warm_ms ?? null }
  } catch {
    return { ready: false, model: null, warmMs: null }
  }
}

async function post(path: string, payload: unknown): Promise<unknown> {
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

export const voiceOps: OpTable = {
  "voice.status": {
    kind: "read",
    destructive: false,
    wraps: "GET :8791/health of scripts/voice/asr_server.py",
    async run() {
      return { ...(await voiceHealth()), port: voicePort() }
    },
  },
  "voice.transcribe": {
    kind: "read",
    destructive: false,
    wraps: "POST :8791/transcribe of scripts/voice/asr_server.py (local Whisper on this host)",
    async run(a: Args) {
      const wav = a.wav
      if (typeof wav !== "string" || wav.length === 0) throw new BridgeError("BAD_ARGS", "wav is empty")
      if (wav.length > MAX_WAV_HEX) throw new BridgeError("BAD_ARGS", "wav is longer than a dictation")
      if (!HEX.test(wav)) throw new BridgeError("BAD_ARGS", "wav must be lowercase hex")
      const context = a.context
      if (context !== undefined && typeof context !== "string")
        throw new BridgeError("BAD_ARGS", "context must be text")
      const language = a.language === "zh" || a.language === "en" ? a.language : undefined
      const body = (await post("/transcribe", {
        wav,
        context: typeof context === "string" ? context.slice(0, 400) : undefined,
        language,
      })) as Partial<VoiceTranscript>
      return {
        text: String(body.text ?? ""),
        raw: String(body.raw ?? ""),
        language: body.language ?? null,
        seconds: Number(body.seconds ?? 0),
        ms: Number(body.ms ?? 0),
        ...(body.reason ? { reason: body.reason } : {}),
      } satisfies VoiceTranscript
    },
  },
}
