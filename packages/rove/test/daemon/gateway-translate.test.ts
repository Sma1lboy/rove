import {
  anthropicSseToOpenAiSse,
  anthropicToOpenAiRequest,
  anthropicToOpenAiResponse,
  openAiSseToAnthropicSse,
  openAiToAnthropicRequest,
  openAiToAnthropicResponse,
} from "@sma1lboy/rove-daemon/gateway/translate"
import { describe, expect, it } from "vitest"

function streamFromChunks(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

async function readStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  const parts: string[] = []
  let next = await reader.read()
  while (!next.done) {
    parts.push(dec.decode(next.value, { stream: true }))
    next = await reader.read()
  }
  return parts.join("")
}

describe("provider gateway protocol translation", () => {
  it("translates Anthropic Messages requests with system, tools, and tool results into OpenAI format", () => {
    const openAi = anthropicToOpenAiRequest(
      {
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        system: [{ type: "text", text: "Be concise." }],
        tools: [
          {
            name: "read_file",
            description: "Read a path",
            input_schema: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
        tool_choice: { type: "any" },
        messages: [
          { role: "user", content: "Open README" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "Checking." },
              { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "README.md" } },
            ],
          },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "hello" }],
          },
        ],
      },
      "anthropic/claude-sonnet-4.5",
    )

    expect(openAi.model).toBe("anthropic/claude-sonnet-4.5")
    expect(openAi.max_tokens).toBe(1024)
    expect(openAi.tool_choice).toBe("required")
    expect(openAi.messages).toEqual([
      { role: "system", content: "Be concise." },
      { role: "user", content: "Open README" },
      {
        role: "assistant",
        content: "Checking.",
        tool_calls: [
          { id: "toolu_1", type: "function", function: { name: "read_file", arguments: '{"path":"README.md"}' } },
        ],
      },
      { role: "tool", tool_call_id: "toolu_1", content: "hello" },
    ])
  })

  it("translates OpenAI responses (text + tool_calls) into Anthropic Messages responses", () => {
    const anthropic = openAiToAnthropicResponse(
      {
        id: "chatcmpl-abc",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: "Running tool",
              tool_calls: [{ id: "call_1", type: "function", function: { name: "bash", arguments: '{"cmd":"ls"}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 7 },
      },
      "claude-sonnet-4-5",
    )

    expect(anthropic).toMatchObject({
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-5",
      stop_reason: "tool_use",
      usage: { input_tokens: 12, output_tokens: 7 },
      content: [
        { type: "text", text: "Running tool" },
        { type: "tool_use", id: "call_1", name: "bash", input: { cmd: "ls" } },
      ],
    })
  })

  it("translates OpenAI requests and Anthropic responses in the reverse direction", () => {
    const req = openAiToAnthropicRequest(
      {
        model: "gpt-5",
        messages: [
          { role: "system", content: "Sys" },
          { role: "user", content: "Hi" },
        ],
        tools: [{ type: "function", function: { name: "ping", parameters: { type: "object" } } }],
        tool_choice: "auto",
      },
      "claude-opus-4-6",
    )
    expect(req).toMatchObject({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      system: "Sys",
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: "Hi" }],
    })

    const res = anthropicToOpenAiResponse(
      {
        id: "msg_xyz",
        content: [{ type: "text", text: "Pong" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 3 },
      },
      "gpt-5",
    )
    expect(res).toMatchObject({
      object: "chat.completion",
      model: "gpt-5",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Pong" } }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    })
  })

  it("translates OpenAI SSE streams to Anthropic SSE streams with text and tool deltas", async () => {
    const openAiStream = streamFromChunks([
      'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"}}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"lo"}}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_9","function":{"name":"read","arguments":"{\\"p\\":\\"a\\"}"}}]}}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\n',
      "data: [DONE]\n\n",
    ])

    const text = await readStreamText(openAiSseToAnthropicSse(openAiStream, "claude-sonnet-4-5"))
    expect(text).toContain("event: message_start")
    expect(text).toContain('"type":"text_delta","text":"Hel"')
    expect(text).toContain('"type":"text_delta","text":"lo"')
    expect(text).toContain('"type":"tool_use","id":"call_9","name":"read"')
    expect(text).toContain('"type":"input_json_delta","partial_json":"{\\"p\\":\\"a\\"}"')
    expect(text).toContain('"stop_reason":"tool_use"')
    expect(text).toContain("event: message_stop")
  })

  it("translates Anthropic SSE streams to OpenAI SSE streams", async () => {
    const anthropicStream = streamFromChunks([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi!"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ])

    const text = await readStreamText(anthropicSseToOpenAiSse(anthropicStream, "gpt-5"))
    expect(text).toContain('"content":"Hi!"')
    expect(text).toContain('"finish_reason":"stop"')
    expect(text).toContain("data: [DONE]")
  })
})
