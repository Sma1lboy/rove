/**
 * Normalize ACP wire events and persisted JSONL records into Rove's neutral
 * `Message` / `ContentBlock` and `EngineActivityKind` vocabularies.
 */

import { isObject } from "@sma1lboy/rove-core/lib/is-object.ts"
import type { ContentBlock, Message } from "@sma1lboy/rove-core/types/engine.ts"
import { isJsonlLineWithinBound } from "../file-bounds.ts"
import type { EngineActivityDetail, EngineActivityKind } from "../hook-events.ts"
import type { TurnCompletionMarker } from "../turn-detector.ts"
import {
  type AcpSessionUpdate,
  type AcpStopReason,
  type AcpToolCallProgressUpdate,
  type AcpToolCallUpdate,
  type AcpTranscriptRecord,
  extractAcpText,
  extractAcpToolOutput,
} from "./protocol.ts"

/** Map an ACP `stopReason` into Rove's normalized activity event kind. */
export function activityFromAcpStopReason(stopReason: AcpStopReason): EngineActivityKind {
  if (stopReason === "cancelled") return "turn-interrupted"
  if (stopReason === "error") return "turn-failed"
  return "turn-complete"
}

/** Map an ACP `session/update` payload to a Rove lifecycle event, or null for content chunks. */
export function activityFromAcpUpdate(
  update: AcpSessionUpdate,
): { readonly kind: EngineActivityKind; readonly detail?: EngineActivityDetail } | null {
  if (update.sessionUpdate === "tool_call") {
    const call = update as AcpToolCallUpdate
    return {
      kind: "tool-pre",
      detail: {
        tool: {
          ...(call.name || call.title ? { name: call.name ?? call.title } : {}),
          ...(call.toolCallId ? { id: call.toolCallId } : {}),
        },
      },
    }
  }
  if (update.sessionUpdate === "tool_call_update") {
    const progress = update as AcpToolCallProgressUpdate
    if (progress.status !== "completed" && progress.status !== "failed") return null
    return {
      kind: progress.status === "failed" ? "tool-failed" : "tool-post",
      detail: {
        tool: {
          ...(progress.name || progress.title ? { name: progress.name ?? progress.title } : {}),
          ...(progress.toolCallId ? { id: progress.toolCallId } : {}),
        },
      },
    }
  }
  return null
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  if (!isJsonlLineWithinBound(line)) return null
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Parse bounded JSONL text into ACP transcript records; malformed lines are skipped. */
export function parseAcpJsonl(raw: string): AcpTranscriptRecord[] {
  const records: AcpTranscriptRecord[] = []
  for (const line of raw.split("\n")) {
    const obj = parseJsonLine(line)
    if (!obj || typeof obj.type !== "string") continue
    if (obj.type === "session_meta" && typeof obj.sessionId === "string" && typeof obj.cwd === "string") {
      records.push({
        type: "session_meta",
        sessionId: obj.sessionId,
        cwd: obj.cwd,
        ...(typeof obj.agentName === "string" ? { agentName: obj.agentName } : {}),
        ...(typeof obj.agentVersion === "string" ? { agentVersion: obj.agentVersion } : {}),
        timestamp: typeof obj.timestamp === "string" ? obj.timestamp : "",
      })
    } else if (obj.type === "user_message" && typeof obj.text === "string") {
      records.push({
        type: "user_message",
        text: obj.text,
        timestamp: typeof obj.timestamp === "string" ? obj.timestamp : "",
      })
    } else if (obj.type === "session_update" && isObject(obj.update) && typeof obj.update.sessionUpdate === "string") {
      records.push({
        type: "session_update",
        update: obj.update as AcpSessionUpdate,
        timestamp: typeof obj.timestamp === "string" ? obj.timestamp : "",
      })
    } else if (obj.type === "turn_end" && typeof obj.stopReason === "string") {
      records.push({
        type: "turn_end",
        stopReason: obj.stopReason,
        ...(typeof obj.error === "string" ? { error: obj.error } : {}),
        timestamp: typeof obj.timestamp === "string" ? obj.timestamp : "",
      })
    }
  }
  return records
}

interface PendingAssistant {
  timestamp: string
  blocks: ContentBlock[]
  toolIndex: Map<string, number>
}

/**
 * Fold ACP transcript records into Rove's neutral `Message[]`.
 * Consecutive `agent_message_chunk` / `agent_thought_chunk` deltas coalesce into
 * single `text` / `thinking` blocks; `tool_call` + `tool_call_update` emit paired
 * `tool_call` and terminal `tool_result` blocks.
 */
export function normalizeAcpRecords(records: readonly AcpTranscriptRecord[], sessionId: string): Message[] {
  const messages: Message[] = []
  let assistant: PendingAssistant | null = null
  let userText = ""
  let userAt = ""

  const flushUser = (): void => {
    if (!userText) return
    messages.push({
      role: "user",
      blocks: [{ type: "text", text: userText }],
      timestamp: userAt,
      sessionId,
    })
    userText = ""
    userAt = ""
  }

  const flushAssistant = (): void => {
    if (!assistant || assistant.blocks.length === 0) {
      assistant = null
      return
    }
    messages.push({
      role: "assistant",
      blocks: assistant.blocks,
      timestamp: assistant.timestamp,
      sessionId,
    })
    assistant = null
  }

  const ensureAssistant = (timestamp: string): PendingAssistant => {
    flushUser()
    if (!assistant) assistant = { timestamp, blocks: [], toolIndex: new Map() }
    if (!assistant.timestamp && timestamp) assistant.timestamp = timestamp
    return assistant
  }

  const appendTextBlock = (target: PendingAssistant, type: "text" | "thinking", delta: string): void => {
    if (!delta) return
    const last = target.blocks[target.blocks.length - 1]
    if (last && last.type === type) {
      target.blocks[target.blocks.length - 1] = { type, text: last.text + delta }
    } else {
      target.blocks.push({ type, text: delta })
    }
  }

  for (const record of records) {
    if (record.type === "session_meta") continue
    if (record.type === "user_message") {
      flushAssistant()
      flushUser()
      if (record.text.length > 0) {
        messages.push({
          role: "user",
          blocks: [{ type: "text", text: record.text }],
          timestamp: record.timestamp,
          sessionId,
        })
      }
      continue
    }
    if (record.type === "turn_end") {
      flushUser()
      flushAssistant()
      if (record.error) {
        messages.push({
          role: "system",
          blocks: [{ type: "text", text: record.error }],
          timestamp: record.timestamp,
          sessionId,
        })
      }
      continue
    }
    const { update, timestamp } = record
    if (update.sessionUpdate === "user_message_chunk") {
      flushAssistant()
      const delta = extractAcpText(update.content)
      if (delta) {
        if (!userAt) userAt = timestamp
        userText += delta
      }
      continue
    }
    if (update.sessionUpdate === "agent_message_chunk") {
      appendTextBlock(ensureAssistant(timestamp), "text", extractAcpText(update.content))
      continue
    }
    if (update.sessionUpdate === "agent_thought_chunk") {
      appendTextBlock(ensureAssistant(timestamp), "thinking", extractAcpText(update.content))
      continue
    }
    if (update.sessionUpdate === "tool_call") {
      const call = update as AcpToolCallUpdate
      const target = ensureAssistant(timestamp)
      const callId = call.toolCallId || `acp-call-${target.blocks.length}`
      const name = call.name ?? call.title ?? call.kind ?? "tool"
      const input = call.rawInput ?? call.input ?? (call.title && call.name ? call.title : {})
      const existing = target.toolIndex.get(callId)
      const block: ContentBlock = { type: "tool_call", callId, name, input }
      if (existing !== undefined) target.blocks[existing] = block
      else {
        target.toolIndex.set(callId, target.blocks.length)
        target.blocks.push(block)
      }
      continue
    }
    if (update.sessionUpdate === "tool_call_update") {
      const progress = update as AcpToolCallProgressUpdate
      const target = ensureAssistant(timestamp)
      const callId = progress.toolCallId
      if (!callId) continue
      const existing = target.toolIndex.get(callId)
      if (existing !== undefined) {
        const prev = target.blocks[existing]
        if (prev && prev.type === "tool_call") {
          const nextName = progress.name ?? progress.title ?? prev.name
          const nextInput = progress.rawInput !== undefined ? progress.rawInput : prev.input
          target.blocks[existing] = { type: "tool_call", callId, name: nextName, input: nextInput }
        }
      } else if (progress.name || progress.title) {
        target.toolIndex.set(callId, target.blocks.length)
        target.blocks.push({
          type: "tool_call",
          callId,
          name: progress.name ?? progress.title ?? "tool",
          input: progress.rawInput ?? {},
        })
      }
      if (progress.status === "completed" || progress.status === "failed") {
        target.blocks.push({
          type: "tool_result",
          callId,
          output: extractAcpToolOutput(progress),
          isError: progress.status === "failed",
        })
      }
    }
  }

  flushUser()
  flushAssistant()
  return messages
}

/** Latest `turn_end` completion marker from an ACP session JSONL (JSC slice-safe id). */
export function latestAcpCompletionMarkerFromJsonl(
  raw: string,
  sourceId = "acp",
  fallbackMtimeMs = 0,
): TurnCompletionMarker | null {
  let latest: TurnCompletionMarker | null = null
  let lineNo = 0
  for (const line of raw.split("\n")) {
    lineNo++
    const obj = parseJsonLine(line)
    if (!obj || obj.type !== "turn_end") continue
    const ts = typeof obj.timestamp === "string" ? Date.parse(obj.timestamp) : Number.NaN
    const timestampMs = Number.isFinite(ts) ? ts : fallbackMtimeMs
    const marker: TurnCompletionMarker = {
      id: `acp:${sourceId}:${timestampMs}:${lineNo}`,
      timestampMs,
      source: "acp",
    }
    if (!latest || marker.timestampMs >= latest.timestampMs) latest = marker
  }
  return latest
}
