/**
 * Non-streaming protocol translation between Anthropic Messages (`/v1/messages`)
 * and OpenAI Chat Completions (`/v1/chat/completions`), plus SSE re-exports.
 */

import { randomBytes } from "node:crypto"
import { mapAnthropicStopReason, mapOpenAiFinishReason } from "./translate-stream.ts"

export { anthropicSseToOpenAiSse, openAiSseToAnthropicSse } from "./translate-stream.ts"

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

/** Extract the `model` string from a parsed request JSON object, if present. */
export function extractRequestedModel(body: unknown): string | null {
  if (!isRecord(body) || typeof body.model !== "string") return null
  const model = body.model.trim()
  return model.length > 0 ? model : null
}

/** Return a shallow copy of the request JSON with `model` replaced when mapped. */
export function rewriteBodyModel(body: JsonRecord, upstreamModel: string): JsonRecord {
  if (body.model === upstreamModel) return body
  return { ...body, model: upstreamModel }
}

function flattenAnthropicText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === "string") parts.push(block)
    else if (isRecord(block) && block.type === "text" && typeof block.text === "string") parts.push(block.text)
  }
  return parts.join("\n")
}

function anthropicImageToOpenAiPart(block: JsonRecord): JsonRecord | null {
  const source = isRecord(block.source) ? block.source : null
  if (!source) return null
  if (source.type === "base64" && typeof source.media_type === "string" && typeof source.data === "string") {
    return { type: "image_url", image_url: { url: `data:${source.media_type};base64,${source.data}` } }
  }
  if (source.type === "url" && typeof source.url === "string") {
    return { type: "image_url", image_url: { url: source.url } }
  }
  return null
}

/** Translate an Anthropic Messages request body into an OpenAI Chat Completions request body. */
export function anthropicToOpenAiRequest(body: JsonRecord, upstreamModel: string): JsonRecord {
  const messages: JsonRecord[] = []
  const systemText = flattenAnthropicText(body.system)
  if (systemText) messages.push({ role: "system", content: systemText })

  const rawMessages = Array.isArray(body.messages) ? body.messages : []
  for (const rawMsg of rawMessages) {
    if (!isRecord(rawMsg)) continue
    const role = rawMsg.role === "assistant" ? "assistant" : "user"
    const content = rawMsg.content
    if (typeof content === "string") {
      messages.push({ role, content })
      continue
    }
    if (!Array.isArray(content)) continue

    if (role === "user") {
      const userParts: JsonRecord[] = []
      const toolResults: JsonRecord[] = []
      for (const block of content) {
        if (!isRecord(block)) continue
        if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
          toolResults.push({
            role: "tool",
            tool_call_id: block.tool_use_id,
            content: flattenAnthropicText(block.content),
          })
        } else if (block.type === "text" && typeof block.text === "string") {
          userParts.push({ type: "text", text: block.text })
        } else if (block.type === "image") {
          const img = anthropicImageToOpenAiPart(block)
          if (img) userParts.push(img)
        }
      }
      // OpenAI expects tool messages immediately after the assistant tool_calls message.
      for (const tr of toolResults) messages.push(tr)
      if (userParts.length === 1 && userParts[0]?.type === "text") {
        messages.push({ role: "user", content: userParts[0].text })
      } else if (userParts.length > 0) {
        messages.push({ role: "user", content: userParts })
      }
    } else {
      const textParts: string[] = []
      const toolCalls: JsonRecord[] = []
      for (const block of content) {
        if (!isRecord(block)) continue
        if (block.type === "text" && typeof block.text === "string") {
          textParts.push(block.text)
        } else if (block.type === "tool_use" && typeof block.name === "string") {
          toolCalls.push({
            id: typeof block.id === "string" ? block.id : randomId("call"),
            type: "function",
            function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
          })
        }
      }
      const assistantMsg: JsonRecord = { role: "assistant", content: textParts.length > 0 ? textParts.join("") : null }
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls
      messages.push(assistantMsg)
    }
  }

  const out: JsonRecord = { model: upstreamModel, messages }
  if (typeof body.max_tokens === "number") out.max_tokens = body.max_tokens
  if (typeof body.temperature === "number") out.temperature = body.temperature
  if (typeof body.top_p === "number") out.top_p = body.top_p
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length > 0) out.stop = body.stop_sequences
  if (body.stream === true) {
    out.stream = true
    out.stream_options = { include_usage: true }
  }
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    out.tools = body.tools
      .filter((t): t is JsonRecord => isRecord(t) && typeof t.name === "string")
      .map((t) => ({
        type: "function",
        function: {
          name: t.name,
          ...(typeof t.description === "string" ? { description: t.description } : {}),
          parameters: isRecord(t.input_schema) ? t.input_schema : { type: "object", properties: {} },
        },
      }))
  }
  if (isRecord(body.tool_choice)) {
    const choiceType = body.tool_choice.type
    if (choiceType === "auto") out.tool_choice = "auto"
    else if (choiceType === "any") out.tool_choice = "required"
    else if (choiceType === "none") out.tool_choice = "none"
    else if (choiceType === "tool" && typeof body.tool_choice.name === "string") {
      out.tool_choice = { type: "function", function: { name: body.tool_choice.name } }
    }
  }
  return out
}

