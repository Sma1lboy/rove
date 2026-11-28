/**
 * Streaming SSE protocol translation between OpenAI Chat Completions and
 * Anthropic Messages. Re-exported from `translate.ts`.
 */

import { randomBytes } from "node:crypto"

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`
}

export function mapOpenAiFinishReason(reason: unknown): string {
  switch (reason) {
    case "stop":
      return "end_turn"
    case "length":
      return "max_tokens"
    case "tool_calls":
    case "function_call":
      return "tool_use"
    case "content_filter":
      return "refusal"
    default:
      return "end_turn"
  }
}

export function mapAnthropicStopReason(reason: unknown): string {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop"
    case "max_tokens":
      return "length"
    case "tool_use":
      return "tool_calls"
    case "refusal":
      return "content_filter"
    default:
      return "stop"
  }
}

function formatAnthropicSse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function formatOpenAiSse(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`)
}

/**
 * Transform an OpenAI SSE stream into an Anthropic Messages SSE stream.
 * Handles text deltas, incremental tool_call argument deltas, and usage chunks.
 */
export function openAiSseToAnthropicSse(
  upstream: ReadableStream<Uint8Array>,
  requestedModel: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  let buffer = ""
  const messageId = randomId("msg")
  let started = false
  let finished = false
  let nextBlockIndex = 0
  let textBlockIndex: number | null = null
  const toolBlocks = new Map<number, number>()
  let stopReason = "end_turn"
  let inputTokens = 0
  let outputTokens = 0

  const ensureMessageStart = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (started) return
    started = true
    controller.enqueue(
      formatAnthropicSse("message_start", {
        type: "message_start",
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          model: requestedModel,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: inputTokens, output_tokens: 0 },
        },
      }),
    )
  }

  const closeOpenBlocks = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (textBlockIndex !== null) {
      controller.enqueue(
        formatAnthropicSse("content_block_stop", { type: "content_block_stop", index: textBlockIndex }),
      )
      textBlockIndex = null
    }
    for (const blockIndex of toolBlocks.values()) {
      controller.enqueue(formatAnthropicSse("content_block_stop", { type: "content_block_stop", index: blockIndex }))
    }
    toolBlocks.clear()
  }

  const emitFinish = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (finished) return
    finished = true
    ensureMessageStart(controller)
    closeOpenBlocks(controller)
    controller.enqueue(
      formatAnthropicSse("message_delta", {
        type: "message_delta",
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: outputTokens },
      }),
    )
    controller.enqueue(formatAnthropicSse("message_stop", { type: "message_stop" }))
  }

  const handleDataLine = (payload: string, controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (payload === "[DONE]") {
      emitFinish(controller)
      return
    }
    const parsed = safeJsonParse(payload)
    if (!isRecord(parsed)) return
    if (isRecord(parsed.usage)) {
      if (typeof parsed.usage.prompt_tokens === "number") inputTokens = parsed.usage.prompt_tokens
      if (typeof parsed.usage.completion_tokens === "number") outputTokens = parsed.usage.completion_tokens
    }
    const choices = Array.isArray(parsed.choices) ? parsed.choices : []
    const first = isRecord(choices[0]) ? choices[0] : null
    if (!first) return

    ensureMessageStart(controller)
    const delta = isRecord(first.delta) ? first.delta : {}

    if (typeof delta.content === "string" && delta.content.length > 0) {
      if (textBlockIndex === null) {
        textBlockIndex = nextBlockIndex++
        controller.enqueue(
          formatAnthropicSse("content_block_start", {
            type: "content_block_start",
            index: textBlockIndex,
            content_block: { type: "text", text: "" },
          }),
        )
      }
      controller.enqueue(
        formatAnthropicSse("content_block_delta", {
          type: "content_block_delta",
          index: textBlockIndex,
          delta: { type: "text_delta", text: delta.content },
        }),
      )
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        if (!isRecord(tc)) continue
        const openAiIdx = typeof tc.index === "number" ? tc.index : 0
        const fn = isRecord(tc.function) ? tc.function : {}
        let blockIndex = toolBlocks.get(openAiIdx)
        if (blockIndex === undefined) {
          if (textBlockIndex !== null) {
            controller.enqueue(
              formatAnthropicSse("content_block_stop", { type: "content_block_stop", index: textBlockIndex }),
            )
            textBlockIndex = null
          }
          blockIndex = nextBlockIndex++
          toolBlocks.set(openAiIdx, blockIndex)
          controller.enqueue(
            formatAnthropicSse("content_block_start", {
              type: "content_block_start",
              index: blockIndex,
              content_block: {
                type: "tool_use",
                id: typeof tc.id === "string" ? tc.id : randomId("toolu"),
                name: typeof fn.name === "string" ? fn.name : "tool",
                input: {},
              },
            }),
          )
        }
        if (typeof fn.arguments === "string" && fn.arguments.length > 0) {
          controller.enqueue(
            formatAnthropicSse("content_block_delta", {
              type: "content_block_delta",
              index: blockIndex,
              delta: { type: "input_json_delta", partial_json: fn.arguments },
            }),
          )
        }
      }
    }

    if (first.finish_reason !== undefined && first.finish_reason !== null) {
      stopReason = mapOpenAiFinishReason(first.finish_reason)
    }
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split(/\r?\n/)
          buffer = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.startsWith("data:")) continue
            const payload = line.slice(5).trim()
            if (payload) handleDataLine(payload, controller)
          }
        }
        emitFinish(controller)
        controller.close()
      } catch (err) {
        controller.error(err)
      } finally {
        reader.releaseLock()
      }
    },
  })
}

/** Transform an Anthropic Messages SSE stream into an OpenAI Chat Completions SSE stream. */
export function anthropicSseToOpenAiSse(
  upstream: ReadableStream<Uint8Array>,
  requestedModel: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  let buffer = ""
  const completionId = randomId("chatcmpl")
  const created = Math.floor(Date.now() / 1000)
  let sentRole = false
  let doneSent = false
  let toolIndex = -1
  const blockToToolIdx = new Map<number, number>()

  const emitChunk = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    delta: JsonRecord,
    finishReason: string | null = null,
  ) => {
    controller.enqueue(
      formatOpenAiSse({
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model: requestedModel,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      }),
    )
  }

  const handleDataLine = (payload: string, controller: ReadableStreamDefaultController<Uint8Array>) => {
    const parsed = safeJsonParse(payload)
    if (!isRecord(parsed)) return
    const type = parsed.type
    if (type === "message_start" && !sentRole) {
      sentRole = true
      emitChunk(controller, { role: "assistant", content: "" })
      return
    }
    if (type === "content_block_start" && isRecord(parsed.content_block)) {
      if (!sentRole) {
        sentRole = true
        emitChunk(controller, { role: "assistant", content: "" })
      }
      const block = parsed.content_block
      if (block.type === "tool_use" && typeof block.name === "string") {
        toolIndex++
        if (typeof parsed.index === "number") blockToToolIdx.set(parsed.index, toolIndex)
        emitChunk(controller, {
          tool_calls: [
            {
              index: toolIndex,
              id: typeof block.id === "string" ? block.id : randomId("call"),
              type: "function",
              function: { name: block.name, arguments: "" },
            },
          ],
        })
      }
      return
    }
    if (type === "content_block_delta" && isRecord(parsed.delta)) {
      if (!sentRole) {
        sentRole = true
        emitChunk(controller, { role: "assistant", content: "" })
      }
      const delta = parsed.delta
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        emitChunk(controller, { content: delta.text })
      } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        const idx = typeof parsed.index === "number" ? (blockToToolIdx.get(parsed.index) ?? Math.max(0, toolIndex)) : 0
        emitChunk(controller, {
          tool_calls: [{ index: idx, function: { arguments: delta.partial_json } }],
        })
      }
      return
    }
    if (type === "message_delta" && isRecord(parsed.delta) && parsed.delta.stop_reason) {
      emitChunk(controller, {}, mapAnthropicStopReason(parsed.delta.stop_reason))
      return
    }
    if (type === "message_stop" && !doneSent) {
      doneSent = true
      controller.enqueue(formatOpenAiSse("[DONE]"))
    }
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split(/\r?\n/)
          buffer = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.startsWith("data:")) continue
            const payload = line.slice(5).trim()
            if (payload) handleDataLine(payload, controller)
          }
        }
        if (!doneSent) {
          doneSent = true
          controller.enqueue(formatOpenAiSse("[DONE]"))
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      } finally {
        reader.releaseLock()
      }
    },
  })
}