/** Translate a non-streaming OpenAI Chat Completions response into an Anthropic Messages response. */
export function openAiToAnthropicResponse(body: JsonRecord, requestedModel: string): JsonRecord {
  const choices = Array.isArray(body.choices) ? body.choices : []
  const first = isRecord(choices[0]) ? choices[0] : {}
  const msg = isRecord(first.message) ? first.message : {}
  const content: JsonRecord[] = []

  if (typeof msg.content === "string" && msg.content.length > 0) {
    content.push({ type: "text", text: msg.content })
  }
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if (!isRecord(tc) || !isRecord(tc.function) || typeof tc.function.name !== "string") continue
      const parsedInput = safeJsonParse(typeof tc.function.arguments === "string" ? tc.function.arguments : "{}")
      content.push({
        type: "tool_use",
        id: typeof tc.id === "string" ? tc.id : randomId("toolu"),
        name: tc.function.name,
        input: isRecord(parsedInput) ? parsedInput : {},
      })
    }
  }
  if (content.length === 0) content.push({ type: "text", text: "" })

  const usage = isRecord(body.usage) ? body.usage : {}
  return {
    id: typeof body.id === "string" ? `msg_${body.id.replace(/^chatcmpl[-_]?/, "")}` : randomId("msg"),
    type: "message",
    role: "assistant",
    model: requestedModel,
    content,
    stop_reason: mapOpenAiFinishReason(first.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0,
      output_tokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
    },
  }
}

/** Translate an OpenAI Chat Completions request into an Anthropic Messages request. */
export function openAiToAnthropicRequest(body: JsonRecord, upstreamModel: string): JsonRecord {
  const systemParts: string[] = []
  const messages: JsonRecord[] = []
  const rawMessages = Array.isArray(body.messages) ? body.messages : []

  for (const rawMsg of rawMessages) {
    if (!isRecord(rawMsg)) continue
    const role = rawMsg.role
    if (role === "system" || role === "developer") {
      const text = typeof rawMsg.content === "string" ? rawMsg.content : flattenAnthropicText(rawMsg.content)
      if (text) systemParts.push(text)
      continue
    }
    if (role === "tool") {
      const block: JsonRecord = {
        type: "tool_result",
        tool_use_id: typeof rawMsg.tool_call_id === "string" ? rawMsg.tool_call_id : randomId("toolu"),
        content: typeof rawMsg.content === "string" ? rawMsg.content : JSON.stringify(rawMsg.content ?? ""),
      }
      const prev = messages[messages.length - 1]
      if (prev && prev.role === "user" && Array.isArray(prev.content)) (prev.content as JsonRecord[]).push(block)
      else messages.push({ role: "user", content: [block] })
      continue
    }
    if (role === "assistant") {
      const blocks: JsonRecord[] = []
      if (typeof rawMsg.content === "string" && rawMsg.content.length > 0) {
        blocks.push({ type: "text", text: rawMsg.content })
      }
      if (Array.isArray(rawMsg.tool_calls)) {
        for (const tc of rawMsg.tool_calls) {
          if (!isRecord(tc) || !isRecord(tc.function) || typeof tc.function.name !== "string") continue
          const parsed = safeJsonParse(typeof tc.function.arguments === "string" ? tc.function.arguments : "{}")
          blocks.push({
            type: "tool_use",
            id: typeof tc.id === "string" ? tc.id : randomId("toolu"),
            name: tc.function.name,
            input: isRecord(parsed) ? parsed : {},
          })
        }
      }
      messages.push({ role: "assistant", content: blocks.length > 0 ? blocks : "" })
      continue
    }
    if (typeof rawMsg.content === "string") {
      messages.push({ role: "user", content: rawMsg.content })
    } else if (Array.isArray(rawMsg.content)) {
      const blocks: JsonRecord[] = []
      for (const part of rawMsg.content) {
        if (!isRecord(part)) continue
        if (part.type === "text" && typeof part.text === "string") {
          blocks.push({ type: "text", text: part.text })
        } else if (part.type === "image_url" && isRecord(part.image_url) && typeof part.image_url.url === "string") {
          const url = part.image_url.url
          const dataMatch = /^data:([^;]+);base64,(.+)$/.exec(url)
          if (dataMatch) {
            blocks.push({ type: "image", source: { type: "base64", media_type: dataMatch[1], data: dataMatch[2] } })
          } else {
            blocks.push({ type: "image", source: { type: "url", url } })
          }
        }
      }
      messages.push({ role: "user", content: blocks })
    }
  }

  const maxTokens =
    typeof body.max_completion_tokens === "number"
      ? body.max_completion_tokens
      : typeof body.max_tokens === "number"
        ? body.max_tokens
        : 4096

  const out: JsonRecord = { model: upstreamModel, max_tokens: maxTokens, messages }
  if (systemParts.length > 0) out.system = systemParts.join("\n\n")
  if (typeof body.temperature === "number") out.temperature = body.temperature
  if (typeof body.top_p === "number") out.top_p = body.top_p
  if (typeof body.stop === "string") out.stop_sequences = [body.stop]
  else if (Array.isArray(body.stop) && body.stop.length > 0) out.stop_sequences = body.stop
  if (body.stream === true) out.stream = true
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    out.tools = body.tools
      .filter((t): t is JsonRecord => isRecord(t) && isRecord(t.function) && typeof t.function.name === "string")
      .map((t) => {
        const fn = t.function as JsonRecord
        return {
          name: fn.name,
          ...(typeof fn.description === "string" ? { description: fn.description } : {}),
          input_schema: isRecord(fn.parameters) ? fn.parameters : { type: "object", properties: {} },
        }
      })
  }
  if (body.tool_choice === "auto") out.tool_choice = { type: "auto" }
  else if (body.tool_choice === "required") out.tool_choice = { type: "any" }
  else if (body.tool_choice === "none") out.tool_choice = { type: "none" }
  else if (
    isRecord(body.tool_choice) &&
    isRecord(body.tool_choice.function) &&
    typeof body.tool_choice.function.name === "string"
  ) {
    out.tool_choice = { type: "tool", name: body.tool_choice.function.name }
  }
  return out
}

/** Translate a non-streaming Anthropic Messages response into an OpenAI Chat Completions response. */
export function anthropicToOpenAiResponse(body: JsonRecord, requestedModel: string): JsonRecord {
  const blocks = Array.isArray(body.content) ? body.content : []
  const textParts: string[] = []
  const toolCalls: JsonRecord[] = []
  for (const block of blocks) {
    if (!isRecord(block)) continue
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text)
    } else if (block.type === "tool_use" && typeof block.name === "string") {
      toolCalls.push({
        id: typeof block.id === "string" ? block.id : randomId("call"),
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      })
    }
  }
  const usage = isRecord(body.usage) ? body.usage : {}
  const promptTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0
  const completionTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0
  const message: JsonRecord = {
    role: "assistant",
    content: textParts.length > 0 ? textParts.join("") : null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  }
  return {
    id: typeof body.id === "string" ? `chatcmpl-${body.id.replace(/^msg[-_]?/, "")}` : randomId("chatcmpl"),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [{ index: 0, message, finish_reason: mapAnthropicStopReason(body.stop_reason) }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  }
}
